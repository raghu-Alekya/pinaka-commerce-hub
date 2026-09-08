import 'reflect-metadata';
import assert from 'node:assert/strict';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { ReferenceDataController } from '../apps/merchant-service/src/reference-data.controller';
async function main() {
 const repo = new MerchantRepository(); (repo as any).isDbConnected=false;
 await repo.createSubscriptionPlan({planCode:'CUSTOM',planName:'Custom master',description:'',maxStoresAllowed:7,entitlements:['POS'],billingCycle:'ANNUAL',trialDays:30,price:0,currency:'INR',status:'ACTIVE',createdAt:new Date(),updatedAt:new Date()});
 const first=await repo.createOrUpdateSubscription('M1',{planCode:'CUSTOM' as any,price:999,planName:'Wrong'});
 assert.equal(first.price,0); assert.equal(first.planName,'Custom master'); assert.equal(first.maxStoresAllowed,7); assert.equal(first.billingCycle,'ANNUAL');
 const second=await repo.createOrUpdateSubscription('M1',{planCode:'CUSTOM' as any});assert.equal(second.id,first.id);
 await assert.rejects(repo.createOrUpdateSubscription('M2',{planCode:'MISSING' as any}),/active subscription master/);
 const reference=new ReferenceDataController().get();assert.ok(reference.currencies.includes('INR'));assert.ok(reference.storeStatuses.includes('Active'));assert.ok(reference.timezones.length>100);
 console.log('PASS: master values override submitted defaults, zero price, custom code, stable subscription ID, missing-plan rejection and reference data');
}
main().catch(e=>{console.error(e);process.exitCode=1});
