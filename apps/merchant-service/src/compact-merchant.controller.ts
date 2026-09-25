import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';

const fields = [
  'merchantName', 'merchantEmail', 'merchantPhoneNumber', 'businessName', 'businessDisplayName',
  'addressLine1', 'addressLine2', 'city', 'state', 'pinCode', 'country', 'planId',
  'billingCycle', 'startDate', 'renewalDate', 'agreementPrice', 'tax', 'totalDueToday', 'paymentMethod',
] as const;
const required = [
  'merchantName', 'merchantEmail', 'merchantPhoneNumber', 'businessName',
  'businessDisplayName', 'addressLine1', 'city', 'state', 'pinCode', 'country',
  'planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice',
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

  private async decorate(rows: Input[]) {
    const ids = rows.map(row => String(row.id)).filter(Boolean);
    const subCols = await this.columns('subscriptions');
    const merchantColumn = subCols.has('merchantId') ? '"merchantId"' : subCols.has('merchant_id') ? 'merchant_id' : '';
    const subscriptions = ids.length && merchantColumn
      ? await this.db.query(`SELECT * FROM public.subscriptions WHERE ${merchantColumn} = ANY($1::text[])`, [ids])
      : [];
    const planIds = [...new Set(rows.flatMap(row => [row.planId, ...subscriptions.filter((sub: Input) => String(sub.merchantId || sub.merchant_id) === String(row.id)).map((sub: Input) => sub.planId || sub.plan_id)]).filter(Boolean).map(String))];
    const plans = planIds.length ? await this.db.query(`SELECT id, name, "planCode" FROM public.plans WHERE id::text = ANY($1::text[])`, [planIds]).catch(() => []) : [];
    const planById = new Map(plans.map((plan: Input) => [String(plan.id), plan]));
    return rows.map(row => {
      const mine = subscriptions.filter((sub: Input) => String(sub.merchantId || sub.merchant_id) === String(row.id));
      const active = mine.find((sub: Input) => String(sub.status || 'ACTIVE').toUpperCase() === 'ACTIVE') || mine[0];
      const plan = planById.get(String(active?.planId || active?.plan_id || row.planId)) as Input | undefined;
      const subscription = this.subscriptionView(active, plan);
      const history = mine
        .map((item: Input) => this.subscriptionView(item, planById.get(String(item.planId || item.plan_id)) as Input | undefined))
        .filter(Boolean)
        .sort((left, right) => String(right?.startDate || '').localeCompare(String(left?.startDate || '')));
      const paymentHistory = history.map(item => ({
        id: item?.id,
        createdAt: item?.startDate,
        plan: item?.planName,
        cycle: item?.billingCycle,
        currency: 'USD',
        amount: item?.price,
        method: row.paymentMethod || null,
        status: item?.status,
      }));
      const merchant = this.present(row);
      return { ...merchant, subscription, subscriptions: history, paymentHistory, plan: plan ? { id: plan.id, name: plan.name, planCode: plan.planCode } : null };
    });
  }

  private async columns(table: string): Promise<Set<string>> {
    const rows = await this.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    return new Set(rows.map((row: { column_name: string }) => row.column_name));
  }

  private async getRecord(id: string) {
    const cols = await this.columns('merchants');
    const active = cols.has('status') ? ` AND COALESCE(status,'ACTIVE')='ACTIVE'` : '';
    const [row] = await this.db.query(`SELECT * FROM public.merchants WHERE (id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1)${active} LIMIT 1`, [id]);
    if (!row) throw new NotFoundException('Merchant not found');
    const [merchant] = await this.decorate([row]);
    return { merchant, subscription: merchant.subscription, plan: merchant.plan };
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
        setCol('tax', input.tax ?? null);
        setCol('totalDueToday', input.totalDueToday ?? null);
        setCol('paymentMethod', input.paymentMethod ?? null);
        setCol('status', 'ACTIVE');
        setCol('createdDate', new Date());
        setCol('updatedDate', new Date());
        setCol('created_at', new Date());
        setCol('updated_at', new Date());
        if (availMerchantCols.has('merchantCode') && !merchantData.merchantCode) setCol('merchantCode', rowId);
        if (availMerchantCols.has('merchant_code') && !merchantData.merchant_code) setCol('merchant_code', rowId);
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
    const cols = await this.columns('merchants');
    const active = cols.has('status') ? `WHERE COALESCE(status,'ACTIVE')='ACTIVE'` : '';
    const rows = await this.db.query(`SELECT * FROM public.merchants ${active}`);
    const merchants = await this.decorate(rows);
    return { success: true, count: merchants.length, merchants };
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
    await this.db.transaction(async manager => {
      const [existing] = await manager.query(`SELECT * FROM public.merchants WHERE id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1 LIMIT 1 FOR UPDATE`, [id]);
      if (!existing) throw new NotFoundException('Merchant not found');
      const merchantColsResult = await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='merchants'`);
      const availMerchantCols = new Set(merchantColsResult.map((r: any) => r.column_name));
      const changes: Record<string, any> = {};
      const setCol = (col: string, val: any) => { if (availMerchantCols.has(col) && val !== undefined) changes[col] = val; };
      setCol('businessName', input.businessName);
      setCol('businessDisplayName', input.businessDisplayName);
      setCol('legalBusinessName', input.businessName);
      setCol('merchantName', input.merchantName);
      setCol('ownerName', input.merchantName);
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
      setCol('planId', input.planId);
      setCol('billingCycle', input.billingCycle);
      setCol('startDate', input.startDate);
      setCol('renewalDate', input.renewalDate);
      setCol('agreementPrice', input.agreementPrice);
      setCol('tax', input.tax);
      setCol('totalDueToday', input.totalDueToday);
      setCol('paymentMethod', input.paymentMethod);
      if (availMerchantCols.has('updatedDate')) changes.updatedDate = new Date();
      if (availMerchantCols.has('updated_at')) changes.updated_at = new Date();
      const keys = Object.keys(changes);
      if (keys.length) {
        await manager.query(`UPDATE public.merchants SET ${keys.map((key, index) => `"${key}"=$${index + 2}`).join(',')} WHERE id=$1`, [existing.id, ...Object.values(changes)]);
      }
      const planId = input.planId ?? existing.planId;
      if (planId) {
        const storeTypeName = await storeTypeNameForPlan(manager, String(planId));
        const link = String(existing.id);
        await manager.query(`ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS "storeTypeName" varchar(150)`);
        const subCols = new Set((await manager.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions'`)).map((row: { column_name: string }) => row.column_name));
        const subChanges: Record<string, any> = {};
        const setSub = (col: string, val: any) => { if (subCols.has(col) && val !== undefined) subChanges[col] = val; };
        setSub('planId', input.planId);
        setSub('plan_id', input.planId);
        setSub('billingCycle', input.billingCycle);
        setSub('billing_cycle', input.billingCycle);
        setSub('startDate', input.startDate);
        setSub('start_date', input.startDate);
        setSub('renewalDate', input.renewalDate);
        setSub('renewal_date', input.renewalDate);
        setSub('agreementPrice', input.agreementPrice);
        setSub('agreement_price', input.agreementPrice);
        setSub('price', input.agreementPrice);
        setSub('storeTypeName', storeTypeName);
        setSub('store_type_name', storeTypeName);
        if (subCols.has('updated_at')) subChanges.updated_at = new Date();
        const merchantMatch = [subCols.has('merchantId') ? '"merchantId"=$1' : '', subCols.has('merchant_id') ? 'merchant_id=$1' : ''].filter(Boolean).join(' OR ');
        const activeOnly = subCols.has('status') ? ` AND COALESCE(status,'ACTIVE')='ACTIVE'` : '';
        if (Object.keys(subChanges).length && merchantMatch) {
          const [currentSub] = await manager.query(`SELECT * FROM public.subscriptions WHERE (${merchantMatch})${activeOnly} ORDER BY "createdAt" DESC NULLS LAST LIMIT 1 FOR UPDATE`, [link]);
          const same = currentSub && ['planId', 'billingCycle', 'startDate', 'renewalDate', 'price'].every(key => {
            const next = subChanges[key];
            if (next === undefined) return true;
            const previous = key === 'startDate' || key === 'renewalDate' ? this.dateOnly(currentSub[key]) : key === 'price' ? Number(currentSub[key]) : currentSub[key];
            const incoming = key === 'price' ? Number(next) : next;
            return String(previous ?? '') === String(incoming ?? '');
          });
          if (!same) {
            if (currentSub && subCols.has('status')) {
              await manager.query(`UPDATE public.subscriptions SET status='INACTIVE' WHERE id=$1`, [currentSub.id]);
            }
            const subId = `SUB-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const [plan] = await manager.query(`SELECT * FROM public.plans WHERE id::text=$1`, [String(planId)]);
            const nextRow: Record<string, any> = { ...(currentSub || {}) };
            delete nextRow.id;
            delete nextRow.subscriptionCode;
            delete nextRow.subscriptionId;
            for (const [key, value] of Object.entries(subChanges)) nextRow[key] = value;
            nextRow.id = subId;
            if (subCols.has('subscriptionCode')) nextRow.subscriptionCode = subId;
            if (subCols.has('merchantId')) nextRow.merchantId = link;
            if (subCols.has('planName')) nextRow.planName = plan?.name || currentSub?.planName || 'Plan';
            if (subCols.has('planCode')) nextRow.planCode = plan?.planCode || currentSub?.planCode || null;
            if (subCols.has('entitlements')) nextRow.entitlements = JSON.stringify(plan?.included_features || plan?.includedFeatures || currentSub?.entitlements || []);
            if (subCols.has('status')) nextRow.status = 'ACTIVE';
            if (subCols.has('createdAt')) nextRow.createdAt = new Date();
            if (subCols.has('updatedAt')) nextRow.updatedAt = new Date();
            const insertCols = Object.keys(nextRow).filter(key => subCols.has(key) && nextRow[key] !== undefined);
            await manager.query(`INSERT INTO public.subscriptions (${insertCols.map(key => `"${key}"`).join(',')}) VALUES (${insertCols.map((_, index) => `$${index + 1}`).join(',')})`, insertCols.map(key => nextRow[key]));
          }
        }
      }
    });
    return { success: true, ...(await this.getRecord(id)) };
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    if (!body || !['ACTIVE', 'INACTIVE'].includes(String(body.status))) throw new BadRequestException('status must be ACTIVE or INACTIVE');
    const [target] = await this.db.query(`SELECT id FROM public.merchants WHERE id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1
      ORDER BY CASE WHEN id::text=$1 THEN 0 ELSE 1 END LIMIT 1`, [id]);
    if (!target) throw new NotFoundException('Merchant not found');
    const cols = await this.columns('merchants');
    const touch = cols.has('updatedDate') ? `,"updatedDate"=now()` : cols.has('updatedAt') ? `,"updatedAt"=now()` : cols.has('updated_at') ? `,updated_at=now()` : '';
    await this.db.query(`UPDATE public.merchants SET status=$2${touch} WHERE id=$1`, [target.id, body.status]);
    return { success: true, id: target.id, status: body.status };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      const [target] = await this.db.query(`SELECT id FROM public.merchants WHERE id::text=$1 OR "merchantId"=$1 OR "merchantCode"=$1 LIMIT 1`, [id]);
      if (!target) throw new NotFoundException('Merchant not found');
      const cols = await this.columns('merchants');
      const touch = cols.has('updatedDate') ? `,"updatedDate"=now()` : cols.has('updatedAt') ? `,"updatedAt"=now()` : cols.has('updated_at') ? `,updated_at=now()` : '';
      await this.db.query(`UPDATE public.merchants SET status='INACTIVE'${touch} WHERE id=$1`, [target.id]);
      const subCols = await this.columns('subscriptions');
      const subTouch = subCols.has('updated_at') ? ',updated_at=now()' : subCols.has('updatedAt') ? `,"updatedAt"=now()` : '';
      const merchantMatch = [subCols.has('merchantId') ? '"merchantId"=$1' : '', subCols.has('merchant_id') ? 'merchant_id=$1' : ''].filter(Boolean).join(' OR ');
      if (merchantMatch) await this.db.query(`UPDATE public.subscriptions SET status='INACTIVE'${subTouch} WHERE ${merchantMatch}`, [String(target.id)]);
      return { success: true, id: target.id };
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

