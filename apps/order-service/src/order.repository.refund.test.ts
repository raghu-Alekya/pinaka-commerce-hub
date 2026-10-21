import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { OrderRepository } from './order.repository';

type Update = { sql: string; parameters: unknown[] };

async function allocate(
  payments: Array<{ id: string; payment_method: string; amount: number; refund_amount: number }>,
  amount: number,
) {
  const updates: Update[] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[]) => {
      updates.push({ sql, parameters });
      return [];
    },
  };
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const method = (repository as any).applyRefundToPayments.bind(repository);
  const paymentMethod = await method(manager, payments, amount, {
    refund_id: 'refund-1',
    refund_type: 'partial',
  });
  return { updates, paymentMethod };
}

test('refund updates the existing payment row without inserting a refund row', async () => {
  const result = await allocate([
    { id: 'payment-1', payment_method: 'cash', amount: 80, refund_amount: 0 },
  ], 25);

  assert.equal(result.updates.length, 1);
  assert.match(result.updates[0].sql, /^\s*UPDATE public\.store_pos_payments/);
  assert.doesNotMatch(result.updates[0].sql, /INSERT\s+INTO/i);
  assert.deepEqual(result.updates[0].parameters.slice(0, 2), ['payment-1', 25]);
  assert.equal(result.paymentMethod, 'cash');
});

test('full refund consumes every remaining split-payment balance', async () => {
  const result = await allocate([
    { id: 'cash-payment', payment_method: 'cash', amount: 60, refund_amount: 0 },
    { id: 'card-payment', payment_method: 'card', amount: 40, refund_amount: 0 },
  ], 100);

  assert.deepEqual(result.updates.map(({ parameters }) => parameters.slice(0, 2)), [
    ['cash-payment', 60],
    ['card-payment', 40],
  ]);
});

test('partial refund is distributed over the actual remaining payment capacity', async () => {
  const result = await allocate([
    { id: 'payment-1', payment_method: 'cash', amount: 60, refund_amount: 30 },
    { id: 'payment-2', payment_method: 'card', amount: 40, refund_amount: 0 },
  ], 35);

  assert.deepEqual(result.updates.map(({ parameters }) => parameters.slice(0, 2)), [
    ['payment-1', 15],
    ['payment-2', 20],
  ]);
});

test('refund allocation remains exact to one cent', async () => {
  const result = await allocate([
    { id: 'payment-1', payment_method: 'cash', amount: 1, refund_amount: 0 },
    { id: 'payment-2', payment_method: 'card', amount: 1, refund_amount: 0 },
  ], 0.01);

  assert.equal(result.updates.length, 1);
  assert.deepEqual(result.updates[0].parameters.slice(0, 2), ['payment-1', 0.01]);
});

test('refund exceeding captured payment balance is rejected before any update', async () => {
  await assert.rejects(
    allocate([
      { id: 'payment-1', payment_method: 'cash', amount: 50, refund_amount: 20 },
    ], 30.01),
    BadRequestException,
  );
});
