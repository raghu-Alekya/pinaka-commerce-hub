import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { type EntityManager } from 'typeorm';
import {
  calculateDiscountTotal,
  effectiveFeeTotal,
  orderTotalWithTax,
  sumLineSubtotals,
  sumLineTotals,
  toMinor,
  fromMinor,
  type PosFeeLine,
  type PosLineItem,
} from '../calculations/store-order.calculations';
import { OrderRepository } from '../order.repository';
import { LoyaltyRepository, type CustomerRow, type LoyaltyScope, type OrderRow } from './loyalty.repository';
import {
  availableFromLedger,
  closedOrderStatus,
  defaultLoyaltySettings,
  earnedOrderPoints,
  findNamedProduct,
  flattenCatalog,
  formatDate,
  integerValue,
  isEmailContact,
  lineMatchesProduct,
  lineMeta,
  liveRedemption,
  loyaltyCustomerName,
  loyaltyUsername,
  orderIsCompleted,
  partialRefundExpiredPoints,
  paymentIsVoid,
  presentSettings,
  publicOrderId,
  redemptionBlocked,
  roundMoney,
  settingsFromStored,
  shouldClearLedgerAfterVoid,
  storedSettingsPatch,
  taggedItemPoints,
  type CatalogProduct,
  type LoyaltySettings,
  type OrderLine,
  validateSettingsUpdate,
  welcomePoints,
  withLineMeta,
} from './loyalty.rules';

@Injectable()
export class LoyaltyService implements OnModuleInit {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(LoyaltyRepository) private readonly loyalty: LoyaltyRepository,
  ) {}

  onModuleInit(): void {
    this.orders.registerLoyaltyPaymentVoid(async (scope) => {
      try {
        await this.onPaymentVoid(scope);
      } catch (error) {
        console.error('[Loyalty] Payment void balance update failed', error);
      }
    });
    this.orders.registerLoyaltyOrderCompleted((scope) => this.creditCompletedOrder(scope));
  }

  async getPoints(contactValue: unknown, scope: LoyaltyScope) {
    await this.assertEnabled(scope);
    const contact = requiredContact(contactValue, 'Please enter mobile no or email');
    const customer = await this.loyalty.findCustomer(scope, contact, isEmailContact(contact));
    if (!customer) {
      return {
        success: true,
        message: 'No loyalty points record found for the given contact.',
        data: { contact, available_points: 0 },
      };
    }
    const available = await this.loyalty.transaction(async (manager) => {
      await this.creditCustomerHistory(scope, customer, contact, manager);
      return this.availablePoints(scope, customer.id, manager);
    });
    return {
      success: true,
      message: 'Loyalty points retrieved successfully.',
      data: { contact, available_points: available },
    };
  }

  async createCustomer(body: Record<string, unknown> | undefined, scope: LoyaltyScope) {
    await this.assertEnabled(scope);
    const payload = jsonBody(body);
    const contact = requiredContact(payload.contact, 'Please enter email or mobile number.');
    const email = isEmailContact(contact);
    return this.loyalty.transaction(async (manager) => {
      const order = await this.requireOpenOrder(scope, payload.order_id, manager, 'redeem');
      const settings = await this.settings(scope, manager);
      const lines = asLines(order.line_items);
      const products = settings.mode === 'item' ? flattenCatalog(await this.loyalty.catalog(scope, manager)) : [];
      const itemPoints = settings.mode === 'item' ? taggedItemPoints(lines, products) : 0;
      let customer = await this.loyalty.findCustomer(scope, contact, email, manager);
      const existing = Boolean(customer);
      if (!customer) {
        customer = await this.loyalty.insertCustomer(scope, {
          name: loyaltyCustomerName(contact, email),
          email: email ? contact : null,
          mobile: email ? null : contact,
          username: loyaltyUsername(contact, email),
        }, manager);
        await this.loyalty.writeMeta(customer.id, {
          contact,
          ...(email ? { billing_email: contact } : { billing_phone: contact }),
        }, manager);
      } else {
        await this.loyalty.writeMeta(customer.id, { contact }, manager);
      }
      const metaEntries: Array<{ key: string; value: unknown }> = [
        { key: 'loyaltyuser_id', value: customer.id },
        { key: 'contact', value: contact },
      ];
      if (existing && settings.mode === 'item') metaEntries.push({ key: 'order_loyalty_points', value: itemPoints });
      await this.putOrderMeta(order, metaEntries, manager);
      await this.creditCustomerHistory(scope, customer, contact, manager);
      const meta = await this.loyalty.readMeta(customer.id, manager);
      const available = await this.availablePoints(scope, customer.id, manager);
      const welcome = welcomePoints({
        availablePoints: available,
        alreadyAdded: meta.new_customer_points_added,
        configuredPoints: settings.newCustomerPoints,
        mode: settings.mode,
        itemPoints,
      });
      if (welcome !== undefined) {
        await this.loyalty.writeMeta(customer.id, {
          pinaka_newly_registered_points: welcome,
          new_customer_points_added: 1,
        }, manager);
      }
      const quote = liveRedemption({
        orderTotal: Number(order.total) || 0,
        availablePoints: available,
        redeemPoint: settings.redeemPoint,
        redeemAmount: settings.redeemAmount,
        ebtEligibleTotal: Number(metaValue(order, '_pinaka_ebt_eligible_total')) || 0,
      });
      return {
        success: true,
        message: quote.message,
        data: {
          user_id: customer.id,
          order_id: publicOrderId(payload.order_id, order.order_number || order.client_order_id),
          contact,
          existing_net_payable: roundMoney(Number(order.total) || 0),
          redeem_points: quote.redeemPoints,
          value_redeemed: quote.valueRedeemed,
          available_points: Math.trunc(available),
          new_payable_amount: quote.newPayable,
        },
      };
    });
  }

  async addPoints(body: Record<string, unknown> | undefined, scope: LoyaltyScope) {
    await this.assertEnabled(scope);
    const payload = jsonBody(body);
    const contact = requiredContact(payload.contact, 'Please enter mobile no or email');
    const redeemPoints = integerValue(payload.redeem_points);
    if (redeemPoints === undefined) {
      throw fail(400, 'invalid_redeem_points', 'Redeem points must be an integer value (no decimals).');
    }
    if (redeemPoints < 0) throw fail(400, 'invalid_redeem', 'Redeemed points cannot be negative.');
    const redeemAmount = Number(payload.redeem_amount ?? 0);
    return this.loyalty.transaction(async (manager) => {
      const order = await this.requireOpenOrder(scope, payload.order_id, manager, 'redeem');
      const settings = await this.settings(scope, manager);
      const products = flattenCatalog(await this.loyalty.catalog(scope, manager));
      const loyaltyProduct = findNamedProduct(products, 'loyalty', settings.loyaltyProductIds);
      if (!loyaltyProduct) throw fail(400, 'product_missing', 'Please create a "Loyalty" product before redeeming points.');
      const lines = asLines(order.line_items);
      if (!lines.length) throw fail(400, 'no_line_items', 'Cannot redeem points because the order has no line items.');
      const orderContact = String(metaValue(order, 'contact') || '');
      if (orderContact && orderContact !== contact) {
        throw fail(400, 'contact_mismatch', `Contact mismatch. Order #${publicOrderId(payload.order_id)} belongs to ${orderContact}, not ${contact}.`);
      }
      if (redemptionBlocked({
        conflictRule: settings.conflictRule,
        discountTotal: Number(order.discount_total) || 0,
        couponCount: couponCount(order.coupon_lines),
        hasPayout: lines.some((line) => lineMatchesProduct(line, 'payout', settings.payoutProductIds)),
        hasDiscountProduct: lines.some((line) => lineMatchesProduct(line, 'discount', settings.discountProductIds)),
        hasCashback: lines.some((line) => lineMatchesProduct(line, 'cashback', settings.cashbackProductIds)),
      })) {
        await this.putOrderMeta(order, [
          { key: 'contact', value: contact },
          { key: 'redeem_points', value: 0 },
          { key: 'redeem_amount', value: 0 },
          { key: 'loyalty_redeem_blocked', value: 'yes' },
        ], manager);
        return {
          success: false,
          message: 'Loyalty redemption is not allowed for this order.',
          data: {
            order_id: publicOrderId(payload.order_id, order.order_number || order.client_order_id),
            order_total: roundMoney(Number(order.total) || 0),
            contact,
            redeem_points: 0,
            redeem_amount: 0,
          },
        };
      }
      const existingPoints = Number(metaValue(order, 'redeem_points')) || 0;
      if (existingPoints > 0) {
        throw fail(400, 'already_redeemed', `Loyalty points have already been redeemed for this order. (Previously Redeemed Points: ${existingPoints})`);
      }
      if (!(settings.ratioDollar > 0)) {
        throw fail(400, 'invalid_credit_unit', `Invalid "Dollar" setting detected. Please set a valid value in Loyalty Settings. (Current: ${settings.ratioDollar})`);
      }
      if (!(settings.ratioPoint > 0)) {
        throw fail(400, 'invalid_credit_point', `Invalid "Point per dollar" setting detected. Please set a valid value in Loyalty Settings. (Current: ${settings.ratioPoint})`);
      }
      if (!(settings.redeemPoint > 0)) {
        throw fail(400, 'invalid_point_unit', `Invalid "Points per Unit" setting detected. Please set a valid value in Loyalty Settings. (Current: ${settings.redeemPoint})`);
      }
      if (!(settings.redeemAmount > 0)) {
        throw fail(400, 'invalid_amount_unit', `Invalid "Amount per Unit" setting detected. Please set a valid value in Loyalty Settings. (Current: ${settings.redeemAmount})`);
      }
      const amount = Number.isFinite(redeemAmount) ? redeemAmount : 0;
      const nextLines = upsertLoyaltyLine(lines, loyaltyProduct, amount, order.order_id);
      const priced = priceOrder(order, nextLines);
      order.line_items = nextLines;
      order.status = 'pending';
      order.subtotal = priced.subtotal;
      order.discount_total = priced.discountTotal;
      order.fee_total = priced.feeTotal;
      order.tax_total = priced.taxTotal;
      order.total = priced.total;
      await this.loyalty.saveOrder(order, manager);
      await this.loyalty.replaceCanonicalLines(order.order_id, nextLines as Array<Record<string, unknown>>, manager);
      const customer = await this.customerForOrder(scope, order, contact, manager);
      if (customer && redeemPoints > 0) {
        await this.loyalty.insertRedeem(scope, {
          customerId: customer.id,
          contact,
          orderId: order.order_id,
          clientOrderId: order.client_order_id,
          redeemedPoints: redeemPoints,
        }, manager);
        await this.recalculate(scope, customer.id, manager);
      }
      const available = customer ? await this.availablePoints(scope, customer.id, manager) : 0;
      await this.putOrderMeta(order, [
        { key: 'contact', value: contact },
        { key: 'redeem_points', value: redeemPoints },
        { key: 'redeem_amount', value: amount },
        { key: 'new_net_pay_amt', value: priced.total },
      ], manager);
      return {
        success: true,
        message: 'Loyalty points redeemed successfully.',
        data: {
          order_id: publicOrderId(payload.order_id, order.order_number || order.client_order_id),
          order_total: priced.total,
          contact,
          redeem_amount: amount,
          used_points: redeemPoints,
          available_points: available,
        },
      };
    });
  }

  async removePoints(body: Record<string, unknown> | undefined, scope: LoyaltyScope) {
    await this.assertEnabled(scope);
    const payload = jsonBody(body);
    const contact = requiredContact(payload.contact, 'Please enter email or mobile number.');
    return this.loyalty.transaction(async (manager) => {
      const order = await this.requireOpenOrder(scope, payload.order_id, manager, 'remove');
      const orderContact = String(metaValue(order, 'contact') || '');
      if (orderContact && orderContact !== contact) {
        throw fail(400, 'contact_mismatch', `Contact mismatch. Order #${publicOrderId(payload.order_id)} belongs to ${orderContact}, not ${contact}.`);
      }
      const settings = await this.settings(scope, manager);
      const products = flattenCatalog(await this.loyalty.catalog(scope, manager));
      const loyaltyProduct = findNamedProduct(products, 'loyalty', settings.loyaltyProductIds);
      const redeemPoints = Number(metaValue(order, 'redeem_points')) || 0;
      const customer = await this.customerForOrder(scope, order, contact, manager);
      if (customer && redeemPoints > 0) {
        await this.loyalty.deleteOrderRedemption(scope, customer.id, order.order_id, manager);
        await this.recalculate(scope, customer.id, manager);
      }
      const nextLines = asLines(order.line_items).filter((line) => !isLoyaltyLine(line, loyaltyProduct?.id));
      const priced = priceOrder(order, nextLines);
      order.line_items = nextLines;
      order.subtotal = priced.subtotal;
      order.discount_total = priced.discountTotal;
      order.fee_total = priced.feeTotal;
      order.tax_total = priced.taxTotal;
      order.total = priced.total;
      if ((await this.loyalty.paymentCount(order.order_id, manager)) === 0) order.status = 'processing';
      await this.loyalty.saveOrder(order, manager);
      await this.loyalty.replaceCanonicalLines(order.order_id, nextLines as Array<Record<string, unknown>>, manager);
      await this.removeOrderMeta(order, ['redeem_points', 'redeem_amount', 'new_net_pay_amt'], manager);
      return {
        success: true,
        message: 'points removed returned successfully.',
        data: {
          order_id: publicOrderId(payload.order_id, order.order_number || order.client_order_id),
          contact,
          order_total: priced.total,
        },
      };
    });
  }

  async allCustomers(scope: LoyaltyScope) {
    // Customer balances/history remain viewable even when the loyalty
    // program is disabled. The disabled flag should block earning/redeeming,
    // not hide previously stored customers from the administrator.
    await this.loyalty.ensure();
    const customers = await this.loyalty.customersWithContact(scope);
    const data = [];
    for (const customer of customers) {
      const meta = await this.loyalty.readMeta(customer.id);
      const transactions = await this.loyalty.ledgerForCustomer(scope, customer.id);
      data.push({
        user_id: customer.id,
        name: customer.name,
        contact: customer.contact,
        credited: Number(meta.pinaka_total_credited) || 0,
        redeemed: Number(meta.pinaka_total_redeemed) || 0,
        expired: Number(meta.pinaka_total_expired) || 0,
        available: Number(meta.pinaka_available_points) || 0,
        last_updated: formatDate(meta.pinaka_last_updated || customer.created_at),
        transactions: transactions.map((row) => ({
          order_id: publicOrderId(row.client_order_id, row.order_number || row.order_id),
          credited_points: Number(row.credited_points) || 0,
          redeemed_points: Number(row.redeemed_points) || 0,
          expired_points: Number(row.expired_points) || 0,
          points_status: String(row.points_status || ''),
          points_created_date: formatDate(row.points_created_date),
          points_expiry_date: formatDate(row.points_expiry_date),
          order_redeem_points: Number(row.order_redeem_points) || 0,
        })),
      });
    }
    return { success: true, total_customers: data.length, data };
  }

  async getSettings(scope: LoyaltyScope) {
    // Administrators must be able to read and configure settings before the
    // loyalty feature is enabled.
    await this.loyalty.ensure();
    return { success: true, data: presentSettings(await this.settings(scope)) };
  }

  async updateSettings(body: Record<string, unknown> | undefined, scope: LoyaltyScope) {
    // Settings must be editable while the feature is disabled so an
    // administrator can configure and enable the loyalty program.
    await this.loyalty.ensure();
    const payload = jsonBody(body);
    const validated = validateSettingsUpdate(payload);
    if ('code' in validated) throw fail(400, validated.code, validated.message);
    const current = await this.loyalty.readConfig(scope, 'store_loyalty');
    const stored = storedSettingsPatch(validated.settings, current);
    await this.loyalty.saveLoyaltyConfig(scope, stored);
    return {
      success: true,
      message: 'Loyalty settings updated successfully.',
      data: presentSettings(settingsFromStored(stored)),
    };
  }

  async expirePartialRefund(input: {
    merchantId: string;
    storeId: string;
    orderId: string;
    refundId: string;
    refundTotal: number;
    items: Array<{ orderItemId: string }>;
  }): Promise<void> {
    const scope = { merchantId: input.merchantId, storeId: input.storeId };
    await this.loyalty.transaction(async (manager) => {
      const order = await this.loyalty.lockOrder(scope, input.orderId, manager);
      if (!order) return;
      const customerId = String(metaValue(order, 'loyaltyuser_id') || '');
      if (!customerId) return;
      const customer = await this.loyalty.findCustomerById(scope, customerId, manager);
      if (!customer) return;
      const settings = await this.settings(scope, manager);
      const stored = await this.loyalty.readConfig(scope, 'store_loyalty', manager);
      const ratioDollar = stored.pinaka_loyalty_ratio_dollar === undefined ? undefined : Number(stored.pinaka_loyalty_ratio_dollar);
      const ratioPoint = stored.pinaka_loyalty_ratio_point === undefined ? undefined : Number(stored.pinaka_loyalty_ratio_point);
      const selected = new Set(input.items.map((item) => item.orderItemId));
      let lines = asLines(order.line_items);
      const canonical = await this.loyalty.canonicalLines(order.order_id, manager);
      const credited = selected.size
        ? [...selected].map((itemId) => creditedPoints(lines, canonical, itemId))
        : [];
      if (settings.mode === 'item') {
        lines = lines.map((line) => line.id && selected.has(String(line.id))
          ? withLineMeta(line, '_credited_loyalty_points', 0)
          : line);
        order.line_items = lines;
        await this.loyalty.saveOrder(order, manager);
        for (const itemId of selected) {
          const canonicalLine = canonical.find((line) => line.id === itemId);
          const snapshot = lines.find((line) => String(line.id) === itemId);
          const modifiers = snapshot?.meta_data || withLineMeta({ modifiers: asMeta(canonicalLine?.modifiers) }, '_credited_loyalty_points', 0).meta_data;
          await this.loyalty.updateLineModifiers(order.order_id, itemId, modifiers, manager);
        }
      }
      const meta = await this.loyalty.readMeta(customer.id, manager);
      const expired = partialRefundExpiredPoints({
        mode: settings.mode,
        creditedPoints: credited,
        refundTotal: input.refundTotal,
        ratioDollar: Number.isFinite(ratioDollar) ? ratioDollar : undefined,
        ratioPoint: Number.isFinite(ratioPoint) ? ratioPoint : undefined,
        availablePoints: Number(meta.pinaka_available_points) || 0,
      });
      if (expired <= 0) return;
      const inserted = await this.loyalty.insertExpired(scope, {
        customerId: customer.id,
        contact: String(metaValue(order, 'contact') || meta.contact || ''),
        orderId: order.order_id,
        clientOrderId: order.client_order_id,
        expiredPoints: expired,
        refundId: input.refundId,
      }, manager);
      if (inserted) await this.recalculate(scope, customer.id, manager);
    });
  }

  async onPaymentVoid(scope: LoyaltyScope & { orderId: string }): Promise<void> {
    if (!scope.orderId) return;
    await this.loyalty.transaction(async (manager) => {
      const order = await this.loyalty.lockOrder(scope, scope.orderId, manager);
      if (!order) return;
      const payments = await this.loyalty.payments(scope, order.order_id, manager);
      const voided = payments.some((payment) => paymentIsVoid(payment));
      const amountPaid = payments.reduce((sum, payment) => (
        String(payment.entry_type || 'payment').toLowerCase() === 'payment' && !paymentIsVoid(payment)
          ? sum + Number(payment.amount || 0)
          : sum
      ), 0);
      const net = metaValue(order, 'new_net_pay_amt');
      const legacyNet = metaValue(order, 'new_netpay_amt');
      const orderTotal = net !== undefined && net !== null && net !== ''
        ? Number(net)
        : legacyNet !== undefined && legacyNet !== null && legacyNet !== ''
          ? Number(legacyNet)
          : Number(order.total) || 0;
      if (!shouldClearLedgerAfterVoid({ voided, amountPaid, orderTotal })) return;
      const customers = await this.loyalty.deleteOrderLedger(scope, order.order_id, order.client_order_id, manager);
      for (const customerId of customers) await this.recalculate(scope, customerId, manager);
    });
  }

  async creditCompletedOrder(scope: LoyaltyScope & { orderId: string }): Promise<void> {
    await this.loyalty.transaction(async (manager) => {
      await this.creditOrder(scope, scope.orderId, manager);
    });
  }

  private async creditCustomerHistory(scope: LoyaltyScope, customer: CustomerRow, contact: string, manager: EntityManager): Promise<void> {
    const orderIds = await this.loyalty.completedUncreditedOrderIds(scope, customer.id, contact, manager);
    for (const orderId of orderIds) await this.creditOrder(scope, orderId, manager, customer);
  }

  private async availablePoints(scope: LoyaltyScope, customerId: string, manager?: EntityManager): Promise<number> {
    const totals = await this.loyalty.ledgerTotals(scope, customerId, manager);
    return availableFromLedger(totals.credited, totals.redeemed, totals.expired);
  }

  private async creditOrder(scope: LoyaltyScope, orderId: string, manager: EntityManager, preferred?: CustomerRow): Promise<void> {
    const flags = await this.loyalty.readConfig(scope, 'store_loyalty', manager);
    if (flags.enable_loyalty_points !== 'yes') return;
    const order = await this.loyalty.lockOrder(scope, orderId, manager);
    if (!order || !orderIsCompleted(order.status, order.order_status)) return;
    const customer = await this.customerForCompletedOrder(scope, order, manager) || preferred;
    if (!customer) return;
    if (await this.loyalty.hasOrderCredit(scope, customer.id, order.order_id, manager)) return;
    const settings = await this.settings(scope, manager);
    const lines = asLines(order.line_items);
    const loyaltyReduction = lines.filter((line) => isLoyaltyLine(line)).reduce((sum, line) => {
      const total = Number(line.total ?? line.subtotal);
      return sum + (Number.isFinite(total) && total < 0 ? Math.abs(total) : 0);
    }, 0);
    let earnBase = Number(order.total);
    if (!(earnBase > 0)) earnBase = Number(order.grand_total);
    if (!Number.isFinite(earnBase)) earnBase = 0;
    earnBase += loyaltyReduction;
    if (settings.minSpend > 0 && earnBase < settings.minSpend) return;
    let points = 0;
    if (settings.mode === 'item') {
      const products = flattenCatalog(await this.loyalty.catalog(scope, manager));
      const creditedLines = lines.map((line) => {
        if (isLoyaltyLine(line)) return line;
        const earned = Math.floor(taggedItemPoints([line], products));
        return earned > 0 ? withLineMeta(line, '_credited_loyalty_points', earned) : line;
      });
      points = creditedLines.reduce((sum, line) => sum + Math.trunc(Number(lineMeta(line, '_credited_loyalty_points')) || 0), 0);
      if (points > 0) await this.loyalty.updateLineItems(order.order_id, creditedLines, manager);
    } else {
      points = earnedOrderPoints(earnBase, settings.ratioDollar, settings.ratioPoint);
    }
    if (points <= 0) return;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Math.max(0, settings.expiryDays || 0));
    const inserted = await this.loyalty.insertCredit(scope, {
      customerId: customer.id,
      contact: orderContact(order) || customer.email || customer.mobile || '',
      orderId: order.order_id,
      clientOrderId: order.client_order_id,
      creditedPoints: points,
      expiresAt,
    }, manager);
    if (inserted) await this.recalculate(scope, customer.id, manager);
  }

  private async customerForCompletedOrder(scope: LoyaltyScope, order: OrderRow, manager: EntityManager): Promise<CustomerRow | undefined> {
    const linked = String(metaValue(order, 'loyaltyuser_id') || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(linked)) {
      const customer = await this.loyalty.findCustomerById(scope, linked, manager);
      if (customer) return customer;
    }
    const contact = orderContact(order);
    if (!contact) return undefined;
    const email = isEmailContact(contact);
    const existing = await this.loyalty.findCustomer(scope, contact, email, manager);
    if (existing) return existing;
    const created = await this.loyalty.insertCustomer(scope, {
      name: loyaltyCustomerName(contact, email),
      email: email ? contact : null,
      mobile: email ? null : contact,
      username: loyaltyUsername(contact, email),
    }, manager);
    await this.loyalty.writeMeta(created.id, {
      contact,
      ...(email ? { billing_email: contact } : { billing_phone: contact }),
    }, manager);
    return created;
  }

  private async recalculate(scope: LoyaltyScope, customerId: string, manager: EntityManager): Promise<void> {
    const totals = await this.loyalty.ledgerTotals(scope, customerId, manager);
    const today = new Date().toISOString().slice(0, 10);
    await this.loyalty.writeMeta(customerId, {
      pinaka_total_credited: totals.credited,
      pinaka_total_redeemed: totals.redeemed,
      pinaka_total_expired: totals.expired,
      pinaka_available_points: availableFromLedger(totals.credited, totals.redeemed, totals.expired),
      pinaka_last_updated: today,
    }, manager);
  }

  private async assertEnabled(scope: LoyaltyScope): Promise<LoyaltySettings> {
    await this.loyalty.ensure();
    const flags = await this.loyalty.readConfig(scope, 'store_loyalty');
    if (flags.enable_loyalty_points !== 'yes') {
      throw fail(403, 'loyalty_disabled', 'The Loyalty Points system is currently disabled by the administrator.');
    }
    return this.settings(scope);
  }

  private async settings(scope: LoyaltyScope, manager?: EntityManager): Promise<LoyaltySettings> {
    const stored = await this.loyalty.readConfig(scope, 'store_loyalty', manager);
    return { ...defaultLoyaltySettings(), ...settingsFromStored(stored) };
  }

  private async requireOpenOrder(scope: LoyaltyScope, orderId: unknown, manager: EntityManager, action: 'redeem' | 'remove'): Promise<OrderRow> {
    const key = String(orderId ?? '').trim();
    if (!key) throw fail(404, 'invalid_order', 'The provided Order ID does not exist in WooCommerce orders.');
    const order = await this.loyalty.lockOrder(scope, key, manager);
    if (!order) throw fail(404, 'invalid_order', 'The provided Order ID does not exist in WooCommerce orders.');
    if (closedOrderStatus(order.status) || closedOrderStatus(order.order_status)) {
      const status = String(order.status || order.order_status || '').replace(/^wc-/, '');
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      const verb = action === 'remove' ? 'remove' : 'redeem';
      throw fail(400, 'invalid_order_status', `Cannot ${verb} points for an order that is already ${label}.`);
    }
    return order;
  }

  private async customerForOrder(scope: LoyaltyScope, order: OrderRow, contact: string, manager: EntityManager): Promise<CustomerRow | undefined> {
    const linked = String(metaValue(order, 'loyaltyuser_id') || '');
    if (linked) {
      const customer = await this.loyalty.findCustomerById(scope, linked, manager);
      if (customer) return customer;
    }
    return this.loyalty.findCustomer(scope, contact, isEmailContact(contact), manager);
  }

  private async putOrderMeta(order: OrderRow, entries: Array<{ key: string; value: unknown }>, manager: EntityManager): Promise<void> {
    const current = asMeta(order.meta_data);
    for (const entry of entries) {
      const index = current.findIndex((item) => item.key === entry.key);
      if (index >= 0) current[index] = entry;
      else current.push(entry);
    }
    order.meta_data = current;
    order.metadata = current;
    await this.loyalty.saveOrder(order, manager);
    await this.loyalty.saveOrderMeta(order.order_id, entries, manager);
  }

  private async removeOrderMeta(order: OrderRow, keys: string[], manager: EntityManager): Promise<void> {
    const current = asMeta(order.meta_data).filter((entry) => !keys.includes(entry.key));
    order.meta_data = current;
    order.metadata = current;
    await this.loyalty.saveOrder(order, manager);
    await this.loyalty.deleteOrderMeta(order.order_id, keys, manager);
  }
}

function jsonBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'invalid_body', 'JSON body is required.');
  return body;
}

function requiredContact(value: unknown, message: string): string {
  const contact = String(value ?? '').trim();
  if (!contact) throw fail(400, 'invalid_contact', message);
  return contact;
}

function fail(status: number, code: string, message: string): HttpException {
  const Exception = status === 403 ? ForbiddenException : status === 404 ? NotFoundException : BadRequestException;
  return new Exception({ code, message, data: { status } });
}

function metaValue(order: OrderRow, key: string): unknown {
  return asMeta(order.meta_data).find((entry) => entry.key === key)?.value;
}

function orderContact(order: OrderRow): string {
  for (const key of ['contact', 'billing_email', 'billing_phone']) {
    const value = String(metaValue(order, key) || '').trim();
    if (value) return value;
  }
  const phone = String(order.customer_phone || '').trim();
  if (phone) return phone;
  const payload = order.request_payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const billing = record.billing && typeof record.billing === 'object' ? record.billing as Record<string, unknown> : {};
  const email = String(billing.email || record.billing_email || '').trim();
  if (email) return email;
  return String(billing.phone || record.billing_phone || record.customer_phone || '').trim();
}

function asMeta(value: unknown): Array<{ key: string; value: unknown }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({ key: String((entry as { key?: unknown })?.key || ''), value: (entry as { value?: unknown })?.value }))
    .filter((entry) => entry.key);
}

function creditedPoints(lines: OrderLine[], canonical: Array<{ id: string; modifiers: unknown }>, itemId: string): number {
  const snapshot = lines.find((line) => String(line.id || '') === itemId);
  const fromSnapshot = snapshot ? lineMeta(snapshot, '_credited_loyalty_points') : undefined;
  if (fromSnapshot !== undefined && fromSnapshot !== null && fromSnapshot !== '') return Number(fromSnapshot) || 0;
  const stored = canonical.find((line) => line.id === itemId);
  const modifiers = Array.isArray(stored?.modifiers) ? stored.modifiers as Array<{ key?: string; value?: unknown }> : [];
  return Number(modifiers.find((entry) => entry?.key === '_credited_loyalty_points')?.value) || 0;
}

function asLines(value: unknown): OrderLine[] {
  return Array.isArray(value) ? value as OrderLine[] : [];
}

function couponCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((coupon) => String((coupon as { code?: unknown })?.code || '').trim()).length;
}

function upsertLoyaltyLine(lines: OrderLine[], product: CatalogProduct, amount: number, orderId: string): OrderLine[] {
  const next = lines.map((line) => ({ ...line }));
  const index = next.findIndex((line) => isLoyaltyLine(line, product.id));
  const loyalty: OrderLine = {
    ...(index >= 0 ? next[index] : { id: `LOYALTY-${orderId}`.slice(0, 100) }),
    product_id: product.id,
    name: 'Loyalty',
    quantity: 1,
    subtotal: -amount,
    total: -amount,
    meta_data: index >= 0 ? next[index].meta_data : [],
  };
  if (index >= 0) next[index] = loyalty;
  else next.push(loyalty);
  return next;
}

function isLoyaltyLine(line: OrderLine, productId?: string): boolean {
  const name = String(line.name || '').trim().toLowerCase();
  const id = String(line.product_id ?? line.productId ?? '');
  return name === 'loyalty' || (Boolean(productId) && id === productId);
}

function priceOrder(order: OrderRow, lines: OrderLine[]): {
  subtotal: number;
  discountTotal: number;
  feeTotal: number;
  taxTotal: number;
  total: number;
} {
  const places = 2;
  const saleLines = lines as PosLineItem[];
  const feeLines = (Array.isArray(order.fee_lines) ? order.fee_lines : []) as PosFeeLine[];
  const couponLines = Array.isArray(order.coupon_lines) ? order.coupon_lines : [];
  const payload = order.request_payload && typeof order.request_payload === 'object'
    ? order.request_payload as Record<string, unknown>
    : {};
  const shipping = Number(payload.shipping_total ?? payload.shippingTotal ?? 0);
  const subtotal = sumLineSubtotals(saleLines, places);
  const lineTotal = sumLineTotals(saleLines, places);
  const feeTotal = effectiveFeeTotal(feeLines, places);
  const taxTotal = Number(order.tax_total) || 0;
  const net = fromMinor(toMinor(lineTotal, places) + toMinor(feeTotal, places) + toMinor(shipping, places), places);
  return {
    subtotal,
    discountTotal: calculateDiscountTotal(saleLines, couponLines, feeLines),
    feeTotal,
    taxTotal,
    total: orderTotalWithTax({ netBeforeTax: net, tax: taxTotal, decimalPlaces: places }),
  };
}
