import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { SubscriptionController } from '../apps/merchant-service/src/subscription.controller';
const repo = new MerchantRepository(); repo.onModuleInit = async () => {}; (repo as any).isDbConnected=false;
repo.getMerchantById=async(id:string)=>({merchant:id==='M1'?{id} as any:null,stores:[],subscription:null});
@Module({controllers:[SubscriptionController],providers:[{provide:MerchantRepository,useValue:repo}]}) class TestModule {}
async function main(){const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');try{const base=await app.getUrl();const req=(method:string,path:string,body?:any)=>fetch(base+'/api/v1/subscriptions'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
await repo.createSubscriptionPlan({planCode:'PRO',planName:'Master Pro',maxStoresAllowed:3,entitlements:['POS'],billingCycle:'MONTHLY',trialDays:14,price:0,status:'ACTIVE',currency:'USD',description:'',createdAt:new Date(),updatedAt:new Date()});
const body={id:'SUB-TEST',merchantId:'M1',planCode:'PRO',planName:'PRO Plan',maxStoresAllowed:3,entitlements:['POS'],billingCycle:'MONTHLY',trialDays:14,price:0,status:'ACTIVE',currentPeriodStart:'2026-09-01T00:00:00Z',currentPeriodEnd:'2026-10-01T00:00:00Z'};
assert.equal((await req('POST','',{...body,planCode:'MISSING'})).status,400);
assert.equal((await req('POST','',body)).status,201);
assert.equal((await(await req('GET','/SUB-TEST')).json()).subscription.planName,'Master Pro');assert.equal((await req('POST','',body)).status,409);
assert.equal((await(await req('GET','/SUB-TEST')).json()).subscription.price,0);
assert.equal((await req('PATCH','/SUB-TEST',{status:'CANCELLED'})).status,200);
assert.equal((await req('PATCH','/SUB-TEST',{price:-1})).status,400);
assert.equal((await req('PATCH','/SUB-TEST',{merchantId:'other'})).status,400);
assert.equal((await req('PATCH','/SUB-TEST',{currentPeriodEnd:'2025-01-01T00:00:00Z'})).status,400);
assert.equal((await(await req('GET','?merchantId=M1')).json()).count,1);
assert.equal((await req('DELETE','/SUB-TEST')).status,200);assert.equal((await req('GET','/SUB-TEST')).status,404);
console.log('PASS: subscription CRUD, zero price, duplicates, date validation, immutable merchant, filtering');}finally{await app.close()}}
main().catch(e=>{console.error(e);process.exitCode=1});
