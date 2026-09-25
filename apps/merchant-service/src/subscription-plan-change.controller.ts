import { BadRequestException, Body, Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from './merchant.repository';

type Input = Record<string, unknown>;

@Controller([
  'api/v1/subscriptions/subscription-plan-changes',
  'connector/api/v1/subscriptions/subscription-plan-changes',
  'api/v1/subscription-plan-changes',
  'api/v1/api/v1/subscription-plan-changes',
  'connector/api/v1/subscription-plan-changes',
])
export class SubscriptionPlanChangeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  private get db() { return this.repository.requireDataSource(); }

  @Post()
  async change(@Body() body: Input) {
    const merchantId = String(body?.merchantId || '').trim();
    const planId = String(body?.planId || '').trim();
    if (!merchantId || !planId) throw new BadRequestException('merchantId and planId are required');
    const requestedCycle = String(body.billingCycle || 'MONTHLY').toUpperCase();
    const billingCycle = requestedCycle === 'YEARLY' ? 'ANNUAL' : requestedCycle;
    if (!['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(billingCycle)) throw new BadRequestException('Invalid billingCycle');
    const startDate = String(body.startDate || new Date().toISOString().slice(0, 10));
    const renewalDate = String(body.renewalDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('Invalid startDate');
    if (renewalDate && (!/^\d{4}-\d{2}-\d{2}$/.test(renewalDate) || renewalDate <= startDate)) throw new BadRequestException('renewalDate must be after startDate');

    const [merchant] = await this.db.query(
      `SELECT * FROM public.merchants m
       WHERE ("merchantId"=$1 OR "merchantCode"=$1 OR id::text=$1)
         AND COALESCE(m.status, 'ACTIVE') = 'ACTIVE'
       LIMIT 1`,
      [merchantId],
    );
    if (!merchant) throw new NotFoundException('Merchant not found');

    const [plan] = await this.db.query(`SELECT * FROM public.plans WHERE id::text=$1`, [planId]);
    if (!plan || String(plan.status || '').toUpperCase() !== 'ACTIVE') throw new BadRequestException('Select an active planId');

    const price = Number(body.agreementPrice ?? plan.basePrice ?? plan.base_price ?? plan.price ?? 0);
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException('agreementPrice must be a non-negative number');
    const tax = body.tax == null || body.tax === '' ? null : Number(body.tax);
    const totalDueToday = body.totalDueToday == null || body.totalDueToday === '' ? null : Number(body.totalDueToday);
    const merchantKey = String(merchant.merchantId || merchantId);
    const subColumns = await this.columnSet('subscriptions');
    const [storeType] = await this.db.query(`SELECT id FROM public.store_types
      WHERE id::text=$1 OR name ILIKE $1
        OR COALESCE(to_jsonb(store_types)->>'storeTypeCode', to_jsonb(store_types)->>'store_type_code', '') ILIKE $1
      LIMIT 1`, [String(plan.storeTypeId || plan.store_type_id || plan.store_type || plan.storeType || '').trim() || '']);
    const storeTypeId = storeType?.id || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.storeTypeId || merchant.storeTypeId || '')) ? String(body.storeTypeId || merchant.storeTypeId) : undefined);

    await this.db.query(
      `UPDATE public.subscriptions SET status='INACTIVE', "updatedAt"=now()
       WHERE status='ACTIVE' AND ("merchantId"=$1 OR "merchantId"=$2)`,
      [merchantKey, merchantId],
    );

    const id = `SUB-${randomUUID()}`;
    const features = plan.included_features || plan.includedFeatures || plan.entitlements || [];
    const planCode = plan.planCode || plan.plan_code || 'PRO';
    const planName = plan.name || plan.planName || 'Plan';
    await this.insert('subscriptions', subColumns, {
      id,
      subscriptionCode: id,
      subscriptionId: id,
      merchantId: merchantKey,
      merchant_id: merchantKey,
      planId: plan.id,
      plan_id: plan.id,
      planCode,
      plan_code: planCode,
      planName,
      plan_name: planName,
      billingCycle,
      billing_cycle: billingCycle,
      price,
      startDate,
      start_date: startDate,
      renewalDate: renewalDate || null,
      renewal_date: renewalDate || null,
      storeTypeId,
      status: 'ACTIVE',
      currency: plan.currency || 'USD',
      entitlements: JSON.stringify(features),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const merchantColumns = await this.columnSet('merchants');
    await this.assign('merchants', merchantColumns, {
      planId: plan.id,
      plan_id: plan.id,
      planName,
      plan_name: planName,
      billingCycle,
      billing_cycle: billingCycle,
      startDate,
      renewalDate: renewalDate || merchant.renewalDate,
      agreementPrice: price,
      tax,
      totalDueToday,
      paymentMethod: body.paymentMethod || merchant.paymentMethod || 'CARD',
      updatedAt: new Date(),
    }, merchant.id);

    const [created] = await this.db.query(`SELECT * FROM public.subscriptions WHERE id=$1`, [id]);
    return { success: true, merchantId: merchantKey, subscription: created };
  }

  private async columnSet(table: string) {
    const rows = await this.db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table],
    );
    return new Set(rows.map((row: { column_name: string }) => row.column_name));
  }

  private async insert(table: string, columns: Set<string>, values: Record<string, unknown>) {
    const keys = Object.keys(values).filter(key => columns.has(key) && values[key] != null);
    if (!keys.length) return;
    await this.db.query(
      `INSERT INTO public.${table} (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')})`,
      keys.map(key => values[key]),
    );
  }

  private async assign(table: string, columns: Set<string>, values: Record<string, unknown>, id: string) {
    const keys = Object.keys(values).filter(key => columns.has(key) && values[key] != null);
    if (!keys.length) return;
    const params = keys.map(key => values[key]);
    const assignments = keys.map((key, index) => `"${key}"=$${index + 1}`).join(',');
    await this.db.query(`UPDATE public.${table} SET ${assignments} WHERE id=$${keys.length + 1}`, [...params, id]);
  }
}
