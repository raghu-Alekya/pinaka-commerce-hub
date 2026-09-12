import 'reflect-metadata';
import './load-env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { postgresConnectionOptions } from '../libs/database/src';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { SubscriptionController } from '../apps/merchant-service/src/subscription.controller';
import { MerchantEntity } from '../apps/merchant-service/src/entities/merchant.entity';
import { StoreEntity } from '../apps/merchant-service/src/entities/store.entity';
import { SubscriptionEntity } from '../apps/merchant-service/src/entities/subscription.entity';
import { PlanEntity } from '../apps/merchant-service/src/entities/plan.entity';
const repo = new MerchantRepository();
Object.assign(repo,{onModuleInit:async()=>{},recordAuditLog:async()=>{}});
@Module({controllers:[SubscriptionController],providers:[{provide:MerchantRepository,useValue:repo}]}) class TestModule {}
async function main() {
  const db=new DataSource({...postgresConnectionOptions([MerchantEntity,StoreEntity,SubscriptionEntity,PlanEntity]),synchronize:false});
  await db.initialize(); const runner=db.createQueryRunner();await runner.startTransaction();
  Object.assign(repo,{dataSource:{query:(sql:string,args:unknown[])=>runner.query(sql,args)},
    merchantRepo:runner.manager.getRepository(MerchantEntity),storeRepo:runner.manager.getRepository(StoreEntity),
    subRepo:runner.manager.getRepository(SubscriptionEntity),planMasterRepo:runner.manager.getRepository(PlanEntity)});
  const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');
  let checks=0;const eq=(a:unknown,b:unknown,note='')=>{assert.deepEqual(a,b,note);checks++;};
  try {
    const suffix=randomUUID(); const merchant=`M-${suffix}`,store=`S-${suffix}`,plan=randomUUID(),inactive=randomUUID(),feature=randomUUID();
    const planCode=`TEST_${suffix.replaceAll('-','').toUpperCase()}`;
    await runner.query('INSERT INTO merchants (id,"businessName","ownerName",email,phone) VALUES ($1,\'Contract test\',\'Owner\',$2,\'123\')',[merchant,`${suffix}@example.invalid`]);
    await runner.query('INSERT INTO stores (id,merchant_id,name,store_code,address,"activationPin") VALUES ($1,$2,\'Contract test\',$1,\'{}\',\'123456\')',[store,merchant]);
    await runner.query("INSERT INTO plans (id,plan_code,name,billing_model,base_price,currency,billing_cycle,status) VALUES ($1,$2,'Contract Plan','FLAT',79,'USD','MONTHLY','ACTIVE'),($3,$4,'Inactive','FLAT',9,'USD','MONTHLY','INACTIVE')",[plan,planCode,inactive,`OFF_${suffix}`]);
    await runner.query("INSERT INTO features (id,feature_key,name,category,feature_type) VALUES ($1,$2,'Test feature','TEST','BOOLEAN')",[feature,`F_${suffix}`]);
    await runner.query('INSERT INTO plan_entitlements (plan_id,feature_id,enabled) VALUES ($1,$2,true)',[plan,feature]);
    const base=await app.getUrl();
    const req=async(method:string,path='',body?:object)=>{
      await runner.query('SAVEPOINT http_request');
      const response=await fetch(base+'/api/v1/subscriptions'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const data=await response.json();if(response.status>=400)await runner.query('ROLLBACK TO SAVEPOINT http_request');await runner.query('RELEASE SAVEPOINT http_request');
      return {status:response.status,data};
    };
    const body={merchantId:merchant,planId:plan,subscriptionCode:`SC-${suffix}`,status:'ACTIVE',billingCycle:'ANNUAL',price:0,currency:'INR',startDate:'2026-10-01',renewalDate:'2027-10-01',trialEndDate:'2026-10-15',licensedStoreCount:5,licensedDeviceCount:15};
    for(const bad of [{planId:'bad'},{planId:inactive},{planId:randomUUID()},{price:-1},{price:'5'},{currency:'bad'},{licensedDeviceCount:-1},{licensedStoreCount:1.2},{startDate:'2026-02-30'},{renewalDate:'2026-09-01'},{trialEndDate:'2026-09-01'},{unexpected:true},{cancelledAt:'2026-01-01'}])eq((await req('POST','',{...body,...bad})).status,400);
    eq((await req('POST','',{...body,merchantId:'MISSING'})).status,404);
    const created=await req('POST','',body);eq(created.status,201,JSON.stringify(created.data));const sub=created.data.subscription;
    for(const key of ['merchantId','planId','subscriptionCode','price','currency','startDate','renewalDate','trialEndDate','licensedStoreCount','licensedDeviceCount'])eq(String(sub[key]),String((body as any)[key]),key);
    eq(sub.planName,'Contract Plan');eq(sub.entitlements,[`F_${suffix}`]);eq(sub.cancelledAt,null);
    eq((await req('POST','',body)).status,409);
    const history=await req('POST','',{merchantId:merchant,planId:plan,status:'CANCELLED'});eq(history.status,201,JSON.stringify(history.data));assert(history.data.subscription.cancelledAt);checks++;
    eq((await req('GET',`?merchantId=${merchant}`)).data.count,2);
    eq((await req('GET',`?merchantId=${merchant}`)).data.subscriptions[0].id,sub.id);
    eq((await req('PATCH',`/${sub.id}`,{})).status,400);
    eq((await req('PATCH',`/${sub.id}`,{merchantId:'OTHER'})).status,400);
    eq((await req('PATCH',`/${sub.id}`,{renewalDate:'2026-01-01'})).status,400);
    eq((await req('PATCH',`/${sub.id}`,{startDate:'2026-11-01'})).status,400);
    const changed=await req('PATCH',`/${sub.id}`,{licensedDeviceCount:20});eq(changed.status,200);eq(changed.data.subscription.licensedDeviceCount,20);eq(changed.data.subscription.startDate,sub.startDate);eq(changed.data.subscription.createdAt,sub.createdAt);
    eq((await req('PATCH',`/${sub.id}`,{trialEndDate:null})).data.subscription.trialEndDate,null);
    eq((await req('PUT',`/${sub.id}`,{planId:plan})).status,400);
    const replacement=await req('PUT',`/${sub.id}`,{planId:plan,status:'ACTIVE',billingCycle:'MONTHLY',price:49});eq(replacement.status,200);eq(replacement.data.subscription.startDate,null);eq(replacement.data.subscription.currency,'USD');eq(replacement.data.subscription.subscriptionCode,body.subscriptionCode);
    await runner.query("INSERT INTO subscription_stores (merchant_id,subscription_id,store_id,status) VALUES ($1,$2,$3,'ACTIVE')",[merchant,sub.id,store]);
    eq((await req('DELETE',`/${sub.id}`)).status,409);
    const cancelled=await req('PATCH',`/${sub.id}`,{status:'CANCELLED'});eq(cancelled.status,200);assert(cancelled.data.subscription.cancelledAt);checks++;
    eq((await req('GET',`/${sub.id}`)).status,200);
    // Legacy onboarding creates a new current contract without overwriting cancelled history.
    const legacy=await repo.createOrUpdateSubscription(merchant,{planId:plan});assert(legacy.id!==sub.id&&legacy.id!==history.data.subscription.id);checks++;
    eq((await req('GET',`?merchantId=${merchant}`)).data.count,3);
    eq((await repo.getMerchantById(merchant)).subscription?.id,legacy.id);
    eq((await req('DELETE',`/${history.data.subscription.id}`)).status,200);
    eq((await req('GET',`/${history.data.subscription.id}`)).status,404);
    const alias=await req('POST','',{merchantId:merchant,planCode,maxStoresAllowed:2,currentPeriodStart:'2026-10-01T12:00:00Z',currentPeriodEnd:'2026-11-01T12:00:00Z'});
    eq(alias.status,201,JSON.stringify(alias.data));eq(alias.data.subscription.planId,plan);eq(alias.data.subscription.startDate,'2026-10-01');eq(alias.data.subscription.licensedStoreCount,2);
    eq((await req('POST','',{merchantId:merchant,planId:plan,planCode:'WRONG'})).status,400);
    eq((await req('PATCH',`/${alias.data.subscription.id}`,{startDate:'2026-10-02',currentPeriodStart:'2026-10-01T00:00:00Z'})).status,400);
    eq((await req('PATCH',`/${alias.data.subscription.id}`,{licensedStoreCount:3,maxStoresAllowed:4})).status,400);
    const raw=(await runner.query('SELECT plan_id,subscription_code,merchant_id FROM subscriptions WHERE id=$1',[sub.id]))[0];eq(raw.plan_id,plan);eq(raw.subscription_code,body.subscriptionCode);eq(raw.merchant_id,merchant);
    console.log(`PASS ${checks} subscription contract assertions: plan FK, fields, defaults, dates, history, aliases and references (rolled back)`);
  } finally {await app.close();await runner.rollbackTransaction();await runner.release();await db.destroy();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
