import 'reflect-metadata';
import assert from 'node:assert/strict';
import { AppController } from '../apps/merchant-service/src/app.controller';
async function main() {
 let saved: any;
 let updates = 0;
 const repo: any = {
  getSubscriptionPlan: async () => ({status:'ACTIVE'}),
  getMerchantById: async () => ({ merchant: { id: 'm' } }),
  getStoreById: async (id: string) => ({ id, merchantId: id === 'foreign' ? 'other' : 'm' }),
  updateMerchant: async () => { updates++; return { id: 'm' }; },
  createOrUpdateSubscription: async () => ({}),
  updateStore: async (_: string, fields: any) => (saved = fields),
 };
 const controller = new AppController(repo);
 const body = { businessName:'Shop',legalBusinessName:'Shop LLC',businessType:'Retail',country:'India',state:'TS',firstName:'A',lastName:'B',email:'a@example.com',phone:'123',plan:'Professional',stores:[{id:'s',name:'Branch',url:'https://example.com',address:'Road',city:'Hyderabad',state:'TS',zip:'500001'}] };
 await controller.updateMerchantFromWizard('m', body);
 assert.equal(saved.baseUrl, 'https://example.com');
 assert.equal(saved.address.country, 'India');
 await assert.rejects(controller.updateMerchantFromWizard('m', {...body, stores:[{...body.stores[0],id:'foreign'}]}), /another merchant/);
 assert.equal(updates, 1);
 await assert.rejects(controller.updateMerchantFromWizard('m', {...body, stores:{}}), /Missing required fields/);
 console.log('PASS: merchant edits persist store URL and country; invalid stores and foreign ownership rejected');
}
main().catch(error => { console.error(error); process.exitCode=1; });
