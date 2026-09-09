import 'reflect-metadata';
import assert from 'node:assert/strict';
import { MerchantRepository } from '../apps/merchant-service/src/merchant.repository';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStoresDto } from '../apps/merchant-service/src/store.dto';
async function main() {
 const repo=new MerchantRepository(); (repo as any).isDbConnected=false;
 const stores=await repo.createStoresBatch('M1',[{id:'A',storeCode:'A'},{id:'B',storeCode:'B'}]);
 assert.equal(stores.length,2);
 await assert.rejects(()=>repo.createStoresBatch('M1',[{id:'C',storeCode:'C'},{id:'A',storeCode:'A'}]));
 assert.equal(await repo.getStoreById('C'),null);
 await assert.rejects(()=>repo.createStoresBatch('M1',[{id:'D',storeCode:'D'},{id:'D',storeCode:'D'}]));
 assert.equal(await repo.getStoreById('D'),null);
 assert.ok((await validate(plainToInstance(CreateStoresDto,{stores:[]}))).length);
 assert.ok((await validate(plainToInstance(CreateStoresDto,{stores:[{}]}))).length);
 console.log('PASS: multiple stores, duplicate rejection, no partial memory writes, nested validation');
}
main().catch(e=>{console.error(e);process.exitCode=1});
