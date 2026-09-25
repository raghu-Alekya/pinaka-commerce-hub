import { BadRequestException, Body, Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';

type Input = Record<string, unknown>;

@Controller([
  'api/v1/subscriptions/subscription-plan-changes',
  'connector/api/v1/subscriptions/subscription-plan-changes',
  'api/v1/subscription-plan-changes',
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

    const [subscription] = await this.db.query(
      `SELECT * FROM public.subscriptions WHERE "merchantId"=$1 AND status='ACTIVE' ORDER BY "createdAt" DESC NULLS LAST LIMIT 1`,
      [merchantKey],
    );
    if (!subscription) throw new NotFoundException('Active subscription not found');

    const [storeType] = await this.db.query(`SELECT id FROM public.store_types
      WHERE id::text=$1 OR name ILIKE $1
        OR COALESCE(to_jsonb(store_types)->>'storeTypeCode', to_jsonb(store_types)->>'store_type_code', '') ILIKE $1
      LIMIT 1`, [String(plan.storeTypeId || plan.store_type_id || plan.store_type || plan.storeType || '').trim() || '']);
    const storeTypeId = storeType?.id || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.storeTypeId || merchant.storeTypeId || '')) ? String(body.storeTypeId || merchant.storeTypeId) : undefined);
    const subColumns = await this.columnSet('subscriptions');
    await this.assign('subscriptions', subColumns, {
      planId: plan.id,
      planCode: plan.planCode || plan.plan_code || subscription.planCode,
      planName: plan.name || plan.planName || subscription.planName,
      billingCycle,
      price,
      startDate,
      renewalDate: renewalDate || subscription.renewalDate,
      storeTypeId,
      updatedAt: new Date(),
    }, subscription.id);

    const merchantColumns = await this.columnSet('merchants');
    await this.assign('merchants', merchantColumns, {
      planId: plan.id,
      billingCycle,
      startDate,
      renewalDate: renewalDate || merchant.renewalDate,
      agreementPrice: price,
      tax,
      totalDueToday,
      paymentMethod: body.paymentMethod || merchant.paymentMethod || 'CARD',
      updatedAt: new Date(),
    }, merchant.id);

    const [updated] = await this.db.query(`SELECT * FROM public.subscriptions WHERE id=$1`, [subscription.id]);
    return { success: true, merchantId: merchantKey, subscription: updated };
  }

  private async columnSet(table: string) {
    const rows = await this.db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [table],
    );
    return new Set(rows.map((row: { column_name: string }) => row.column_name));
  }

  private async assign(table: string, columns: Set<string>, values: Record<string, unknown>, id: string) {
    const keys = Object.keys(values).filter(key => columns.has(key) && values[key] != null);
    if (!keys.length) return;
    const params = keys.map(key => values[key]);
    const assignments = keys.map((key, index) => `"${key}"=$${index + 1}`).join(',');
    await this.db.query(`UPDATE public.${table} SET ${assignments} WHERE id=$${keys.length + 1}`, [...params, id]);
  }
}
