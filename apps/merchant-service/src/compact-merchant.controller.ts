import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { COUNTRIES, nationalPhone } from './countries';
import { MerchantCrudService } from './merchant-crud.service';
import { MerchantRepository } from './merchant.repository';

const fields = [
  'merchantName', 'merchantEmail', 'merchantPhoneNumber', 'businessName', 'businessDisplayName',
  'storeTypeId', 'addressLine1', 'addressLine2', 'city', 'state', 'pinCode',
  'country', 'planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice',
  'roleIds', 'tax', 'totalDueToday', 'paymentMethod',
] as const;
const required = [
  'merchantName', 'merchantEmail', 'merchantPhoneNumber', 'businessName',
  'businessDisplayName', 'addressLine1', 'city', 'state',
  'pinCode', 'country', 'planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice',
] as const;
const removed = ['initialStatus', 'roleIds', 'merchantCode', 'merchantId'] as const;
type Input = Record<string, unknown>;

@Controller(['api/v1/merchants', 'connector/api/v1/merchants', 'merchants'])
export class CompactMerchantController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  private get db() { return this.repository.requireDataSource(); }

  private validate(input: Input, create: boolean): Input {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Provide a merchant object');
    delete input.storeTypeId;
    const allowed = new Set<string>(fields);
    const blocked = removed.filter(key => Object.prototype.hasOwnProperty.call(input, key));
    if (blocked.length) throw new BadRequestException(`Remove these fields: ${blocked.join(', ')}`);
    const unknown = Object.keys(input).filter(key => !allowed.has(key));
    if (unknown.length) throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    if (create) {
      const missing = required.filter(key => input[key] === undefined || input[key] === null || input[key] === '');
      if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
    }
    if (input.merchantEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.merchantEmail))) throw new BadRequestException('Invalid merchantEmail');
    for (const key of ['startDate', 'renewalDate']) if (input[key] !== undefined) {
      const value = String(input[key]);
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${key} must be a valid YYYY-MM-DD date`);
    }
    if (input.startDate && input.renewalDate && String(input.renewalDate) <= String(input.startDate)) throw new BadRequestException('renewalDate must be after startDate');
    for (const key of ['agreementPrice', 'tax', 'totalDueToday']) if (input[key] !== undefined && (input[key] === null || !Number.isFinite(Number(input[key])) || Number(input[key]) < 0)) throw new BadRequestException(`${key} must be a non-negative number`);
    if (input.billingCycle !== undefined && !['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(String(input.billingCycle))) throw new BadRequestException('Invalid billingCycle');
    for (const key of required) if (key !== 'planId' && key !== 'agreementPrice' && key !== 'startDate' && key !== 'renewalDate' && input[key] !== undefined && (typeof input[key] !== 'string' || !String(input[key]).trim())) throw new BadRequestException(`${key} must be a non-empty string`);
    return input;
  }

  private async getRecord(id: string) {
    try {
      const rows = await this.db.query(
        `SELECT row_to_json(m) AS merchant, row_to_json(mp) AS plan, row_to_json(s) AS subscription
         FROM public.merchants m
         LEFT JOIN LATERAL (
           SELECT sub.*, row_to_json(sp) AS plan
           FROM public.subscriptions sub
           LEFT JOIN public.plans sp
             ON sp.id::text = COALESCE(to_jsonb(sub)->>'plan_id', to_jsonb(sub)->>'planId')
           WHERE COALESCE(to_jsonb(sub)->>'merchantId', to_jsonb(sub)->>'merchant_id')
                   IN (
                     COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text),
                     m.id::text
                   )
             AND COALESCE(to_jsonb(sub)->>'status', 'ACTIVE') = 'ACTIVE'
           ORDER BY COALESCE(
             (to_jsonb(sub)->>'created_at')::timestamptz,
             (to_jsonb(sub)->>'createdAt')::timestamptz,
             now()
           ) DESC
           LIMIT 1
         ) s ON true
         LEFT JOIN public.plans mp
           ON mp.id::text = COALESCE(to_jsonb(m)->>'planId', to_jsonb(m)->>'plan_id')
         WHERE (
             COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text) = $1
             OR m.id::text = $1
           )
           AND COALESCE(to_jsonb(m)->>'status', 'ACTIVE') = 'ACTIVE'`,
        [id],
      );
      if (rows.length) return rows[0];
    } catch (error: unknown) {
      console.error(
        '[CompactMerchantController.getRecord]',
        error instanceof Error ? error.message : String(error),
      );
    }
    const [row] = await this.db.query(
      `SELECT row_to_json(m) AS merchant FROM public.merchants m
       WHERE COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text) = $1
          OR m.id::text = $1
       LIMIT 1`,
      [id],
    );
    if (!row) throw new NotFoundException('Merchant not found');
    return row;
  }

  private dateOnly(value: unknown) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${value.getFullYear()}-${month}-${day}`;
    }
    return value;
  }

  private present(row: Input) {
    const merchant: Input = { id: row.id, status: row.status || 'ACTIVE', createdAt: row.createdAt || row.createdDate || row.created_at || null };
    for (const key of fields) {
      let value = row[key] ?? (key === 'merchantEmail' ? row.email : undefined) ?? (key === 'merchantPhoneNumber' ? row.phone : undefined) ?? (key === 'pinCode' ? row.postalCode : undefined);
      if (key === 'startDate' || key === 'renewalDate') value = this.dateOnly(value);
      merchant[key] = key === 'agreementPrice' || key === 'tax' || key === 'totalDueToday' ? (value == null || value === '' ? null : Number(value)) : value ?? null;
    }
    return merchant;
  }

  

  @Post('create-merchant')
  async createFromOnboarding(@Body() body: Record<string, any>) {
    const merchant = body?.merchant && typeof body.merchant === 'object' ? body.merchant : {};
    const subscription = body?.subscription && typeof body.subscription === 'object' ? body.subscription : {};
    const flat: Input = { ...body };
    delete flat.merchant;
    delete flat.subscription;
    delete flat.stores;
    delete flat.planDetails;
    const mapped: Input = {
      ...flat,
      merchantName: flat.merchantName ?? merchant.merchantName ?? merchant.name,
      merchantEmail: flat.merchantEmail ?? merchant.merchantEmail ?? merchant.email,
      merchantPhoneNumber: flat.merchantPhoneNumber ?? merchant.merchantPhoneNumber ?? merchant.phone,
      businessName: flat.businessName ?? merchant.businessName ?? merchant.business,
      businessDisplayName: flat.businessDisplayName ?? merchant.businessDisplayName ?? merchant.display,
      addressLine1: flat.addressLine1 ?? merchant.addressLine1,
      addressLine2: flat.addressLine2 ?? merchant.addressLine2,
      city: flat.city ?? merchant.city,
      state: flat.state ?? merchant.state,
      pinCode: flat.pinCode ?? merchant.pinCode ?? merchant.postal,
      country: flat.country ?? merchant.country,
      planId: flat.planId ?? subscription.planId,
      billingCycle: flat.billingCycle ?? subscription.billingCycle,
      startDate: flat.startDate ?? subscription.startDate,
      renewalDate: flat.renewalDate ?? subscription.renewalDate,
      agreementPrice: flat.agreementPrice ?? subscription.agreementPrice,
      tax: flat.tax ?? merchant.tax,
      totalDueToday: flat.totalDueToday ?? merchant.totalDueToday,
      paymentMethod: flat.paymentMethod ?? merchant.paymentMethod,
    };
    for (const key of Object.keys(mapped)) if (mapped[key] === undefined) delete mapped[key];
    return this.create(mapped);
  }

  @Post()
  async create(@Body() body: Input) {
    const input = this.validate(body, true);
    let savedId = '';
    try {
      await this.db.transaction(async manager => {
        const merchantColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='merchants'`);
        const availMerchantCols = new Set(merchantColsResult.map((r: any) => r.column_name));
        const merchantData: Record<string, any> = {};
        const setCol = (col: string, val: any) => { if (availMerchantCols.has(col)) merchantData[col] = val; };
        const rowId = randomUUID();
        savedId = rowId;
        const merchantKey = `MCH-${rowId.slice(0, 8).toUpperCase()}`;
        setCol('id', rowId);
        setCol('merchantId', merchantKey);
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
        setCol('addressLine2', input.addressLine2 ?? null);
        setCol('businessAddress', input.addressLine1);
        setCol('city', input.city);
        setCol('state', input.state);
        setCol('pinCode', input.pinCode);
        setCol('postalCode', input.pinCode);
        setCol('country', input.country);
        setCol('planId', input.planId);
        setCol('billingCycle', input.billingCycle);
        setCol('startDate', input.startDate);
        setCol('renewalDate', input.renewalDate);
        setCol('agreementPrice', input.agreementPrice);
        setCol('tax', input.tax);
        setCol('totalDueToday', input.totalDueToday);
        setCol('paymentMethod', input.paymentMethod);
        setCol('roleIds', JSON.stringify(input.roleIds || []));
        setCol('status', 'ACTIVE');
        setCol('createdDate', new Date());
        setCol('updatedDate', new Date());
        setCol('created_at', new Date());
        setCol('updated_at', new Date());
        if (availMerchantCols.has('merchantCode') && !merchantData.merchantCode) setCol('merchantCode', rowId);
        
        const mCols = Object.keys(merchantData);
        const mPlaceholders = mCols.map((_, i) => `$${i + 1}`).join(',');
        const mColList = mCols.map(c => `"${c}"`).join(',');
        const inserted = await manager.query(`INSERT INTO public.merchants (${mColList}) VALUES (${mPlaceholders}) RETURNING *`, Object.values(merchantData));
        savedId = String(inserted[0]?.id || inserted[0]?.merchantId || rowId);

        const subColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions'`);
        const availSubCols = new Set(subColsResult.map((r: any) => r.column_name));

        const subId = `SUB-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
        const subData: Record<string, any> = {};
        const setSubCol = (col: string, val: any) => { if (availSubCols.has(col)) subData[col] = val; };

        const storeTypeName = await storeTypeNameForPlan(manager, String(input.planId));
        const [plan] = await manager.query(`SELECT * FROM public.plans WHERE id::text=$1`, [String(input.planId)]);
        const planName = plan?.name || plan?.planName || plan?.plan_name || 'Plan';
        const entitlements = JSON.stringify(plan?.included_features || plan?.includedFeatures || plan?.entitlements || []);
        setSubCol('id', subId);
        setSubCol('subscriptionId', subId);
        setSubCol('subscription_code', subId);
        setSubCol('merchantId', merchantKey);
        setSubCol('merchant_id', merchantKey);
        setSubCol('plan_id', input.planId);
        setSubCol('planId', input.planId);
        setSubCol('planName', planName);
        setSubCol('plan_name', planName);
        setSubCol('storeTypeName', storeTypeName);
        setSubCol('store_type_name', storeTypeName);
        setSubCol('entitlements', entitlements);
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
    return { success: true, ...(await this.getRecord(savedId)) };
  }

  @Get()
  async list() {
    try {
      const rows = await this.db.query(
        `SELECT row_to_json(m) AS merchant, row_to_json(mp) AS plan, row_to_json(s) AS subscription
         FROM public.merchants m
         LEFT JOIN LATERAL (
           SELECT sub.*, row_to_json(sp) AS plan
           FROM public.subscriptions sub
           LEFT JOIN public.plans sp
             ON sp.id::text = COALESCE(to_jsonb(sub)->>'plan_id', to_jsonb(sub)->>'planId')
           WHERE COALESCE(to_jsonb(sub)->>'merchantId', to_jsonb(sub)->>'merchant_id')
                   IN (
                     COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text),
                     m.id::text
                   )
             AND COALESCE(to_jsonb(sub)->>'status', 'ACTIVE') = 'ACTIVE'
           ORDER BY COALESCE(
             (to_jsonb(sub)->>'created_at')::timestamptz,
             (to_jsonb(sub)->>'createdAt')::timestamptz,
             now()
           ) DESC
           LIMIT 1
         ) s ON true
         LEFT JOIN public.plans mp
           ON mp.id::text = COALESCE(to_jsonb(m)->>'planId', to_jsonb(m)->>'plan_id')
         WHERE COALESCE(to_jsonb(m)->>'status', 'ACTIVE') = 'ACTIVE'
         ORDER BY COALESCE(
           (to_jsonb(m)->>'createdDate')::timestamptz,
           (to_jsonb(m)->>'created_at')::timestamptz,
           (to_jsonb(m)->>'createdAt')::timestamptz,
           now()
         ) DESC`,
      );
      return { success: true, count: rows.length, merchants: rows };
    } catch (error: unknown) {
      console.error(
        '[CompactMerchantController.list]',
        error instanceof Error ? error.message : String(error),
      );
      try {
        const rows = await this.db.query(
          `SELECT row_to_json(m) AS merchant FROM public.merchants m
           WHERE COALESCE(to_jsonb(m)->>'status', 'ACTIVE') = 'ACTIVE'
           ORDER BY COALESCE(
             (to_jsonb(m)->>'createdDate')::timestamptz,
             (to_jsonb(m)->>'created_at')::timestamptz,
             (to_jsonb(m)->>'createdAt')::timestamptz,
             now()
           ) DESC`,
        );
        return { success: true, count: rows.length, merchants: rows };
      } catch (fallbackError: unknown) {
        console.error(
          '[CompactMerchantController.list.fallback]',
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
        const rows = await this.db.query(`SELECT row_to_json(m) AS merchant FROM public.merchants m`);
        return { success: true, count: rows.length, merchants: rows };
      }
    }
  }

  @Public()
  @Get('countries')
  countries() {
    return { success: true, count: COUNTRIES.length, countries: COUNTRIES };
  }

  @Get('subscriptions')
  subscriptions(@Query('merchantId') merchantId?: string, @Query('status') status?: string) {
    return new MerchantCrudService(this.db).listSubscriptions(merchantId, status);
  }

  @Get('subscriptions/:subscriptionId')
  subscription(@Param('subscriptionId') subscriptionId: string) {
    return new MerchantCrudService(this.db).getSubscription(subscriptionId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const record = await this.getRecord(id);
    const merchant = record.merchant;
    if (merchant && typeof merchant === 'object') {
      merchant.phone = nationalPhone(merchant.phone, merchant.country);
      merchant.merchantPhoneNumber = nationalPhone(merchant.merchantPhoneNumber ?? merchant.phone, merchant.country);
    }
    return { success: true, ...record };
  }

  @Get(':id/history')
  async history(@Param('id') id: string) {
    const current = await this.getRecord(id);
    const rows = await this.db.query(`SELECT * FROM public.merchants WHERE id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1`, [id]);
    return { success: true, merchant: current.merchant, subscription: current.subscription, subscriptions: current.merchant.subscriptions || [], paymentHistory: current.merchant.paymentHistory || [], count: rows.length, merchants: rows.map((row: Input) => this.present(row)) };
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
      const [existing] = await manager.query(
        `SELECT * FROM public.merchants m
         WHERE (COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text) = $1 OR m.id::text = $1)
           AND COALESCE(to_jsonb(m)->>'status', 'ACTIVE') = 'ACTIVE'
         FOR UPDATE`,
        [id],
      );
      if (!existing) throw new NotFoundException('Merchant not found');

      const merchantColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='merchants'`);
      const availMerchantCols = new Set(merchantColsResult.map((r: any) => r.column_name));

      const merchantData: Record<string, any> = {};
      const setCol = (col: string, val: any) => { if (availMerchantCols.has(col) && col !== 'id' && col !== 'merchantCode') merchantData[col] = val; };

      setCol('merchantId', existing.merchantId || id);
      setCol('businessName', input.businessName ?? existing.businessName);
      setCol('businessDisplayName', input.businessDisplayName ?? existing.businessDisplayName);
      setCol('legalBusinessName', input.businessName ?? existing.legalBusinessName ?? existing.businessName);
      setCol('merchantName', input.merchantName ?? existing.merchantName);
      setCol('ownerName', input.merchantName ?? existing.ownerName ?? existing.merchantName);
      setCol('merchantEmail', input.merchantEmail ?? existing.merchantEmail ?? existing.email);
      setCol('email', input.merchantEmail ?? existing.email ?? existing.merchantEmail);
      setCol('merchantPhoneNumber', input.merchantPhoneNumber ?? existing.merchantPhoneNumber ?? existing.phone);
      setCol('phone', input.merchantPhoneNumber ?? existing.phone ?? existing.merchantPhoneNumber);
      setCol('addressLine1', input.addressLine1 ?? existing.addressLine1);
      setCol('addressLine2', input.addressLine2 ?? existing.addressLine2);
      setCol('businessAddress', [input.addressLine1 ?? existing.addressLine1, input.addressLine2 ?? existing.addressLine2].filter(Boolean).join(', ') || existing.businessAddress);
      setCol('city', input.city ?? existing.city);
      setCol('state', input.state ?? existing.state);
      setCol('pinCode', input.pinCode ?? existing.pinCode);
      setCol('postalCode', input.pinCode ?? existing.postalCode ?? existing.pinCode);
      setCol('country', input.country ?? existing.country);
      setCol('planId', input.planId ?? existing.planId);
      setCol('billingCycle', input.billingCycle ?? existing.billingCycle);
      setCol('startDate', input.startDate ?? existing.startDate);
      setCol('renewalDate', input.renewalDate ?? existing.renewalDate);
      setCol('agreementPrice', input.agreementPrice ?? existing.agreementPrice);
      setCol('tax', input.tax ?? existing.tax);
      setCol('totalDueToday', input.totalDueToday ?? existing.totalDueToday);
      setCol('paymentMethod', input.paymentMethod ?? existing.paymentMethod);
      setCol('status', 'ACTIVE');
      setCol('updatedDate', new Date());
      setCol('updatedAt', new Date());

      const mCols = Object.keys(merchantData);
      const assignments = mCols.map((col, index) => `"${col}"=$${index + 1}`).join(',');
      await manager.query(
        `UPDATE public.merchants SET ${assignments} WHERE id=$` + (mCols.length + 1),
        [...Object.values(merchantData), existing.id],
      );

      if (input.planId !== undefined) {
        await this.saveSubscription(manager, String(existing.merchantId || existing.id), input);
      }
    });
    return { success: true, ...(await this.getRecord(id)) };
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    if (!body || !['ACTIVE', 'INACTIVE'].includes(String(body.status))) {
      throw new BadRequestException('status must be ACTIVE or INACTIVE');
    }
    let targetRowId = '';
    let targetMerchantId = '';
    await this.db.transaction(async manager => {
      const [target] = await manager.query(
        `SELECT m.id,
                COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text) AS "merchantId"
         FROM public.merchants m
         WHERE m.id::text = $1
            OR COALESCE(to_jsonb(m)->>'merchantId', '') = $1
            OR COALESCE(to_jsonb(m)->>'merchantCode', '') = $1
         ORDER BY CASE WHEN m.id::text = $1 THEN 0 ELSE 1 END,
                  COALESCE((to_jsonb(m)->>'createdDate')::timestamptz, (to_jsonb(m)->>'created_at')::timestamptz, now()) DESC
         LIMIT 1
         FOR UPDATE`,
        [id],
      );
      if (!target) throw new NotFoundException('Merchant not found');
      targetRowId = target.id;
      targetMerchantId = target.merchantId;
      if (body.status === 'ACTIVE') {
        await manager.query(
          `UPDATE public.merchants m SET status='INACTIVE'
           WHERE COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text) = $1
             AND COALESCE(to_jsonb(m)->>'status', 'ACTIVE') = 'ACTIVE'
             AND m.id <> $2`,
          [target.merchantId, target.id],
        );
      }
      await manager.query(`UPDATE public.merchants SET status=$2 WHERE id=$1`, [target.id, body.status]);
    });
    return { success: true, id: targetRowId, merchantId: targetMerchantId, status: body.status };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.db.query(
        `UPDATE public.merchants m SET status='INACTIVE'
         WHERE COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', m.id::text) = $1
            OR m.id::text = $1`,
        [id],
      );
      await this.db.query(
        `UPDATE public.subscriptions s SET status='INACTIVE'
         WHERE COALESCE(to_jsonb(s)->>'merchantId', to_jsonb(s)->>'merchant_id') = $1`,
        [id],
      );
      return { success: true, merchantId: id };
    } catch (error: any) {
      if ((error.driverError?.code || error.code) === '23503') throw new ConflictException('Merchant is referenced by other records');
      throw error;
    }
  }

  private async saveSubscription(manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> }, merchantId: string, input: Input) {
    const [planRow] = await manager.query(`SELECT to_jsonb(p) AS plan FROM public.plans p WHERE p.id::text=$1`, [String(input.planId)]);
    const plan = planRow?.plan || {};
    const planName = plan.name || plan.planName || plan.plan_name || 'Plan';
    const planCode = plan.planCode || plan.plan_code || 'PRO';
    const price = input.agreementPrice ?? plan.basePrice ?? plan.base_price ?? 0;
    const fields: Record<string, unknown> = {
      merchantId,
      planId: input.planId,
      planCode,
      planName,
      billingCycle: input.billingCycle ?? plan.billingCycle ?? 'MONTHLY',
      startDate: input.startDate ?? null,
      renewalDate: input.renewalDate ?? null,
      price,
      currency: plan.currency || 'USD',
      status: 'ACTIVE',
      entitlements: JSON.stringify(plan.included_features || plan.includedFeatures || plan.entitlements || []),
      storeTypeName: await storeTypeNameForPlan(manager, String(input.planId)),
      updatedAt: new Date(),
    };
    const columns = new Set((await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions'`)).map((row: {column_name: string}) => row.column_name));
    const [current] = await manager.query(
      `SELECT id FROM public.subscriptions WHERE "merchantId"=$1 AND status='ACTIVE' ORDER BY "createdAt" DESC NULLS LAST LIMIT 1`,
      [merchantId],
    );
    if (current?.id) {
      const keys = Object.keys(fields).filter(key => columns.has(key));
      await manager.query(
        `UPDATE public.subscriptions SET ${keys.map((key, index) => `"${key}"=$${index + 2}`).join(',')} WHERE id=$1`,
        [current.id, ...keys.map(key => fields[key])],
      );
      return;
    }
    const subId = `SUB-${randomUUID()}`;
    const insert = { id: subId, subscriptionCode: subId, ...fields, createdAt: new Date() };
    const keys = Object.keys(insert).filter(key => columns.has(key));
    await manager.query(
      `INSERT INTO public.subscriptions (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')})`,
      keys.map(key => insert[key as keyof typeof insert]),
    );
  }
}

async function storeTypeNameForPlan(manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> }, planId: string): Promise<string | null> {
  const planCols = new Set((await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='plans'`)).map((row: { column_name: string }) => row.column_name));
  const source = ['store_type_id', 'storeTypeId', 'store_type', 'storeType'].find(column => planCols.has(column));
  if (!source) return null;
  const [plan] = await manager.query(`SELECT "${source}" AS ref FROM public.plans WHERE id::text=$1`, [planId]);
  const ref = plan?.ref == null ? '' : String(plan.ref).trim();
  if (!ref) return null;
  const [storeType] = await manager.query(`SELECT name FROM public.store_types
    WHERE id::text=$1 OR name ILIKE $1
      OR COALESCE(to_jsonb(store_types)->>'storeTypeCode', to_jsonb(store_types)->>'store_type_code', '') ILIKE $1
    LIMIT 1`, [ref]);
  return storeType?.name || (/^[0-9a-f-]{36}$/i.test(ref) ? null : ref);
}

