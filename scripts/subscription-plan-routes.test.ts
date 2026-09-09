import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { SubscriptionPlanController } from '../apps/merchant-service/src/subscription-plan.controller';
const repo=new MerchantRepository();repo.onModuleInit=async()=>{};(repo as any).isDbConnected=false;
@Module({controllers:[SubscriptionPlanController],providers:[{provide:MerchantRepository,useValue:repo}]}) class TestModule {}
async function main(){const app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');try{const base=await app.getUrl();const req=(method:string,path:string,body?:any)=>fetch(base+'/api/v1/subscription-plans'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const body={planCode:'pro',planName:'Pro Plan',maxStoresAllowed:3,entitlements:['POS'],billingCycle:'MONTHLY',trialDays:14,price:0,currency:'inr',status:'ACTIVE'};
assert.equal((await req('POST','',body)).status,201);assert.equal((await req('POST','',body)).status,409);
const plan=(await(await req('GET','/PRO')).json()).plan;assert.equal(plan.price,0);assert.equal(plan.currency,'INR');assert.equal(plan.planCode,'PRO');
assert.equal((await req('PATCH','/PRO',{price:99})).status,200);assert.equal((await req('PATCH','/PRO',{price:-1})).status,400);assert.equal((await req('PATCH','/PRO',{merchantId:'M1'})).status,400);assert.equal((await req('PATCH','/PRO',{planCode:'OTHER'})).status,400);
(repo as any).subscriptionsStore=[{planCode:'PRO'}];assert.equal((await req('DELETE','/PRO')).status,409);
assert.equal((await req('PATCH','/PRO',{status:'INACTIVE'})).status,200);(repo as any).subscriptionsStore=[];
assert.equal((await req('DELETE','/PRO')).status,200);assert.equal((await req('GET','/PRO')).status,404);console.log('PASS: plan-master CRUD, normalization, zero price, immutable code, referenced-plan protection');}finally{await app.close()}}
main().catch(e=>{console.error(e);process.exitCode=1});
