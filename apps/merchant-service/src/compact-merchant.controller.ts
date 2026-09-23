import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
 
const fields = [
  'merchantName', 'merchantEmail', 'merchantPhoneNumber', 'businessName', 'businessDisplayName',
  'storeTypeId', 'initialStatus', 'addressLine1', 'addressLine2', 'city', 'state', 'pinCode',
  'country', 'planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice',
  'roleIds', 'tax', 'totalDueToday', 'paymentMethod',
] as const;
const required = [
  'merchantName', 'merchantEmail', 'merchantPhoneNumber', 'businessName',
  'businessDisplayName', 'storeTypeId', 'initialStatus', 'addressLine1', 'city', 'state',
  'pinCode', 'country', 'planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice',
] as const;
type Input = Record<string, unknown>;
 
@Controller('api/v1/merchants')
export class CompactMerchantController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
 
  private get db() { return this.repository.requireDataSource(); }
 
  private validate(input: Input, create: boolean): Input {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Provide a merchant object');
    const allowed = new Set<string>(fields);
    const unknown = Object.keys(input).filter(key => !allowed.has(key));
    if (unknown.length) throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    if (create) {
      const missing = required.filter(key => input[key] === undefined || input[key] === null || input[key] === '');
      if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
    }
    if (input.merchantEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.merchantEmail))) throw new BadRequestException('Invalid merchantEmail');
    if (input.planId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.planId))) throw new BadRequestException('Invalid planId');
    if (input.roleIds !== undefined && !Array.isArray(input.roleIds)) throw new BadRequestException('roleIds must be an array');
    if (input.storeTypeId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.storeTypeId))) throw new BadRequestException('Invalid storeTypeId');
    if ((input.roleIds as unknown[] | undefined)?.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id)))) throw new BadRequestException('Every roleIds entry must be a UUID');
    for (const key of ['startDate', 'renewalDate']) if (input[key] !== undefined) {
      const value = String(input[key]);
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${key} must be a valid YYYY-MM-DD date`);
    }
    if (input.startDate && input.renewalDate && String(input.renewalDate) <= String(input.startDate)) throw new BadRequestException('renewalDate must be after startDate');
    for (const key of ['agreementPrice', 'tax', 'totalDueToday']) if (input[key] !== undefined && (input[key] === null || !Number.isFinite(Number(input[key])) || Number(input[key]) < 0)) throw new BadRequestException(`${key} must be a non-negative number`);
    if (input.billingCycle !== undefined && !['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(String(input.billingCycle))) throw new BadRequestException('Invalid billingCycle');
    for (const key of required) if (key !== 'planId' && key !== 'agreementPrice' && key !== 'startDate' && key !== 'renewalDate' && input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim())) throw new BadRequestException(`${key} must be a non-empty string`);
    return input;
  }
 
  private async planExists(manager: { query: (sql: string, parameters?: unknown[]) => Promise<any[]> }, id: unknown) {
    const rows = await manager.query('SELECT 1 FROM public.plans WHERE id=$1 AND status=$2', [id, 'ACTIVE']);
    if (!rows.length) throw new BadRequestException('Select an active planId');
  }
 
  private async resolveMasterIds(manager: { query: (sql: string, parameters?: unknown[]) => Promise<any[]> }, input: Input): Promise<Input> {
    const resolved = { ...input };
    if (input.storeTypeId !== undefined) {
      const rows = await manager.query(`SELECT id FROM public.store_types
        WHERE status='ACTIVE' AND id=$1::uuid`, [String(input.storeTypeId)]);
      if (!rows.length) throw new BadRequestException(`Unknown or inactive store type: ${input.storeTypeId}`);
      resolved.storeTypeId = rows[0].id;
    }
    if (input.roleIds !== undefined) {
      const names = (input.roleIds as unknown[]).map(String);
      const ids: string[] = [];
      for (const name of names) {
        const rows = await manager.query(`SELECT id FROM public.role_templates
          WHERE status='ACTIVE' AND id=$1::uuid`, [name]);
        if (!rows.length) throw new BadRequestException(`Unknown or inactive role: ${name}`);
        ids.push(rows[0].id);
      }
      resolved.roleIds = [...new Set(ids)];
    }
    return resolved;
  }
 
  private async getRecord(id: string) {
    const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(mp) AS plan, row_to_json(s) AS subscription
      FROM public.merchants m LEFT JOIN LATERAL (
        SELECT sub.*, row_to_json(sp) AS plan FROM public.subscriptions sub
        LEFT JOIN public.plans sp ON sp.id=sub.plan_id
        WHERE sub."merchantId"=m."merchantId" AND sub.status='ACTIVE'
        ORDER BY sub.created_at DESC LIMIT 1
      ) s ON true
      LEFT JOIN public.plans mp ON mp.id=m."planId"
      WHERE m."merchantId"=$1 AND m."initialStatus"='ACTIVE'`, [id]);
    if (!rows.length) throw new NotFoundException('Merchant not found');
    return rows[0];
  }
 
  @Post('create-merchant')
  async createFromOnboarding(@Body() body: Record<string, any>) {
    const merchant = body?.merchant;
    const subscription = body?.subscription;
    if (!merchant || !subscription) throw new BadRequestException('merchant and subscription are required');
    if (body.stores !== undefined && (!Array.isArray(body.stores) || body.stores.length)) {
      throw new BadRequestException('This endpoint creates a merchant and subscription; stores must be an empty array');
    }
    const requestedStoreType = merchant.storeTypeId;
    if (!requestedStoreType) throw new BadRequestException('merchant.storeTypeId is required');
    if (!subscription.planId) throw new BadRequestException('subscription.planId is required');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(String(requestedStoreType))) throw new BadRequestException('Invalid merchant.storeTypeId');
    if (!uuid.test(String(subscription.planId))) throw new BadRequestException('Invalid subscription.planId');
    const [storeType] = await this.db.query(
      `SELECT id FROM public.store_types WHERE status=$2 AND id=$1::uuid`,
      [String(requestedStoreType), 'ACTIVE'],
    );
    if (!storeType) throw new BadRequestException('Select an active merchant.storeTypeId');
    const [plan] = await this.db.query(
      'SELECT "basePrice" FROM public.plans WHERE id=$1 AND status=$2',
      [subscription.planId, 'ACTIVE'],
    );
    if (!plan) throw new BadRequestException('Select an active subscription.planId');
    const billingCycle = String(subscription.billingCycle || 'MONTHLY').toUpperCase();
    if (!['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(billingCycle)) throw new BadRequestException('Invalid subscription.billingCycle');
    const startDate = String(subscription.startDate || new Date().toISOString().slice(0, 10));
    const renewalDate = String(subscription.renewalDate || nextRenewalDate(startDate, billingCycle));
    const agreementPrice = subscription.agreementPrice ?? Number(plan.basePrice);
    const tax = merchant.tax ?? 0;
    return this.create({
      merchantName: merchant.name,
      merchantEmail: merchant.email,
      merchantPhoneNumber: merchant.phone,
      businessName: merchant.business,
      businessDisplayName: merchant.display,
      storeTypeId: storeType.id,
      initialStatus: merchant.initialStatus || 'ACTIVE',
      addressLine1: merchant.addressLine1,
      addressLine2: merchant.addressLine2,
      city: merchant.city,
      state: merchant.state,
      pinCode: merchant.postal,
      country: merchant.country,
      planId: subscription.planId,
      billingCycle,
      startDate,
      renewalDate,
      agreementPrice,
      roleIds: body.roleIds || [],
      tax,
      totalDueToday: merchant.totalDueToday ?? Number(agreementPrice) + Number(tax),
      paymentMethod: merchant.paymentMethod,
    });
  }
 
  @Post()
  async create(@Body() body: Input) {
    const input = this.validate(body, true);
    let merchantId = '';
    try {
      await this.db.transaction(async manager => {
        await this.planExists(manager, input.planId);
        const normalized = await this.resolveMasterIds(manager, input);
        const columns = fields.filter(key => normalized[key] !== undefined);
        const values = columns.map(key => key === 'roleIds' ? JSON.stringify(normalized[key]) : normalized[key]);
        const [generated] = await manager.query(`SELECT 'MER-' || lpad(nextval('public.merchant_id_seq')::text,6,'0') AS "merchantId"`);
        merchantId = generated.merchantId;
        await manager.query(`INSERT INTO public.merchant_identities("merchantId") VALUES($1)`, [merchantId]);
        await manager.query(`INSERT INTO public.merchants ("merchantId",${columns.map(key => `"${key}"`).join(',')}) VALUES ($1,${values.map((_, index) => `$${index + 2}`).join(',')})`, [merchantId, ...values]);
        await manager.query(`INSERT INTO public.subscriptions
          ("merchantId",plan_id,billing_cycle,start_date,renewal_date,agreement_price,status,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now(),now())`, [merchantId, normalized.planId, normalized.billingCycle, normalized.startDate, normalized.renewalDate, normalized.agreementPrice]);
      });
    } catch (error: any) {
      if ((error.driverError?.code || error.code) === '23505') {
        const constraint = error.driverError?.constraint || error.constraint;
        if (constraint === 'uq_merchants_merchant_email' || constraint === 'merchants_one_active_email_uq') throw new ConflictException('Merchant email already exists');
        if (constraint === 'PK_4fd312ef25f8e05ad47bfe7ed25' || constraint === 'merchants_pkey') throw new ConflictException('Merchant ID already exists');
        throw new ConflictException('Merchant conflicts with an existing record');
      }
      throw error;
    }
    return { success: true, ...(await this.getRecord(merchantId)) };
  }
 
  @Get()
  async list() {
    const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(mp) AS plan, row_to_json(s) AS subscription
      FROM public.merchants m LEFT JOIN LATERAL (
        SELECT sub.*, row_to_json(sp) AS plan FROM public.subscriptions sub
        LEFT JOIN public.plans sp ON sp.id=sub.plan_id
        WHERE sub."merchantId"=m."merchantId" AND sub.status='ACTIVE'
        ORDER BY sub.created_at DESC LIMIT 1
      ) s ON true LEFT JOIN public.plans mp ON mp.id=m."planId"
      WHERE m."initialStatus"='ACTIVE' ORDER BY m."merchantId"`);
    return { success: true, count: rows.length, merchants: rows };
  }
 
  @Get(':id')
  async get(@Param('id') id: string) { return { success: true, ...(await this.getRecord(id)) }; }
 
  @Get(':id/history')
  async history(@Param('id') id: string) {
    const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(p) AS plan
      FROM public.merchants m LEFT JOIN public.plans p ON p.id=m."planId"
      WHERE m."merchantId"=$1 ORDER BY m."createdDate" DESC`, [id]);
    if (!rows.length) throw new NotFoundException('Merchant not found');
    const subscriptions = await this.db.query(`SELECT sub.*,row_to_json(p) AS plan
      FROM public.subscriptions sub LEFT JOIN public.plans p ON p.id=sub.plan_id
      WHERE sub."merchantId"=$1 ORDER BY sub.created_at DESC`, [id]);
    return { success: true, count: rows.length, merchants: rows, subscriptions };
  }
 
  @Put(':id')
  async replace(@Param('id') id: string, @Body() body: Input) { return this.update(id, body, true); }
 
  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: Input) { return this.update(id, body, false); }
 
  private async update(id: string, body: Input, replace: boolean) {
    const input = this.validate(body, false);
    if (!Object.keys(input).length) throw new BadRequestException('Provide at least one field');
    if (replace) {
      const missing = required.filter(key => input[key] === undefined);
      if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
    }
    await this.db.transaction(async manager => {
      const [existing] = await manager.query('SELECT * FROM public.merchants WHERE "merchantId"=$1 AND "initialStatus"=$2 FOR UPDATE', [id, 'ACTIVE']);
      if (!existing) throw new NotFoundException('Merchant not found');
      if (input.planId !== undefined) await this.planExists(manager, input.planId);
      const normalized = await this.resolveMasterIds(manager, input);
      normalized.initialStatus = 'ACTIVE';
      await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',"updatedDate"=now() WHERE id=$1`, [existing.id]);
      const versionValues = fields.map(key => normalized[key] !== undefined ? normalized[key] : existing[key]);
      await manager.query(`INSERT INTO public.merchants
        ("merchantId",${fields.map(key => `"${key}"`).join(',')},"createdDate","updatedDate")
        VALUES($1,${fields.map((_,index) => `$${index+2}`).join(',')},now(),now())`,
        [id, ...versionValues.map((value,index) => fields[index] === 'roleIds' ? JSON.stringify(value) : value)]);
      if (['planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice'].some(key => input[key] !== undefined)) {
        const [current] = await manager.query(`SELECT * FROM public.subscriptions
          WHERE "merchantId"=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [id]);
        const planChanged = input.planId !== undefined && current && String(input.planId) !== String(current.plan_id);
        if (planChanged || !current) {
          if (current) await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now() WHERE "subscriptionId"=$1`, [current.subscriptionId]);
          await manager.query(`INSERT INTO public.subscriptions
            ("merchantId",plan_id,billing_cycle,start_date,renewal_date,agreement_price,status,created_at,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now(),now())`, [id, input.planId ?? current?.plan_id,
            input.billingCycle ?? current?.billing_cycle, input.startDate ?? current?.start_date,
            input.renewalDate ?? current?.renewal_date, input.agreementPrice ?? current?.agreement_price]);
        } else {
          await manager.query(`UPDATE public.subscriptions SET
            billing_cycle=COALESCE($2,billing_cycle),start_date=COALESCE($3,start_date),
            renewal_date=COALESCE($4,renewal_date),agreement_price=COALESCE($5,agreement_price),updated_at=now()
            WHERE "subscriptionId"=$1`, [current.subscriptionId, input.billingCycle ?? null,
            input.startDate ?? null, input.renewalDate ?? null, input.agreementPrice ?? null]);
        }
      }
    });
    return { success: true, ...(await this.getRecord(id)) };
  }
 
  @Patch(':id/status')
  async updateStatus(@Param('id') id:string, @Body() body:{initialStatus?:string}) {
    if (!body || !['ACTIVE','INACTIVE'].includes(String(body.initialStatus))) throw new BadRequestException('initialStatus must be ACTIVE or INACTIVE');
    await this.db.transaction(async manager=>{
      const [target]=await manager.query(`SELECT id,"merchantId" FROM public.merchants
        WHERE id::text=$1 OR "merchantId"=$1
        ORDER BY CASE WHEN id::text=$1 THEN 0 ELSE 1 END,"createdDate" DESC LIMIT 1 FOR UPDATE`,[id]);
      if (!target) throw new NotFoundException('Merchant not found');
      if (body.initialStatus==='ACTIVE') await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',"updatedDate"=now()
        WHERE "merchantId"=$1 AND "initialStatus"='ACTIVE' AND id<>$2`,[target.merchantId,target.id]);
      await manager.query(`UPDATE public.merchants SET "initialStatus"=$2,"updatedDate"=now() WHERE id=$1`,[target.id,body.initialStatus]);
      Object.assign(body,{merchantId:target.merchantId,rowId:target.id});
    });
    return {success:true,id:(body as any).rowId,merchantId:(body as any).merchantId,initialStatus:body.initialStatus};
  }
 
  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      const result = await this.db.query('DELETE FROM public.merchant_identities WHERE "merchantId"=$1 RETURNING "merchantId"', [id]);
      if (!result.length) throw new NotFoundException('Merchant not found');
      return { success: true, merchantId: id };
    } catch (error: any) {
      if ((error.driverError?.code || error.code) === '23503') throw new ConflictException('Merchant is referenced by other records');
      throw error;
    }
  }
}
 
function nextRenewalDate(startDate: string, billingCycle: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) {
    throw new BadRequestException('subscription.startDate must be a valid YYYY-MM-DD date');
  }
  const months = billingCycle === 'ANNUAL' ? 12 : billingCycle === 'QUARTERLY' ? 3 : 1;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const day = start.getUTCDate();
  const target = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}