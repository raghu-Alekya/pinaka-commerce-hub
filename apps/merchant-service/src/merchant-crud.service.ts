import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

type Input = Record<string, any>;
const merchantFields = ['merchantId','ownerName','email','phone','businessName','legalBusinessName','businessType','retailSubCategory','firstName','lastName','alternatePhone','jobTitle','billingContact','taxId','country','state','city','postalCode','businessAddress','status',
  'merchantName','businessDisplayName','addressLine1','addressLine2','planId','billingCycle','startDate','renewalDate','agreementPrice','tax','totalDueToday','paymentMethod','roleIds'];
const subscriptionFields = ['planId','billingCycle','startDate','renewalDate','price','status'];
const quote = (key: string) => `"${key}"`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQL uses the installed schema, never a schema inferred from request names. */
export class MerchantCrudService {
  constructor(private readonly db: DataSource) {}

  private validate(input: Input, allowed: string[]) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Provide an object');
    const unknown = Object.keys(input).filter(key => !allowed.includes(key));
    if (unknown.length) throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    if (!Object.keys(input).length) throw new BadRequestException('Provide at least one field');
    if (input.merchantId !== undefined && (typeof input.merchantId!=='string' || !input.merchantId.trim() || input.merchantId.length>100 || input.merchantId!==input.merchantId.trim())) throw new BadRequestException('merchantId must be a non-empty identifier of at most 100 characters without surrounding whitespace');
    for (const key of ['planId']) if (input[key] !== undefined && !uuid.test(String(input[key]))) throw new BadRequestException(`Invalid ${key}`);
    if (input.roleIds !== undefined && (!Array.isArray(input.roleIds) || input.roleIds.some((id: unknown) => !uuid.test(String(id))))) throw new BadRequestException('roleIds must be UUIDs');
    if (input.email !== undefined && (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) throw new BadRequestException('Invalid email');
    for (const key of ['merchantName','businessDisplayName','ownerName','phone','businessName']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key].trim())) throw new BadRequestException(`${key} must be non-empty`);
    for (const key of ['price','agreementPrice','tax','totalDueToday']) if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > (key === 'price' || key === 'agreementPrice' ? 99999999.99 : 9999999999.99))) throw new BadRequestException(`${key} must be a non-negative amount within the supported range`);
    if (input.status !== undefined && !['ACTIVE','INACTIVE','PENDING','SUSPENDED','TRIAL','PAST_DUE','CANCELLED','EXPIRED'].includes(input.status)) throw new BadRequestException('Invalid status');
    if (input.billingCycle !== undefined && !['MONTHLY','QUARTERLY','ANNUAL','FREE_TRIAL'].includes(input.billingCycle)) throw new BadRequestException('Invalid billingCycle');
    for (const key of ['startDate','renewalDate']) if (input[key] !== undefined) {
      const value = input[key]; const date = new Date(`${value}T00:00:00Z`);
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new BadRequestException(`Invalid ${key}`);
    }
  }

  private required(input: Input, keys: string[]) {
    const missing = keys.filter(key => input[key] === undefined || input[key] === null || input[key] === '');
    if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
  }

  private async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try { return await this.db.transaction(work); }
    catch (error: any) {
      const code = error.driverError?.code || error.code;
      if (code === '23505') throw new ConflictException('Record already exists');
      if (code === '23503') throw new ConflictException('Record is referenced by other records');
      throw error;
    }
  }

  private async identity(manager: Pick<EntityManager,'query'>, code: string): Promise<string> {
    const [row] = await manager.query(`SELECT "merchantId" AS code FROM public.merchants
      WHERE "merchantId"=$1 OR "merchantCode"=$1 OR id::text=$1 LIMIT 1`,[code]);
    if (!row) throw new NotFoundException('Merchant not found');
    return row.code;
  }

  private async anchor(manager: Pick<EntityManager,'query'>, merchantId: string) {
    const [row] = await manager.query(`SELECT m.id,m."merchantCode" FROM public.merchants m
      LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode"
      WHERE m."merchantId"=$1 ORDER BY v.version ASC NULLS LAST,m."createdAt",m.id LIMIT 1`,[merchantId]);
    if (!row) throw new NotFoundException('Merchant not found');
    return row;
  }

  private async lockMerchant(manager: EntityManager, code: string) {
    const root = await this.identity(manager,code);
    // Serialize by business identity, independently of any record code.
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('merchant:' || $1,0))",[root]);
    const anchor = await this.anchor(manager,root);
    await manager.query('SELECT 1 FROM public.merchants WHERE id=$1 FOR UPDATE',[anchor.id]);
    await manager.query('INSERT INTO public.merchant_record_versions(record_code,merchant_code) VALUES ($1,$1) ON CONFLICT(record_code) DO NOTHING',[anchor.merchantCode]);
    const [merchant] = await manager.query(`SELECT m.*,to_char(m."startDate",'YYYY-MM-DD') AS "startDate",
      to_char(m."renewalDate",'YYYY-MM-DD') AS "renewalDate" FROM public.merchants m
      LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode"
      WHERE m."merchantId"=$1 ORDER BY v.version DESC NULLS LAST LIMIT 1 FOR UPDATE OF m`,[root]);
    if (!merchant) throw new NotFoundException('Merchant not found');
    return {merchant,root};
  }

  private async audit(manager: EntityManager, code: string, action: string, details: Input) {
    await manager.query(`INSERT INTO public.onboarding_audit_logs (id,"merchantId",action,"performedBy",details)
      VALUES ($1,$2,$3,'merchant-crud-api',$4)`,[randomUUID(),code,action,JSON.stringify(details)]);
  }

  private async extras(manager: EntityManager, root: string, input: Input) {
    if (input.roleIds !== undefined) {
      const merchant = await this.anchor(manager,root);
      const ids = [...new Set(input.roleIds)] as string[];
      const roles = await manager.query(`SELECT * FROM public.role_templates WHERE id=ANY($1::uuid[]) AND status='ACTIVE'`,[ids]);
      if (roles.length !== ids.length) throw new BadRequestException('Select active roleIds');
      // Reuse the existing merchant-specific role template table; retain customized rows.
      await manager.query(`UPDATE public.merchant_role_templates SET status='INACTIVE',updated_at=now()
        WHERE merchant_id=$1 AND source_role_template_id IS NOT NULL`,[merchant.id]);
      for (const role of roles) {
        const [existing] = await manager.query(`SELECT id FROM public.merchant_role_templates WHERE merchant_id=$1 AND source_role_template_id=$2`,[merchant.id,role.id]);
        if (existing) await manager.query(`UPDATE public.merchant_role_templates SET status='ACTIVE',updated_at=now() WHERE id=$1`,[existing.id]);
        else await manager.query(`INSERT INTO public.merchant_role_templates (id,merchant_id,source_role_template_id,role_code,name,description,scope_type,status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')`,[randomUUID(),merchant.id,role.id,role.role_code,role.name,role.description,role.scope_type]);
      }
    }
  }

  private merchantInput(input: Input): Input {
    const normalized = {...input};
    if (input.merchantName !== undefined && input.ownerName === undefined) normalized.ownerName=input.merchantName;
    if (input.addressLine1 !== undefined || input.addressLine2 !== undefined) normalized.businessAddress=[input.addressLine1,input.addressLine2].filter(Boolean).join(', ');
    if (input.roleIds !== undefined) normalized.roleIds=[...new Set(input.roleIds)];
    return normalized;
  }

  private values(record: Input, keys: string[]) {
    return keys.map(key=>['roleIds','kycDocuments'].includes(key) ? JSON.stringify(record[key]) : record[key]);
  }

  private async subscriptionRow(manager: Pick<EntityManager,'query'>, id: string) {
    const [row] = await manager.query(`SELECT *,to_char("startDate",'YYYY-MM-DD') AS "startDate",
      to_char("renewalDate",'YYYY-MM-DD') AS "renewalDate" FROM public.subscriptions WHERE id=$1`,[id]);
    return row;
  }

  private subscriptionSnapshot(sub: Input): Input {
    return {planId:sub.planId,billingCycle:sub.billingCycle,startDate:sub.startDate,renewalDate:sub.renewalDate,agreementPrice:Number(sub.price)};
  }

  private async saveMerchantRecord(manager: EntityManager, root: string, current: Input, changes: Input, version: boolean) {
    if (version) {
      await manager.query(`UPDATE public.merchants SET status='INACTIVE',"updatedAt"=clock_timestamp() WHERE "merchantCode"=$1`,[current.merchantCode]);
      const next = {...current,...changes,status:'ACTIVE',merchantCode:`MRC-${randomUUID()}`};
      const keys=Object.keys(next).filter(key=>!['id','createdAt','updatedAt'].includes(key));
      await manager.query(`INSERT INTO public.merchants (${keys.map(quote).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,this.values(next,keys));
      const anchor = await this.anchor(manager,root);
      await manager.query('INSERT INTO public.merchant_record_versions(record_code,merchant_code) VALUES ($1,$2)',[next.merchantCode,anchor.merchantCode]);
    } else {
      const keys=merchantFields.filter(key=>changes[key]!==undefined);
      if (keys.length) await manager.query(`UPDATE public.merchants SET ${keys.map((key,i)=>`${quote(key)}=$${i+2}`).join(',')},"updatedAt"=clock_timestamp() WHERE "merchantCode"=$1`,[current.merchantCode,...this.values(changes,keys)]);
    }
  }

  private async storeTypeName(manager: EntityManager, plan: Input): Promise<string | null> {
    const ref = plan.store_type_id || plan.storeTypeId || plan.store_type || plan.storeType;
    const value = ref == null ? '' : String(ref).trim();
    if (!value) return null;
    const [storeType] = await manager.query(`SELECT name FROM public.store_types
      WHERE id::text=$1 OR name ILIKE $1
        OR COALESCE(to_jsonb(store_types)->>'storeTypeCode', to_jsonb(store_types)->>'store_type_code', '') ILIKE $1
      LIMIT 1`, [value]);
    return storeType?.name || (/^[0-9a-f-]{36}$/i.test(value) ? null : value);
  }

  private async writeSubscription(manager: EntityManager, code: string, input: Input, current?: Input, forceNew=false) {
    const merged = {...current,...input};
    this.required(merged,['planId']);
    const planChanged = !current || current.planId !== merged.planId;
    const [plan] = await manager.query(`SELECT * FROM public.plans WHERE id=$1`,[merged.planId]);
    if (!plan || ((planChanged || forceNew) && plan.status !== 'ACTIVE')) throw new BadRequestException('Select an active planId');
    const start = merged.startDate || new Date().toISOString().slice(0,10);
    const cycle = merged.billingCycle || plan.billingCycle || 'MONTHLY';
    const date = new Date(`${start}T00:00:00Z`);
    const months = cycle === 'ANNUAL' ? 12 : cycle === 'QUARTERLY' ? 3 : 1;
    const end = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+months,1));
    end.setUTCDate(Math.min(date.getUTCDate(),new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate()));
    const renewal = merged.renewalDate || end.toISOString().slice(0,10);
    if (renewal <= start) throw new BadRequestException('renewalDate must be after startDate');
    await manager.query(`ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS "storeTypeName" varchar(150)`);
    const fields = {planId:plan.id,planCode:plan.planCode,planName:plan.name,storeTypeName:await this.storeTypeName(manager, plan),
      billingCycle:cycle,startDate:start,renewalDate:renewal,price:merged.price ?? Number(plan.basePrice),
      currency:planChanged ? plan.currency : current?.currency || plan.currency,entitlements:JSON.stringify(planChanged ? plan.included_features || [] : current?.entitlements || plan.included_features || []),
      maxStoresAllowed:planChanged ? plan.included_stores ?? 0 : current?.maxStoresAllowed ?? plan.included_stores ?? 0,
      status:input.status ?? (forceNew ? 'ACTIVE' : current?.status || 'ACTIVE')};
    const isNew = forceNew || !current || current.planId !== fields.planId;
    if (isNew && current) fields.status = 'ACTIVE';
    if (fields.status === 'ACTIVE') await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',"updatedAt"=clock_timestamp()
      WHERE "merchantId"=$1 AND status='ACTIVE' AND id<>$2`,[code,isNew ? '' : current!.id]);
    const id = isNew ? `SUB-${randomUUID()}` : current!.id;
    const keys = Object.keys(fields);
    if (isNew) await manager.query(`INSERT INTO public.subscriptions (id,"merchantId","subscriptionCode",${keys.map(quote).join(',')})
      VALUES ($1,$2,$1,${keys.map((_,i)=>`$${i+3}`).join(',')})`,[id,code,...Object.values(fields)]);
    else await manager.query(`UPDATE public.subscriptions SET ${keys.map((key,i)=>`${quote(key)}=$${i+2}`).join(',')},"updatedAt"=now() WHERE id=$1`,[id,...Object.values(fields)]);
    return id;
  }

  async createMerchant(input: Input) {
    this.validate(input,merchantFields);
    if (input.status !== undefined && !['ACTIVE','INACTIVE','PENDING','SUSPENDED'].includes(input.status)) throw new BadRequestException('Invalid merchant status');
    delete input.storeTypeId;
    this.required(input,['merchantName','businessDisplayName','email','phone','businessName','planId']);
    input=this.merchantInput(input);
    const code = `MRC-${randomUUID()}`;
    input.merchantId ??= `MER-${randomUUID()}`;
    await this.transaction(async manager => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('merchant:' || $1,0))",[input.merchantId]);
      if ((await manager.query('SELECT 1 FROM public.merchants WHERE "merchantId"=$1 OR "merchantCode"=$1',[input.merchantId])).length) throw new ConflictException('merchantId already exists');
      const fields = merchantFields.filter(key=>input[key] !== undefined);
      const [merchant] = await manager.query(`INSERT INTO public.merchants ("merchantCode",${fields.map(quote).join(',')})
        VALUES ($1,${fields.map((_,i)=>`$${i+2}`).join(',')}) RETURNING *`,[code,...this.values(input,fields)]);
      if (input.status === undefined) await manager.query(`UPDATE public.merchants SET status='ACTIVE' WHERE "merchantCode"=$1`,[code]);
      await manager.query('INSERT INTO public.merchant_record_versions(record_code,merchant_code) VALUES ($1,$1)',[code]);
      const sub = await this.writeSubscription(manager,input.merchantId,{...input,price:input.agreementPrice,status:'ACTIVE'});
      await this.saveMerchantRecord(manager,input.merchantId,merchant,this.subscriptionSnapshot(await this.subscriptionRow(manager,sub)),false);
      await this.extras(manager,input.merchantId,input);
      await this.audit(manager,input.merchantId,'MERCHANT_CREATED',{merchant:{...merchant,status:input.status || 'ACTIVE'}});
    });
    return this.getMerchant(code);
  }

  async getMerchant(code: string) {
    const root = await this.identity(this.db,code);
    const [merchant] = await this.db.query(`SELECT m.*,to_char(m."startDate",'YYYY-MM-DD') AS "startDate",
      to_char(m."renewalDate",'YYYY-MM-DD') AS "renewalDate" FROM public.merchants m
      LEFT JOIN public.merchant_record_versions v ON v.record_code=m."merchantCode"
      WHERE m."merchantId"=$1 ORDER BY v.version DESC NULLS LAST LIMIT 1`,[root]);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const subscriptions = await this.listSubscriptions(root);
    return {success:true,merchantId:root,merchant,subscription:subscriptions.subscriptions.find((sub: Input)=>sub.status==='ACTIVE') || null};
  }

  async listMerchants() {
    const codes = await this.db.query('SELECT DISTINCT "merchantId" FROM public.merchants');
    const merchants = await Promise.all(codes.map((row: Input)=>this.getMerchant(row.merchantId)));
    return {success:true,count:merchants.length,merchants:merchants.map(({success,...row})=>row)};
  }

  async updateMerchant(code: string, input: Input, replace=false) {
    this.validate(input,merchantFields);
    if (input.status !== undefined && !['ACTIVE','INACTIVE','PENDING','SUSPENDED'].includes(input.status)) throw new BadRequestException('Invalid merchant status');
    delete input.storeTypeId;
    if (replace) this.required(input,['merchantName','businessDisplayName','email','phone','businessName','planId']);
    await this.transaction(async manager=>{
      const {merchant,root} = await this.lockMerchant(manager,code);
      if (input.merchantId!==undefined && input.merchantId!==merchant.merchantId) throw new BadRequestException('merchantId cannot be changed');
      const planChanged = input.planId !== undefined && input.planId !== merchant.planId;
      await this.audit(manager,root,planChanged ? 'MERCHANT_PLAN_CHANGED' : 'MERCHANT_UPDATED',{merchant});
      const [current] = await manager.query(`SELECT *,to_char("startDate",'YYYY-MM-DD') AS "startDate",to_char("renewalDate",'YYYY-MM-DD') AS "renewalDate" FROM public.subscriptions WHERE "merchantId"=$1 AND status='ACTIVE' ORDER BY "createdAt" DESC,id DESC LIMIT 1 FOR UPDATE`,[root]);
      const subInput = Object.fromEntries(subscriptionFields.filter(key=>!['status','price'].includes(key) && input[key]!==undefined).map(key=>[key,input[key]]));
      if (input.agreementPrice!==undefined) subInput.price=input.agreementPrice;
      let changes=this.merchantInput(input);
      if (input.addressLine1!==undefined || input.addressLine2!==undefined) changes.businessAddress=[input.addressLine1 ?? merchant.addressLine1,input.addressLine2 ?? merchant.addressLine2].filter(Boolean).join(', ');
      if (Object.keys(subInput).length) {
        const subId = await this.writeSubscription(manager,root,subInput,current,planChanged);
        changes={...changes,...this.subscriptionSnapshot(await this.subscriptionRow(manager,subId))};
      }
      await this.extras(manager,root,input);
      await this.saveMerchantRecord(manager,root,merchant,changes,planChanged);
    });
    return this.getMerchant(code);
  }

  async history(code: string) {
    const current = await this.getMerchant(code);
    const history = await this.db.query('SELECT * FROM public.onboarding_audit_logs WHERE "merchantId"=$1 ORDER BY "createdAt" DESC',[current.merchantId]);
    const merchants = await this.db.query(`SELECT m.* FROM public.merchants m JOIN public.merchant_record_versions v
      ON v.record_code=m."merchantCode" WHERE m."merchantId"=$1 ORDER BY v.version DESC`,[current.merchantId]);
    return {...current,merchants,history,...await this.listSubscriptions(current.merchantId)};
  }

  async deleteMerchant(code: string) {
    await this.transaction(async manager=>{
      const {root} = await this.lockMerchant(manager,code);
      // Refuse deletion while related business records remain, including tables without FKs.
      for (const table of ['subscriptions','stores']) if ((await manager.query(`SELECT 1 FROM public.${table} WHERE "merchantId"=$1 OR "merchantId" IN
        (SELECT "merchantCode" FROM public.merchants WHERE "merchantId"=$1) LIMIT 1`,[root])).length) throw new ConflictException(`Merchant has ${table}; remove them first`);
      const records=await manager.query('DELETE FROM public.merchant_record_versions WHERE record_code IN (SELECT "merchantCode" FROM public.merchants WHERE "merchantId"=$1) RETURNING record_code',[root]);
      const rows=Array.isArray(records[0]) ? records[0] : records;
      await manager.query('DELETE FROM public.merchants WHERE "merchantCode"=ANY($1::varchar[])',[rows.map((row: Input)=>row.record_code)]);
    });
    return {success:true,merchantId:code};
  }

  async listSubscriptions(merchantId?: string, status?: string) {
    if (status) this.validate({status},['status']);
    if (merchantId) merchantId=await this.identity(this.db,merchantId);
    const columns = new Set((await this.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions'`)).map((row: {column_name: string}) => row.column_name));
    const merchantColumn = columns.has('merchantId') ? '"merchantId"' : columns.has('merchant_id') ? 'merchant_id' : '';
    const filters = [
      merchantColumn ? `($1::text IS NULL OR s.${merchantColumn}=$1)` : '$1::text IS NULL',
      columns.has('status') ? `($2::text IS NULL OR s.status=$2)` : '$2::text IS NULL',
    ];
    const subscriptions = await this.db.query(`SELECT s.* FROM public.subscriptions s WHERE ${filters.join(' AND ')}`,[merchantId || null,status || null]);
    for (const row of subscriptions) {
      for (const key of ['startDate','renewalDate','start_date','renewal_date']) {
        const value = row[key];
        if (value instanceof Date && Number.isFinite(value.getTime())) {
          const month = String(value.getMonth() + 1).padStart(2, '0');
          const day = String(value.getDate()).padStart(2, '0');
          row[key] = `${value.getFullYear()}-${month}-${day}`;
        }
      }
    }
    return {success:true,count:subscriptions.length,subscriptions};
  }

  async getSubscription(id: string) {
    const [row] = await this.db.query('SELECT "merchantId" FROM public.subscriptions WHERE id=$1',[id]);
    if (!row) throw new NotFoundException('Subscription not found');
    const result = await this.listSubscriptions(row.merchantId);
    return {success:true,subscription:result.subscriptions.find((sub: Input)=>sub.id===id)};
  }

  async saveSubscription(input: Input, id?: string, replace=false) {
    this.validate(input,id ? subscriptionFields : ['merchantId',...subscriptionFields]);
    if (!id) this.required(input,['merchantId','planId']);
    if (replace) this.required(input,['planId','billingCycle','startDate','renewalDate','price','status']);
    const resultId = await this.transaction(async manager=>{
      const [found] = id ? await manager.query('SELECT "merchantId" FROM public.subscriptions WHERE id=$1',[id]) : [{merchantId:input.merchantId}];
      if (!found) throw new NotFoundException('Subscription not found');
      const {merchant,root} = await this.lockMerchant(manager,found.merchantId);
      const [current] = id ? await manager.query(`SELECT *,to_char("startDate",'YYYY-MM-DD') AS "startDate",to_char("renewalDate",'YYYY-MM-DD') AS "renewalDate" FROM public.subscriptions WHERE id=$1 FOR UPDATE`,[id]) : [];
      if (id && !current) throw new NotFoundException('Subscription not found');
      const result = await this.writeSubscription(manager,root,input,current,!id);
      const sub = await this.subscriptionRow(manager,result);
      if (sub.status==='ACTIVE') {
        const changed=merchant.planId!==sub.planId;
        if (changed) await this.audit(manager,root,'MERCHANT_PLAN_CHANGED',{merchant});
        await this.saveMerchantRecord(manager,root,merchant,this.subscriptionSnapshot(sub),changed);
      }
      return result;
    });
    return this.getSubscription(resultId);
  }

  async deleteSubscription(id: string) {
    await this.transaction(async manager=>{
      const [row] = await manager.query('SELECT "merchantId" FROM public.subscriptions WHERE id=$1',[id]);
      if (!row) throw new NotFoundException('Subscription not found');
      await this.lockMerchant(manager,row.merchantId);
      await manager.query('DELETE FROM public.subscriptions WHERE id=$1',[id]);
    });
    return {success:true,id};
  }
}
