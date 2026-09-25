import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
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
                     COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', to_jsonb(m)->>'merchant_code', m.id::text),
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
             COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', to_jsonb(m)->>'merchant_code', m.id::text) = $1
             OR m.id::text = $1
           )
           AND COALESCE(to_jsonb(m)->>'status', 'ACTIVE') = 'ACTIVE'`,
        [id],
      );
      if (rows.length) return this.showMerchantCode(rows[0]);
    } catch (error: unknown) {
      console.error(
        '[CompactMerchantController.getRecord]',
        error instanceof Error ? error.message : String(error),
      );
    }
    const [row] = await this.db.query(
      `SELECT row_to_json(m) AS merchant FROM public.merchants m
       WHERE COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', to_jsonb(m)->>'merchant_code', m.id::text) = $1
          OR m.id::text = $1
       LIMIT 1`,
      [id],
    );
    if (!row) throw new NotFoundException('Merchant not found');
    return this.showMerchantCode(row);
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

  private merchantCodeValue(row: Input) {
    return [row?.merchantId, row?.merchantCode, row?.merchant_code].find(value => /^MER-\d+$/i.test(String(value || ''))) || null;
  }

  private showMerchantCode<T extends Input>(record: T): T {
    const merchant = record?.merchant;
    if (merchant && typeof merchant === 'object' && !Array.isArray(merchant)) {
      const code = this.merchantCodeValue(merchant as Input);
      if (code) (merchant as Input).merchant_code = code;
    }
    return record;
  }

  private present(row: Input) {
    const merchant: Input = { id: row.id, merchant_code: this.merchantCodeValue(row), merchantId: row.merchantId || null, status: row.status || 'ACTIVE', createdAt: row.createdAt || row.createdDate || row.created_at || null };
    for (const key of fields) {
      let value = row[key] ?? (key === 'merchantEmail' ? row.email : undefined) ?? (key === 'merchantPhoneNumber' ? row.phone : undefined) ?? (key === 'pinCode' ? row.postalCode : undefined);
      if (key === 'startDate' || key === 'renewalDate') value = this.dateOnly(value);
      merchant[key] = key === 'agreementPrice' || key === 'tax' || key === 'totalDueToday' ? (value == null || value === '' ? null : Number(value)) : value ?? null;
    }
    return merchant;
  }

  private subscriptionView(row: Input | undefined, plan: Input | undefined) {
    if (!row) return null;
    const planName = row.planName || row.plan_name || plan?.name || null;
    return {
      id: row.id || row.subscriptionId,
      planId: row.planId || row.plan_id || null,
      planName,
      billingCycle: row.billingCycle || row.billing_cycle || null,
      startDate: this.dateOnly(row.startDate || row.start_date),
      renewalDate: this.dateOnly(row.renewalDate || row.renewal_date),
      status: row.status || 'ACTIVE',
      price: row.price == null ? null : Number(row.price),
      agreementPrice: row.agreementPrice == null && row.agreement_price == null ? null : Number(row.agreementPrice ?? row.agreement_price),
      storeTypeName: row.storeTypeName || row.store_type_name || null,
    };
  }

  private async columns(table: string): Promise<Set<string>> {
    const rows = await this.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    return new Set(rows.map((row: { column_name: string }) => row.column_name));
  }

  private async nextMerchantId(manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> }) {
    await manager.query(`SELECT pg_advisory_xact_lock(842001)`);
    const numbered = await manager.query(`SELECT "merchantId" AS code FROM public.merchants WHERE "merchantId" ~ '^MER-[0-9]+$'`);
    let max = 0;
    for (const row of numbered) {
      const value = Number(String(row.code).slice(4));
      if (Number.isFinite(value) && value > max) max = value;
    }
    const pending = await manager.query(
      `SELECT id::text AS id FROM public.merchants
       WHERE COALESCE("merchantId", '') !~ '^MER-[0-9]+$'
       ORDER BY COALESCE((to_jsonb(merchants)->>'createdDate')::timestamptz, (to_jsonb(merchants)->>'created_at')::timestamptz, (to_jsonb(merchants)->>'createdAt')::timestamptz, now()), id`,
    );
    for (const row of pending) {
      max += 1;
      const code = `MER-${String(max).padStart(4, '0')}`;
      await manager.query(`UPDATE public.merchants SET "merchantId"=$1, merchant_code=$1, "merchantCode"=CASE WHEN "merchantCode" IS NULL OR "merchantCode" !~ '^MER-[0-9]+$' THEN $1 ELSE "merchantCode" END WHERE id::text=$2`, [code, row.id]);
    }
    max += 1;
    return `MER-${String(max).padStart(4, '0')}`;
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
        setCol('id', rowId);
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
        const merchantId = await this.nextMerchantId(manager);
        setCol('merchantId', merchantId);
        setCol('merchantCode', merchantId);
        setCol('merchant_code', merchantId);
        const mCols = Object.keys(merchantData);
        const mPlaceholders = mCols.map((_, i) => `$${i + 1}`).join(',');
        const mColList = mCols.map(c => `"${c}"`).join(',');
        const inserted = await manager.query(`INSERT INTO public.merchants (${mColList}) VALUES (${mPlaceholders}) RETURNING *`, Object.values(merchantData));
        savedId = String(inserted[0]?.id || inserted[0]?.merchantId || rowId);

        // 2. Inspect existing columns in public.subscriptions dynamically
        await manager.query(`ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS "storeTypeName" varchar(150)`);
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
        setSubCol('merchantId', savedId);
        setSubCol('merchant_id', savedId);
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
                     COALESCE(to_jsonb(m)->>'merchantId', to_jsonb(m)->>'merchantCode', to_jsonb(m)->>'merchant_code', m.id::text),
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
      return { success: true, count: rows.length, merchants: rows.map((row: Input) => this.showMerchantCode(row)) };
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
        return { success: true, count: rows.length, merchants: rows.map((row: Input) => this.showMerchantCode(row)) };
      } catch (fallbackError: unknown) {
        console.error(
          '[CompactMerchantController.list.fallback]',
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        );
        const rows = await this.db.query(`SELECT row_to_json(m) AS merchant FROM public.merchants m`);
        return { success: true, count: rows.length, merchants: rows.map((row: Input) => this.showMerchantCode(row)) };
      }
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) { return { success: true, ...(await this.getRecord(id)) }; }

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
    try {
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
      const assignments: string[] = [];
      const values: unknown[] = [];
      const setCol = (col: string, val: unknown) => {
        if (!availMerchantCols.has(col)) return;
        values.push(val);
        assignments.push(`"${col}" = $${values.length}`);
      };

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
      setCol('updated_at', new Date());
      if (!assignments.length) throw new BadRequestException('No merchant columns available to update');
      values.push(existing.id ?? existing.merchant_code ?? id);
      await manager.query(
        `UPDATE public.merchants SET ${assignments.join(', ')} WHERE id::text = $${values.length} OR merchant_code = $${values.length}`,
        values,
      );

      const nextPlanId = String(input.planId ?? existing.planId ?? '');
      if (nextPlanId) await this.saveSubscriptionVersion(manager, id, existing, input, nextPlanId);
    });
    } catch (error: any) {
      if ((error.driverError?.code || error.code) === '23505') throw new ConflictException('Merchant email already exists');
      throw error;
    }
    return { success: true, ...(await this.getRecord(id)) };
  }

  private async saveSubscriptionVersion(manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> }, id: string, existing: Input, input: Input, planId: string) {
    await manager.query(`ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS "storeTypeName" varchar(150)`);
    const merchantKeys = [...new Set([id, existing.id, existing.merchantId, existing.merchantCode, existing.merchant_code].filter(value => value != null && value !== '').map(String))];
    const [current] = await manager.query(
      `SELECT * FROM public.subscriptions s
       WHERE (
         COALESCE(to_jsonb(s)->>'merchantId', '') = ANY($1::text[])
         OR COALESCE(to_jsonb(s)->>'merchant_id', '') = ANY($1::text[])
       )
         AND COALESCE(to_jsonb(s)->>'status', 'ACTIVE') = 'ACTIVE'
       ORDER BY COALESCE((to_jsonb(s)->>'created_at')::timestamptz, (to_jsonb(s)->>'createdAt')::timestamptz, now()) DESC
       LIMIT 1`,
      [merchantKeys],
    );
    const nextCycle = String(input.billingCycle ?? existing.billingCycle ?? current?.billingCycle ?? current?.billing_cycle ?? '');
    const nextStart = String(input.startDate ?? this.dateOnly(existing.startDate) ?? '');
    const nextRenewal = String(input.renewalDate ?? this.dateOnly(existing.renewalDate) ?? '');
    const nextPrice = Number(input.agreementPrice ?? existing.agreementPrice ?? current?.price ?? 0);
    const unchanged = current
      && String(current.planId || current.plan_id || '') === planId
      && String(current.billingCycle || current.billing_cycle || '') === nextCycle
      && String(this.dateOnly(current.startDate || current.start_date) || '') === nextStart
      && String(this.dateOnly(current.renewalDate || current.renewal_date) || '') === nextRenewal
      && Number(current.price ?? current.agreementPrice ?? 0) === nextPrice;
    if (unchanged) return;

    const [plan] = await manager.query(`SELECT * FROM public.plans WHERE id::text=$1`, [planId]);
    if (!plan) throw new BadRequestException('Select an active planId');
    if (current?.id) await manager.query(`UPDATE public.subscriptions SET status='INACTIVE' WHERE id=$1`, [current.id]);

    const subCols = new Set((await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions'`)).map((row: { column_name: string }) => row.column_name));
    const subId = `SUB-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const merchantKey = String(current?.merchantId || current?.merchant_id || existing.merchantId || existing.merchant_code || id);
    const planName = plan.name || plan.planName || plan.plan_name || 'Plan';
    const storeTypeName = await storeTypeNameForPlan(manager, planId);
    const subData: Record<string, unknown> = {};
    const setSubCol = (col: string, val: unknown) => { if (subCols.has(col)) subData[col] = val; };
    setSubCol('id', subId);
    setSubCol('subscriptionId', subId);
    setSubCol('subscription_code', subId);
    setSubCol('subscriptionCode', subId);
    setSubCol('merchantId', merchantKey);
    setSubCol('merchant_id', merchantKey);
    setSubCol('plan_id', planId);
    setSubCol('planId', planId);
    setSubCol('planName', planName);
    setSubCol('plan_name', planName);
    const planCode = plan.planCode || plan.plan_code || plan.code;
    if (planCode) {
      setSubCol('planCode', planCode);
      setSubCol('plan_code', planCode);
    }
    setSubCol('maxStoresAllowed', plan.included_stores ?? plan.maxStoresAllowed ?? 0);
    setSubCol('trialDays', plan.trialDays ?? plan.trial_days ?? 0);
    setSubCol('createdAt', new Date());
    setSubCol('updatedAt', new Date());
    setSubCol('storeTypeName', storeTypeName);
    setSubCol('store_type_name', storeTypeName);
    setSubCol('entitlements', JSON.stringify(plan.included_features || plan.includedFeatures || plan.entitlements || []));
    setSubCol('billing_cycle', nextCycle);
    setSubCol('billingCycle', nextCycle);
    setSubCol('start_date', nextStart);
    setSubCol('startDate', nextStart);
    setSubCol('renewal_date', nextRenewal);
    setSubCol('renewalDate', nextRenewal);
    setSubCol('agreement_price', nextPrice);
    setSubCol('agreementPrice', nextPrice);
    setSubCol('price', nextPrice);
    setSubCol('currency', 'USD');
    setSubCol('status', 'ACTIVE');
    setSubCol('created_at', new Date());
    setSubCol('updated_at', new Date());
    const columns = Object.keys(subData);
    await manager.query(
      `INSERT INTO public.subscriptions (${columns.map(column => `"${column}"`).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`,
      Object.values(subData),
    );
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

