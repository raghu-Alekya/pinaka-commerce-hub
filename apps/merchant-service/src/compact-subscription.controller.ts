import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
 
type Input = Record<string, unknown>;
const editable = ['planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice', 'status'] as const;
const required = ['planId', 'billingCycle', 'startDate', 'renewalDate', 'agreementPrice'] as const;
const projection = `sub."subscriptionId",sub."subscriptionCode",sub."merchantId",sub.plan_id AS "planId",sub.billing_cycle AS "billingCycle",
  to_char(sub.start_date,'YYYY-MM-DD') AS "startDate",to_char(sub.renewal_date,'YYYY-MM-DD') AS "renewalDate",sub.agreement_price AS "agreementPrice",
  sub.status,sub.created_at AS "createdAt",sub.updated_at AS "updatedAt"`;
 
@Controller('api/v1/subscriptions')
export class CompactSubscriptionController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}
  private get db() { return this.repository.requireDataSource(); }
 
  private validate(input: Input, replace = false): Input {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Provide a subscription object');
    const allowed = new Set<string>(['merchantId', ...editable]);
    const unknown = Object.keys(input).filter(key => !allowed.has(key));
    if (unknown.length) throw new BadRequestException(`Unknown fields: ${unknown.join(', ')}`);
    if (replace) {
      const missing = required.filter(key => input[key] === undefined || input[key] === null || input[key] === '');
      if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (input.planId !== undefined && !uuid.test(String(input.planId))) throw new BadRequestException('Invalid planId');
    if (input.billingCycle !== undefined && !['MONTHLY','QUARTERLY','ANNUAL'].includes(String(input.billingCycle))) throw new BadRequestException('Invalid billingCycle');
    if (input.status !== undefined && !['ACTIVE','INACTIVE'].includes(String(input.status))) throw new BadRequestException('Invalid status');
    for (const key of ['startDate','renewalDate']) if (input[key] !== undefined) {
      const value=String(input[key]); const date=new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new BadRequestException(`${key} must be a valid YYYY-MM-DD date`);
    }
    if (input.startDate && input.renewalDate && String(input.renewalDate)<=String(input.startDate)) throw new BadRequestException('renewalDate must be after startDate');
    if (input.agreementPrice !== undefined && (!Number.isFinite(Number(input.agreementPrice)) || Number(input.agreementPrice)<0)) throw new BadRequestException('agreementPrice must be a non-negative number');
    return input;
  }
 
  private async requirePlan(manager: { query: (sql:string, values?:unknown[])=>Promise<any[]> }, planId: unknown) {
    const rows=await manager.query('SELECT 1 FROM public.plans WHERE id=$1 AND status=$2',[planId,'ACTIVE']);
    if (!rows.length) throw new BadRequestException('Select an active planId');
  }
 
  private relatedSelect(where:string) {
    return `SELECT ${projection},row_to_json(p) AS plan,row_to_json(m) AS merchant
      FROM public.subscriptions sub
      LEFT JOIN public.plans p ON p.id=sub.plan_id
      LEFT JOIN LATERAL (
        SELECT * FROM public.merchants mer WHERE mer."merchantId"=sub."merchantId"
        ORDER BY CASE WHEN mer."initialStatus"='ACTIVE' THEN 0 ELSE 1 END,mer."createdDate" DESC LIMIT 1
      ) m ON true ${where}`;
  }
 
  @Get()
  async list(@Query('merchantId') merchantId?:string, @Query('status') status?:string) {
    if (status && !['ACTIVE','INACTIVE'].includes(status)) throw new BadRequestException('Invalid status');
    const rows=await this.db.query(`${this.relatedSelect('')}
      WHERE ($1::text IS NULL OR sub."merchantId"=$1) AND ($2::text IS NULL OR sub.status=$2)
      ORDER BY sub.created_at DESC`,[merchantId||null,status||null]);
    return {success:true,count:rows.length,subscriptions:rows};
  }
 
  @Get(':id')
  async get(@Param('id') id:string) {
    const rows=await this.db.query(`${this.relatedSelect('WHERE sub."subscriptionId"=$1')}`,[id]);
    if (!rows.length) throw new NotFoundException('Subscription not found');
    return {success:true,subscription:rows[0]};
  }
 
  @Post()
  async create(@Body() body:Input) {
    const input=this.validate(body,true);
    if (!input.merchantId) throw new BadRequestException('merchantId is required');
    let id='';
    await this.db.transaction(async manager=>{
      if (!(await manager.query('SELECT 1 FROM public.merchants WHERE "merchantId"=$1',[input.merchantId])).length) throw new NotFoundException('Merchant not found');
      await this.requirePlan(manager,input.planId);
      await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now() WHERE "merchantId"=$1 AND status='ACTIVE'`,[input.merchantId]);
      const [row]=await manager.query(`INSERT INTO public.subscriptions
        ("merchantId",plan_id,billing_cycle,start_date,renewal_date,agreement_price,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',now(),now()) RETURNING "subscriptionId"`,
        [input.merchantId,input.planId,input.billingCycle,input.startDate,input.renewalDate,input.agreementPrice]);
      id=row.subscriptionId;
    });
    return this.get(id);
  }
 
  @Put(':id')
  async replace(@Param('id') id:string,@Body() body:Input) { return this.update(id,this.validate(body,true)); }
  @Patch(':id')
  async patch(@Param('id') id:string,@Body() body:Input) {
    if (!Object.keys(body||{}).length) throw new BadRequestException('Provide at least one field');
    return this.update(id,this.validate(body));
  }
 
  private async update(id:string,input:Input) {
    if (input.merchantId !== undefined) throw new BadRequestException('merchantId cannot be changed');
    let resultId=id;
    await this.db.transaction(async manager=>{
      const [current]=await manager.query('SELECT * FROM public.subscriptions WHERE "subscriptionId"=$1 FOR UPDATE',[id]);
      if (!current) throw new NotFoundException('Subscription not found');
      if (input.planId !== undefined) await this.requirePlan(manager,input.planId);
      const [active]=await manager.query(`SELECT * FROM public.subscriptions
        WHERE "merchantId"=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[current.merchantId]);
      const activePlanChanged=input.planId!==undefined && (!active || String(input.planId)!==String(active.plan_id));
      if (activePlanChanged) {
        const [merchant]=await manager.query(`SELECT * FROM public.merchants
          WHERE "merchantId"=$1 AND "initialStatus"='ACTIVE' FOR UPDATE`,[current.merchantId]);
        if (!merchant) throw new NotFoundException('Active merchant not found');
        await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now() WHERE "merchantId"=$1 AND status='ACTIVE'`,[current.merchantId]);
        const source=active??current;
        const [created]=await manager.query(`INSERT INTO public.subscriptions
          ("merchantId",plan_id,billing_cycle,start_date,renewal_date,agreement_price,status,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',now(),now()) RETURNING "subscriptionId"`,
          [current.merchantId,input.planId,input.billingCycle??source.billing_cycle,input.startDate??source.start_date,
            input.renewalDate??source.renewal_date,input.agreementPrice??source.agreement_price]);
        resultId=created.subscriptionId;
        await manager.query(`UPDATE public.merchants SET "initialStatus"='INACTIVE',"updatedDate"=now() WHERE id=$1`,[merchant.id]);
        const merchantFields=['merchantName','merchantEmail','merchantPhoneNumber','businessName','businessDisplayName','storeTypeId','initialStatus',
          'addressLine1','addressLine2','city','state','pinCode','country','planId','billingCycle','startDate','renewalDate','agreementPrice',
          'roleIds','tax','totalDueToday','paymentMethod'];
        const merchantValues=merchantFields.map(key=>{
          if(key==='initialStatus') return 'ACTIVE';
          if(key==='planId') return input.planId;
          if(key==='billingCycle') return input.billingCycle??source.billing_cycle;
          if(key==='startDate') return input.startDate??source.start_date;
          if(key==='renewalDate') return input.renewalDate??source.renewal_date;
          if(key==='agreementPrice') return input.agreementPrice??source.agreement_price;
          return merchant[key];
        });
        await manager.query(`INSERT INTO public.merchants
          ("merchantId",${merchantFields.map(key=>`"${key}"`).join(',')},"createdDate","updatedDate")
          VALUES($1,${merchantFields.map((_,index)=>`$${index+2}`).join(',')},now(),now())`,
          [current.merchantId,...merchantValues.map((value,index)=>merchantFields[index]==='roleIds'&&typeof value!=='string'?JSON.stringify(value):value)]);
      } else {
        const keys=editable.filter(key=>input[key]!==undefined);
        const columns:Record<string,string>={planId:'plan_id',billingCycle:'billing_cycle',startDate:'start_date',renewalDate:'renewal_date',agreementPrice:'agreement_price',status:'status'};
        const values=keys.map(key=>input[key]);
        try {
          if(input.status==='ACTIVE') await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now()
            WHERE "merchantId"=$1 AND status='ACTIVE' AND "subscriptionId"<>$2`,[current.merchantId,id]);
          await manager.query(`UPDATE public.subscriptions SET ${keys.map((key,index)=>`${columns[key]}=$${index+2}`).join(',')},updated_at=now() WHERE "subscriptionId"=$1`,[id,...values]);
        } catch (error:any) {
          if ((error.driverError?.code||error.code)==='23505') throw new ConflictException('Merchant already has an active subscription');
          throw error;
        }
      }
    });
    return this.get(resultId);
  }
 
  @Patch(':id/status')
  async updateStatus(@Param('id') id:string,@Body() body:{status?:string}) {
    if (!body || !['ACTIVE','INACTIVE'].includes(String(body.status))) throw new BadRequestException('status must be ACTIVE or INACTIVE');
    try {
      await this.db.transaction(async manager=>{
        const [current]=await manager.query('SELECT "merchantId" FROM public.subscriptions WHERE "subscriptionId"=$1 FOR UPDATE',[id]);
        if (!current) throw new NotFoundException('Subscription not found');
        if (body.status==='ACTIVE') await manager.query(`UPDATE public.subscriptions SET status='INACTIVE',updated_at=now() WHERE "merchantId"=$1 AND status='ACTIVE'`,[current.merchantId]);
        await manager.query(`UPDATE public.subscriptions SET status=$2,updated_at=now() WHERE "subscriptionId"=$1`,[id,body.status]);
      });
    } catch (error:any) {
      if ((error.driverError?.code||error.code)==='23505') throw new ConflictException('Merchant already has an active subscription');
      throw error;
    }
    return {success:true,subscriptionId:id,status:body.status};
  }
 
  @Delete(':id')
  async remove(@Param('id') id:string) {
    const rows=await this.db.query('DELETE FROM public.subscriptions WHERE "subscriptionId"=$1 RETURNING "subscriptionId"',[id]);
    if (!rows.length) throw new NotFoundException('Subscription not found');
    return {success:true,subscriptionId:id};
  }
}