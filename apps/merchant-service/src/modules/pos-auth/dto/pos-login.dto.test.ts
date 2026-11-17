import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PosLoginDto } from './pos-login.dto';

test('POS login accepts the legacy device-id request property', async () => {
  const dto = plainToInstance(PosLoginDto, {
    pin: '123456',
    'device-id': 'DEV-99881111',
    merchantId: 'ce7e95a3-5dd3-4063-af03-251825c9a2d9',
    storeId: '5066038f-0e26-40f5-a4bf-44a1bdd300ac',
  });

  assert.equal(dto['device-id'], 'DEV-99881111');
  assert.deepEqual(await validate(dto, { whitelist: true }), []);
});

test('POS login keeps deviceId as the canonical property', async () => {
  const dto = plainToInstance(PosLoginDto, {
    pin: '123456',
    deviceId: 'DEV-CANONICAL',
    device_id: 'DEV-SNAKE',
    'device-id': 'DEV-KEBAB',
  });

  assert.equal(dto.deviceId, 'DEV-CANONICAL');
  assert.deepEqual(await validate(dto, { whitelist: true }), []);
});
