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
    const allowed = new Set<string>([...fields, 'merchantId', 'code', 'planDetails', 'stores']);
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

  private async getRecord(id: string) {
    try {
      const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(mp) AS plan, row_to_json(s) AS subscription
        FROM public.merchants m LEFT JOIN LATERAL (
          SELECT sub.*, row_to_json(sp) AS plan FROM public.subscriptions sub
          LEFT JOIN public.plans sp ON sp.id::text=sub.plan_id::text
          WHERE (sub."merchantId"=m."merchantId" OR sub."merchantId"=m.id::text OR sub."merchantId"=m."merchantCode") AND COALESCE(sub.status, 'ACTIVE')='ACTIVE'
          ORDER BY COALESCE(sub.created_at, now()) DESC LIMIT 1
        ) s ON true
        LEFT JOIN public.plans mp ON mp.id::text=m."planId"::text
        WHERE (m."merchantId"=$1 OR m.id::text=$1 OR m."merchantCode"=$1) AND COALESCE(m."initialStatus", m.status, 'ACTIVE')='ACTIVE'`, [id]);
      if (rows.length) return rows[0];
    } catch {}
    const [row] = await this.db.query(`SELECT * FROM public.merchants WHERE "merchantId"=$1 OR id::text=$1 OR "merchantCode"=$1 LIMIT 1`, [id]);
    if (!row) throw new NotFoundException('Merchant not found');
    return { merchant: row };
  }

  @Post('create-merchant')
  async createFromOnboarding(@Body() body: Record<string, any>) {
    const merchant = body?.merchant || body || {};
    const subscription = body?.subscription || body || {};

    let storeTypeId: string | undefined;
    const requestedStoreType = merchant.storeTypeId || body.storeTypeId;
    if (requestedStoreType) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(requestedStoreType));
      try {
        const [found] = isUuid
          ? await this.db.query(`SELECT id FROM public.store_types WHERE id=$1::uuid`, [String(requestedStoreType)])
          : await this.db.query(`SELECT id FROM public.store_types WHERE (name ILIKE $1 OR store_type_code ILIKE $1) LIMIT 1`, [String(requestedStoreType)]);
        if (found) storeTypeId = found.id;
      } catch {}
    }
    if (!storeTypeId) {
      try {
        const [fallback] = await this.db.query(`SELECT id FROM public.store_types WHERE status='ACTIVE' LIMIT 1`);
        if (fallback) storeTypeId = fallback.id;
      } catch {}
    }
    if (!storeTypeId) storeTypeId = 'a1b2c3d4-e5f6-4a1b-8c2d-000000000001';

    let planId: string | undefined;
    let planPrice = 99;
    const requestedPlanId = subscription.planId || body.planId || body.plan;
    if (requestedPlanId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(requestedPlanId));
      try {
        const [foundPlan] = isUuid
          ? await this.db.query('SELECT id, COALESCE(base_price, 99) AS "basePrice" FROM public.plans WHERE id=$1', [requestedPlanId])
          : await this.db.query('SELECT id, COALESCE(base_price, 99) AS "basePrice" FROM public.plans WHERE (name ILIKE $1 OR plan_code ILIKE $1) LIMIT 1', [String(requestedPlanId)]);
        if (foundPlan) {
          planId = foundPlan.id;
          planPrice = Number(foundPlan.basePrice) || 99;
        }
      } catch {}
    }
    if (!planId) {
      try {
        const [fallbackPlan] = await this.db.query(`SELECT id, COALESCE(base_price, 99) AS "basePrice" FROM public.plans LIMIT 1`);
        if (fallbackPlan) {
          planId = fallbackPlan.id;
          planPrice = Number(fallbackPlan.basePrice) || 99;
        }
      } catch {}
    }
    if (!planId) planId = 'b1111111-0000-0000-0000-000000000001';

    const billingCycle = String(subscription.billingCycle || body.billingCycle || 'MONTHLY').toUpperCase();
    const cycle = ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(billingCycle) ? billingCycle : 'MONTHLY';
    const startDate = String(subscription.startDate || body.startDate || new Date().toISOString().slice(0, 10));
    const renewalDate = String(subscription.renewalDate || body.renewalDate || nextRenewalDate(startDate, cycle));
    const agreementPrice = subscription.agreementPrice ?? body.agreementPrice ?? planPrice;
    const tax = Number(merchant.tax || body.tax || 0);

    return this.create({
      merchantName: merchant.name || merchant.merchantName || merchant.display || merchant.business || body.businessName || 'Demo Merchant',
      merchantEmail: merchant.email || merchant.merchantEmail || body.email || `merchant-${Date.now()}@example.com`,
      merchantPhoneNumber: merchant.phone || merchant.merchantPhoneNumber || body.phone || '+15551234567',
      businessName: merchant.business || merchant.businessName || body.businessName || 'Business LLC',
      businessDisplayName: merchant.display || merchant.businessDisplayName || merchant.business || body.businessDisplayName || 'Business',
      storeTypeId,
      initialStatus: merchant.initialStatus || body.initialStatus || 'ACTIVE',
      addressLine1: merchant.addressLine1 || body.addressLine1 || '100 Main St',
      addressLine2: merchant.addressLine2 || body.addressLine2 || '',
      city: merchant.city || body.city || 'City',
      state: merchant.state || body.state || 'State',
      pinCode: merchant.postal || merchant.pinCode || body.pinCode || '10001',
      country: merchant.country || body.country || 'USA',
      planId,
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

        // 1. Inspect existing columns in public.merchants dynamically
        const merchantColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='merchants'`);
        const availMerchantCols = new Set(merchantColsResult.map((r: any) => r.column_name));

        const merchantData: Record<string, any> = {};
        const setCol = (col: string, val: any) => { if (availMerchantCols.has(col)) merchantData[col] = val; };

        setCol('merchantId', merchantId);
        setCol('merchantCode', merchantId);
        setCol('merchant_code', merchantId);
        setCol('businessName', input.businessName);
        setCol('businessDisplayName', input.businessDisplayName || input.businessName);
        setCol('legalBusinessName', input.businessName);
        setCol('merchantName', input.merchantName);
        setCol('ownerName', input.merchantName);
        setCol('name', input.merchantName);
        setCol('merchantEmail', input.merchantEmail);
        setCol('email', input.merchantEmail);
        setCol('merchantPhoneNumber', input.merchantPhoneNumber);
        setCol('phone', input.merchantPhoneNumber);
        setCol('addressLine1', input.addressLine1);
        setCol('addressLine2', input.addressLine2);
        setCol('businessAddress', input.addressLine1);
        setCol('city', input.city);
        setCol('state', input.state);
        setCol('pinCode', input.pinCode);
        setCol('postalCode', input.pinCode);
        setCol('country', input.country);
        setCol('storeTypeId', input.storeTypeId);
        setCol('planId', input.planId);
        setCol('billingCycle', input.billingCycle);
        setCol('startDate', input.startDate);
        setCol('renewalDate', input.renewalDate);
        setCol('agreementPrice', input.agreementPrice);
        setCol('tax', input.tax);
        setCol('totalDueToday', input.totalDueToday);
        setCol('paymentMethod', input.paymentMethod);
        setCol('roleIds', JSON.stringify(input.roleIds || []));
        setCol('initialStatus', input.initialStatus || 'ACTIVE');
        setCol('status', input.initialStatus || 'ACTIVE');
        setCol('createdDate', new Date());
        setCol('updatedDate', new Date());
        setCol('created_at', new Date());
        setCol('updated_at', new Date());

        const mCols = Object.keys(merchantData);
        const mPlaceholders = mCols.map((_, i) => `$${i + 1}`).join(',');
        const mColList = mCols.map(c => `"${c}"`).join(',');
        await manager.query(`INSERT INTO public.merchants (${mColList}) VALUES (${mPlaceholders})`, Object.values(merchantData));

        // 2. Inspect existing columns in public.subscriptions dynamically
        const subColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions'`);
        const availSubCols = new Set(subColsResult.map((r: any) => r.column_name));

        const subId = `SUB-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
        const subData: Record<string, any> = {};
        const setSubCol = (col: string, val: any) => { if (availSubCols.has(col)) subData[col] = val; };

        setSubCol('id', subId);
        setSubCol('subscriptionId', subId);
        setSubCol('subscription_code', subId);
        setSubCol('merchantId', merchantId);
        setSubCol('merchant_id', merchantId);
        setSubCol('plan_id', input.planId);
        setSubCol('planId', input.planId);
        setSubCol('plan_code', 'PRO');
        setSubCol('planCode', 'PRO');
        setSubCol('plan_name', 'Pro Commerce Plan');
        setSubCol('planName', 'Pro Commerce Plan');
        setSubCol('billing_cycle', input.billingCycle);
        setSubCol('billingCycle', input.billingCycle);
        setSubCol('start_date', input.startDate);
        setSubCol('startDate', input.startDate);
        setSubCol('renewal_date', input.renewalDate);
        setSubCol('renewalDate', input.renewalDate);
        setSubCol('agreement_price', input.agreementPrice);
        setSubCol('agreementPrice', input.agreementPrice);
        setSubCol('price', input.agreementPrice);
        setSubCol('currency', 'USD');
        setSubCol('status', 'ACTIVE');
        setSubCol('created_at', new Date());
        setSubCol('updated_at', new Date());

        const sCols = Object.keys(subData);
        const sPlaceholders = sCols.map((_, i) => `$${i + 1}`).join(',');
        const sColList = sCols.map(c => `"${c}"`).join(',');
        await manager.query(`INSERT INTO public.subscriptions (${sColList}) VALUES (${sPlaceholders})`, Object.values(subData));
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
    try {
      const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(mp) AS plan, row_to_json(s) AS subscription
        FROM public.merchants m LEFT JOIN LATERAL (
          SELECT sub.*, row_to_json(sp) AS plan FROM public.subscriptions sub
          LEFT JOIN public.plans sp ON sp.id::text=sub.plan_id::text
          WHERE (sub."merchantId"=m."merchantId" OR sub."merchantId"=m.id::text OR sub."merchantId"=m."merchantCode") AND COALESCE(sub.status, 'ACTIVE')='ACTIVE'
          ORDER BY COALESCE(sub.created_at, now()) DESC LIMIT 1
        ) s ON true LEFT JOIN public.plans mp ON mp.id::text=m."planId"::text
        WHERE COALESCE(m."initialStatus", m.status, 'ACTIVE')='ACTIVE'
        ORDER BY COALESCE(m."createdDate", m.created_at, now()) DESC`);
      return { success: true, count: rows.length, merchants: rows };
    } catch (err) {
      const rows = await this.db.query(`SELECT * FROM public.merchants WHERE COALESCE("initialStatus", status, 'ACTIVE')='ACTIVE' ORDER BY COALESCE("createdDate", created_at, now()) DESC`);
      return { success: true, count: rows.length, merchants: rows.map((m: any) => ({ merchant: m })) };
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) { return { success: true, ...(await this.getRecord(id)) }; }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    const rows = await this.db.query(`SELECT row_to_json(m) AS merchant, row_to_json(p) AS plan
      FROM public.merchants m LEFT JOIN public.plans p ON p.id::text=m."planId"::text
      WHERE (m."merchantId"=$1 OR m.id::text=$1 OR m."merchantCode"=$1) ORDER BY COALESCE(m."createdDate", m.created_at, now()) DESC`, [id]);
    if (!rows.length) throw new NotFoundException('Merchant not found');
    const subscriptions = await this.db.query(`SELECT sub.*,row_to_json(p) AS plan
      FROM public.subscriptions sub LEFT JOIN public.plans p ON p.id::text=sub.plan_id::text
      WHERE (sub."merchantId"=$1 OR sub."merchantId"=(SELECT id::text FROM public.merchants WHERE "merchantId"=$1 LIMIT 1))
      ORDER BY COALESCE(sub.created_at, now()) DESC`, [id]);
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
      const [existing] = await manager.query('SELECT * FROM public.merchants WHERE ("merchantId"=$1 OR id::text=$1 OR "merchantCode"=$1) AND COALESCE("initialStatus", status)=\'ACTIVE\' FOR UPDATE', [id]);
      if (!existing) throw new NotFoundException('Merchant not found');

      await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',status='INACTIVE',"updatedDate"=now() WHERE id=$1`, [existing.id]);

      const merchantColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='merchants'`);
      const availMerchantCols = new Set(merchantColsResult.map((r: any) => r.column_name));

      const merchantData: Record<string, any> = {};
      const setCol = (col: string, val: any) => { if (availMerchantCols.has(col)) merchantData[col] = val; };

      setCol('merchantId', existing.merchantId || id);
      setCol('merchantCode', existing.merchantCode || id);
      setCol('businessName', input.businessName ?? existing.businessName);
      setCol('businessDisplayName', input.businessDisplayName ?? existing.businessDisplayName);
      setCol('legalBusinessName', input.businessName ?? existing.legalBusinessName);
      setCol('merchantName', input.merchantName ?? existing.merchantName);
      setCol('ownerName', input.merchantName ?? existing.ownerName);
      setCol('merchantEmail', input.merchantEmail ?? existing.merchantEmail ?? existing.email);
      setCol('email', input.merchantEmail ?? existing.email);
      setCol('merchantPhoneNumber', input.merchantPhoneNumber ?? existing.merchantPhoneNumber ?? existing.phone);
      setCol('phone', input.merchantPhoneNumber ?? existing.phone);
      setCol('addressLine1', input.addressLine1 ?? existing.addressLine1);
      setCol('addressLine2', input.addressLine2 ?? existing.addressLine2);
      setCol('city', input.city ?? existing.city);
      setCol('state', input.state ?? existing.state);
      setCol('pinCode', input.pinCode ?? existing.pinCode);
      setCol('country', input.country ?? existing.country);
      setCol('storeTypeId', input.storeTypeId ?? existing.storeTypeId);
      setCol('planId', input.planId ?? existing.planId);
      setCol('billingCycle', input.billingCycle ?? existing.billingCycle);
      setCol('startDate', input.startDate ?? existing.startDate);
      setCol('renewalDate', input.renewalDate ?? existing.renewalDate);
      setCol('agreementPrice', input.agreementPrice ?? existing.agreementPrice);
      setCol('tax', input.tax ?? existing.tax);
      setCol('totalDueToday', input.totalDueToday ?? existing.totalDueToday);
      setCol('paymentMethod', input.paymentMethod ?? existing.paymentMethod);
      setCol('initialStatus', 'ACTIVE');
      setCol('status', 'ACTIVE');
      setCol('createdDate', new Date());
      setCol('updatedDate', new Date());

      const mCols = Object.keys(merchantData);
      const mPlaceholders = mCols.map((_, i) => `$${i + 1}`).join(',');
      const mColList = mCols.map(c => `"${c}"`).join(',');
      await manager.query(`INSERT INTO public.merchants (${mColList}) VALUES (${mPlaceholders})`, Object.values(merchantData));
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
        WHERE id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1
        ORDER BY CASE WHEN id::text=$1 THEN 0 ELSE 1 END,"createdDate" DESC LIMIT 1 FOR UPDATE`,[id]);
      if (!target) throw new NotFoundException('Merchant not found');
      targetRowId = target.id;
      targetMerchantId = target.merchantId || target.merchantCode;
      if (body.initialStatus==='ACTIVE') await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',status='INACTIVE',"updatedDate"=now()
        WHERE ("merchantId"=$1 OR "merchantCode"=$1) AND COALESCE("initialStatus",status)='ACTIVE' AND id<>$2`,[target.merchantId,target.id]);
      await manager.query(`UPDATE public.merchants SET "initialStatus"=$2,status=$2,"updatedDate"=now() WHERE id=$1`,[target.id,body.initialStatus]);
    });
    return {success:true,id:targetRowId,merchantId:targetMerchantId,initialStatus:body.initialStatus};
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.db.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',status='INACTIVE',"updatedDate"=now() WHERE "merchantId"=$1 OR id::text=$1 OR "merchantCode"=$1`, [id]);
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
