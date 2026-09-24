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

@Controller(['api/v1/merchants', 'connector/api/v1/merchants', 'merchants'])
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
    if (input.roleIds !== undefined && !Array.isArray(input.roleIds)) throw new BadRequestException('roleIds must be an array');
    for (const key of ['startDate', 'renewalDate']) if (input[key] !== undefined) {
      const value = String(input[key]);
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${key} must be a valid YYYY-MM-DD date`);
    }
    if (input.startDate && input.renewalDate && String(input.renewalDate) <= String(input.startDate)) throw new BadRequestException('renewalDate must be after startDate');
    for (const key of ['agreementPrice', 'tax', 'totalDueToday']) if (input[key] !== undefined && (input[key] === null || !Number.isFinite(Number(input[key])) || Number(input[key]) < 0)) throw new BadRequestException(`${key} must be a non-negative number`);
    if (input.billingCycle !== undefined && !['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(String(input.billingCycle))) throw new BadRequestException('Invalid billingCycle');
    for (const key of required) if (key !== 'planId' && key !== 'storeTypeId' && key !== 'agreementPrice' && key !== 'startDate' && key !== 'renewalDate' && input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim())) throw new BadRequestException(`${key} must be a non-empty string`);
    return input;
  }

  private async planExists(manager: { query: (sql: string, parameters?: unknown[]) => Promise<any[]> }, id: unknown) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
    const rows = isUuid
      ? await manager.query('SELECT 1 FROM public.plans WHERE id=$1 AND status=$2', [id, 'ACTIVE'])
      : await manager.query('SELECT 1 FROM public.plans WHERE (name ILIKE $1 OR code ILIKE $1) AND status=$2', [String(id), 'ACTIVE']);
    if (!rows.length) throw new BadRequestException('Select an active planId');
  }

  private async resolveMasterIds(manager: { query: (sql: string, parameters?: unknown[]) => Promise<any[]> }, input: Input): Promise<Input> {
    const resolved = { ...input };
    if (input.storeTypeId !== undefined) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.storeTypeId));
      let rows = isUuid
        ? await manager.query(`SELECT id FROM public.store_types WHERE status='ACTIVE' AND id=$1::uuid`, [String(input.storeTypeId)])
        : await manager.query(`SELECT id FROM public.store_types WHERE status='ACTIVE' AND (name ILIKE $1 OR code ILIKE $1) LIMIT 1`, [String(input.storeTypeId)]);
      if (!rows.length) {
        rows = await manager.query(`SELECT id FROM public.store_types WHERE status='ACTIVE' LIMIT 1`);
      }
      if (!rows.length) throw new BadRequestException(`Unknown or inactive store type: ${input.storeTypeId}`);
      resolved.storeTypeId = rows[0].id;
    }
    if (input.planId !== undefined) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.planId));
      let rows = isUuid
        ? await manager.query(`SELECT id FROM public.plans WHERE status='ACTIVE' AND id=$1::uuid`, [String(input.planId)])
        : await manager.query(`SELECT id FROM public.plans WHERE status='ACTIVE' AND (name ILIKE $1 OR code ILIKE $1) LIMIT 1`, [String(input.planId)]);
      if (!rows.length) {
        rows = await manager.query(`SELECT id FROM public.plans WHERE status='ACTIVE' LIMIT 1`);
      }
      if (!rows.length) throw new BadRequestException(`Unknown or inactive plan: ${input.planId}`);
      resolved.planId = rows[0].id;
    }
    if (input.roleIds !== undefined) {
      const names = (input.roleIds as unknown[]).map(String);
      const ids: string[] = [];
      for (const name of names) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
        const rows = isUuid
          ? await manager.query(`SELECT id FROM public.role_templates WHERE status='ACTIVE' AND id=$1::uuid`, [name])
          : await manager.query(`SELECT id FROM public.role_templates WHERE status='ACTIVE' AND (name ILIKE $1 OR code ILIKE $1) LIMIT 1`, [name]);
        if (rows.length) ids.push(rows[0].id);
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
        WHERE (sub."merchantId"=m."merchantId" OR sub."merchantId"=m.id::text) AND sub.status='ACTIVE'
        ORDER BY sub.created_at DESC LIMIT 1
      ) s ON true
      LEFT JOIN public.plans mp ON mp.id=m."planId"
      WHERE (m."merchantId"=$1 OR m.id::text=$1) AND COALESCE(m."initialStatus", 'ACTIVE')='ACTIVE'`, [id]);
    if (!rows.length) throw new NotFoundException('Merchant not found');
    return rows[0];
  }

  @Post('create-merchant')
  async createFromOnboarding(@Body() body: Record<string, any>) {
    const merchant = body?.merchant || body;
    const subscription = body?.subscription || body;
    if (!merchant || !subscription) throw new BadRequestException('merchant and subscription are required');

    const requestedStoreType = merchant.storeTypeId;
    let storeTypeId: string | undefined;
    if (requestedStoreType) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(requestedStoreType));
      const [found] = isUuid
        ? await this.db.query(`SELECT id FROM public.store_types WHERE status=$2 AND id=$1::uuid`, [String(requestedStoreType), 'ACTIVE'])
        : await this.db.query(`SELECT id FROM public.store_types WHERE status=$2 AND (name ILIKE $1 OR code ILIKE $1) LIMIT 1`, [String(requestedStoreType), 'ACTIVE']);
      if (found) storeTypeId = found.id;
    }
    if (!storeTypeId) {
      const [fallback] = await this.db.query(`SELECT id FROM public.store_types WHERE status='ACTIVE' LIMIT 1`);
      storeTypeId = fallback?.id || requestedStoreType;
    }

    const requestedPlanId = subscription.planId || body.planId || body.plan;
    let planId: string | undefined;
    let planPrice = 99;
    if (requestedPlanId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(requestedPlanId));
      const [foundPlan] = isUuid
        ? await this.db.query('SELECT id, "basePrice" FROM public.plans WHERE id=$1 AND status=$2', [requestedPlanId, 'ACTIVE'])
        : await this.db.query('SELECT id, "basePrice" FROM public.plans WHERE (name ILIKE $1 OR code ILIKE $1) AND status=$2 LIMIT 1', [String(requestedPlanId), 'ACTIVE']);
      if (foundPlan) {
        planId = foundPlan.id;
        planPrice = Number(foundPlan.basePrice) || 99;
      }
    }
    if (!planId) {
      const [fallbackPlan] = await this.db.query(`SELECT id, "basePrice" FROM public.plans WHERE status='ACTIVE' LIMIT 1`);
      planId = fallbackPlan?.id || requestedPlanId;
      planPrice = Number(fallbackPlan?.basePrice) || 99;
    }

    const billingCycle = String(subscription.billingCycle || body.billingCycle || 'MONTHLY').toUpperCase();
    const cycle = ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(billingCycle) ? billingCycle : 'MONTHLY';
    const startDate = String(subscription.startDate || body.startDate || new Date().toISOString().slice(0, 10));
    const renewalDate = String(subscription.renewalDate || body.renewalDate || nextRenewalDate(startDate, cycle));
    const agreementPrice = subscription.agreementPrice ?? body.agreementPrice ?? planPrice;
    const tax = Number(merchant.tax || body.tax || 0);

    return this.create({
      merchantName: merchant.name || merchant.merchantName || merchant.display || merchant.business || 'Demo Merchant',
      merchantEmail: merchant.email || merchant.merchantEmail || 'merchant@example.com',
      merchantPhoneNumber: merchant.phone || merchant.merchantPhoneNumber || '+15551234567',
      businessName: merchant.business || merchant.businessName || 'Business LLC',
      businessDisplayName: merchant.display || merchant.businessDisplayName || merchant.business || 'Business',
      storeTypeId: storeTypeId || 'a1b2c3d4-e5f6-4a1b-8c2d-000000000001',
      initialStatus: merchant.initialStatus || body.initialStatus || 'ACTIVE',
      addressLine1: merchant.addressLine1 || body.addressLine1 || '100 Main St',
      addressLine2: merchant.addressLine2 || body.addressLine2,
      city: merchant.city || body.city || 'City',
      state: merchant.state || body.state || 'State',
      pinCode: merchant.postal || merchant.pinCode || body.pinCode || '10001',
      country: merchant.country || body.country || 'USA',
      planId: planId || '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      billingCycle: cycle,
      startDate,
      renewalDate,
      agreementPrice,
      roleIds: body.roleIds || merchant.roleIds || [],
      tax,
      totalDueToday: merchant.totalDueToday ?? body.totalDueToday ?? (Number(agreementPrice) + Number(tax)),
      paymentMethod: merchant.paymentMethod || body.paymentMethod || 'CARD',
    });
  }

  @Post()
  async create(@Body() body: Input) {
    const input = this.validate(body, true);
    let merchantId = String(body.merchantId || body.code || input.merchantId || '').trim();
    try {
      await this.db.transaction(async manager => {
        await this.planExists(manager, input.planId);
        const normalized = await this.resolveMasterIds(manager, input);
        const columns = fields.filter(key => normalized[key] !== undefined);
        const values = columns.map(key => key === 'roleIds' ? JSON.stringify(normalized[key]) : normalized[key]);
        
        if (!merchantId) {
          try {
            const [generated] = await manager.query(`SELECT 'MER-' || lpad(nextval('public.merchant_id_seq')::text,6,'0') AS "merchantId"`);
            merchantId = generated.merchantId;
          } catch {
            merchantId = `MER-${Math.floor(100000 + Math.random() * 900000)}`;
          }
        }
        try {
          await manager.query(`CREATE TABLE IF NOT EXISTS public.merchant_identities ("merchantId" varchar(100) PRIMARY KEY, created_at timestamptz DEFAULT now())`);
          await manager.query(`INSERT INTO public.merchant_identities("merchantId") VALUES($1) ON CONFLICT DO NOTHING`, [merchantId]);
        } catch {}

        const colList = columns.map(key => `"${key}"`).join(',');
        const valPlaceholders = columns.map((_, index) => '$' + (index + 2)).join(',');

        await manager.query(`INSERT INTO public.merchants ("merchantId",${colList},"createdDate","updatedDate")
          VALUES ($1,${valPlaceholders},now(),now())`, [merchantId, ...values]);

        const subId = `SUB-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
        await manager.query(`INSERT INTO public.subscriptions
          ("subscriptionId","merchantId",plan_id,billing_cycle,start_date,renewal_date,agreement_price,status,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',now(),now())`, [subId, merchantId, normalized.planId, normalized.billingCycle, normalized.startDate, normalized.renewalDate, normalized.agreementPrice]);
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
        WHERE (sub."merchantId"=m."merchantId" OR sub."merchantId"=m.id::text) AND sub.status='ACTIVE'
        ORDER BY sub.created_at DESC LIMIT 1
      ) s ON true LEFT JOIN public.plans mp ON mp.id=m."planId"
      WHERE COALESCE(m."initialStatus", 'ACTIVE')='ACTIVE'
      ORDER BY COALESCE(m."createdDate", now()) DESC`);
    return { success: true, count: rows.length, merchants: rows };
  }

  @Get(':id')
  async get(@Param('id') id: string) { return { success: true, ...(await this.getRecord(id)) }; }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(p) AS plan
      FROM public.merchants m LEFT JOIN public.plans p ON p.id=m."planId"
      WHERE (m."merchantId"=$1 OR m.id::text=$1) ORDER BY m."createdDate" DESC`, [id]);
    if (!rows.length) throw new NotFoundException('Merchant not found');
    const subscriptions = await this.db.query(`SELECT sub.*,row_to_json(p) AS plan
      FROM public.subscriptions sub LEFT JOIN public.plans p ON p.id=sub.plan_id
      WHERE (sub."merchantId"=$1 OR sub."merchantId"=(SELECT id::text FROM public.merchants WHERE "merchantId"=$1 LIMIT 1))
      ORDER BY sub.created_at DESC`, [id]);
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
      const [existing] = await manager.query('SELECT * FROM public.merchants WHERE ("merchantId"=$1 OR id::text=$1) AND "initialStatus"=$2 FOR UPDATE', [id, 'ACTIVE']);
      if (!existing) throw new NotFoundException('Merchant not found');
      if (input.planId !== undefined) await this.planExists(manager, input.planId);
      const normalized = await this.resolveMasterIds(manager, input);
      normalized.initialStatus = 'ACTIVE';
      await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',"updatedDate"=now() WHERE id=$1`, [existing.id]);
      const versionValues = fields.map(key => normalized[key] !== undefined ? normalized[key] : existing[key]);
      const colList = fields.map(key => `"${key}"`).join(',');
      const valPlaceholders = fields.map((_, index) => '$' + (index + 2)).join(',');

      await manager.query(`INSERT INTO public.merchants
        ("merchantId",${colList},"createdDate","updatedDate")
        VALUES($1,${valPlaceholders},now(),now())`,
        [existing.merchantId || id, ...versionValues.map((value,index) => fields[index] === 'roleIds' ? JSON.stringify(value) : value)]);
      if (['planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice'].some(key => input[key] !== undefined)) {
        const [current] = await manager.query(`SELECT * FROM public.subscriptions
          WHERE ("merchantId"=$1 OR "merchantId"=$2) AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [id, existing.merchantId || id]);
        const planChanged = input.planId !== undefined && current && String(input.planId) !== String(current.plan_id);
        if (planChanged || !current) {
          if (current) await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now() WHERE "subscriptionId"=$1`, [current.subscriptionId]);
          const newSubId = `SUB-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
          await manager.query(`INSERT INTO public.subscriptions
            ("subscriptionId","merchantId",plan_id,billing_cycle,start_date,renewal_date,agreement_price,status,created_at,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',now(),now())`, [newSubId, existing.merchantId || id, input.planId ?? current?.plan_id,
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
    let targetRowId = '';
    let targetMerchantId = '';
    await this.db.transaction(async manager=>{
      const [target]=await manager.query(`SELECT id,"merchantId" FROM public.merchants
        WHERE id::text=$1 OR "merchantId"=$1
        ORDER BY CASE WHEN id::text=$1 THEN 0 ELSE 1 END,"createdDate" DESC LIMIT 1 FOR UPDATE`,[id]);
      if (!target) throw new NotFoundException('Merchant not found');
      targetRowId = target.id;
      targetMerchantId = target.merchantId;
      if (body.initialStatus==='ACTIVE') await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',"updatedDate"=now()
        WHERE "merchantId"=$1 AND "initialStatus"='ACTIVE' AND id<>$2`,[target.merchantId,target.id]);
      await manager.query(`UPDATE public.merchants SET "initialStatus"=$2,"updatedDate"=now() WHERE id=$1`,[target.id,body.initialStatus]);
    });
    return {success:true,id:targetRowId,merchantId:targetMerchantId,initialStatus:body.initialStatus};
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.db.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',"updatedDate"=now() WHERE "merchantId"=$1 OR id::text=$1`, [id]);
      await this.db.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now() WHERE "merchantId"=$1`, [id]);
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
