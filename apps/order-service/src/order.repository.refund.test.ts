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

test('full refund uses every remaining captured cent after an earlier partial refund', async () => {
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const remaining = (repository as any).remainingPaymentAmount([
    { amount: 35.90, refund_amount: 8.64 },
  ]);
  assert.equal(remaining, 27.26);

  const result = await allocate([
    { id: 'payment-1', payment_method: 'cash', amount: 35.90, refund_amount: 8.64 },
  ], remaining);
  assert.deepEqual(result.updates[0].parameters.slice(0, 2), ['payment-1', 27.26]);
});

test('refunding the final remaining item quantities marks the order fully refunded', () => {
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const fullyRefunded = (repository as any).areAllLineItemsRefunded(
    [
      { id: 'item-1', quantity: 2 },
      { id: 'item-2', quantity: 3 },
    ],
    [{ order_item_id: 'item-1', quantity: 2 }],
    [{ order_item_id: 'item-2', quantity: 3 }],
  );
  assert.equal(fullyRefunded, true);
});

test('canonical item IDs determine completion when the POS snapshot has no IDs', () => {
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const storedLines = [
    { name: 'First', product_id: 1, quantity: 1, total: 5 },
    { name: 'Second', product_id: 2, quantity: 1, total: 5 },
  ];
  const canonicalLines = [
    { id: 'item-1', quantity: 1, total: 5 },
    { id: 'item-2', quantity: 1, total: 5 },
  ];
  const completionLines = canonicalLines.length ? canonicalLines : storedLines;

  assert.equal((repository as any).areAllLineItemsRefunded(
    completionLines,
    [{ order_item_id: 'item-1', quantity: 1 }],
    [{ order_item_id: 'item-2', quantity: 1 }],
  ), true);
});

test('an order remains partial while any item quantity is still refundable', () => {
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const fullyRefunded = (repository as any).areAllLineItemsRefunded(
    [
      { id: 'item-1', quantity: 2 },
      { id: 'item-2', quantity: 3 },
    ],
    [{ order_item_id: 'item-1', quantity: 1 }],
    [{ order_item_id: 'item-2', quantity: 3 }],
  );
  assert.equal(fullyRefunded, false);
});

test('a refund on a later local date creates a refund tracking row', async () => {
  const queries: Update[] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return [];
    },
  };
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const previousDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  await (repository as any).applyRefundToPayments(manager, [{
    id: 'payment-day-1', order_id: 'order-1', merchant_id: 'merchant-1', store_id: 'store-1',
    local_id: 'payment-1', payment_type: 'pos_payment', payment_method: 'cash',
    amount: 50, order_total: 50, remaining: 40, refund_amount: 10, currency: 'USD',
    status: 'partially-refunded', metadata: { refund_history: [{ created_at: previousDate }] },
  }], 5, { refund_id: 'refund-day-2', created_at: new Date().toISOString() }, 'UTC');

  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /^\s*UPDATE public\.store_pos_payments/);
  assert.deepEqual(queries[0].parameters.slice(0, 2), ['payment-day-1', 5]);
  assert.match(queries[1].sql, /^\s*UPDATE public\.store_pos_payments/);
  assert.match(queries[2].sql, /^\s*INSERT INTO public\.store_pos_payments/);
  assert.match(queries[2].sql, /'refunded', 'refund', false/);
  assert.equal(queries[2].parameters[14], 5);
  assert.match(String(queries[2].parameters[18]), /"daily_refund_tracking":true/);
  assert.match(String(queries[2].parameters[18]), /"refund_date":/);
});

test('multiple refunds on the same later local date update one daily refund row', async () => {
  const queries: Update[] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[]) => {
      queries.push({ sql, parameters });
      return queries.length === 2 ? [{ id: 'daily-refund-row' }] : [];
    },
  };
  const repository = Object.create(OrderRepository.prototype) as OrderRepository;
  const today = new Date().toISOString();

  await (repository as any).applyRefundToPayments(manager, [{
    id: 'payment-day-1', order_id: 'order-1', merchant_id: 'merchant-1', store_id: 'store-1',
    local_id: 'payment-1', payment_type: 'pos_payment', payment_method: 'cash',
    amount: 50, order_total: 50, remaining: 35, refund_amount: 15, currency: 'USD',
    status: 'partially-refunded', metadata: { refund_history: [{ created_at: today }] },
  }], 5, { refund_id: 'refund-same-day', created_at: today }, 'UTC');

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /^\s*UPDATE public\.store_pos_payments/);
  assert.match(queries[1].sql, /^\s*UPDATE public\.store_pos_payments/);
  assert.match(queries[1].sql, /entry_type = 'refund'/);
  assert.doesNotMatch(queries.map(({ sql }) => sql).join('\n'), /INSERT INTO public\.store_pos_payments/);
  assert.deepEqual(queries[1].parameters.slice(0, 2), ['payment-day-1', 5]);
});
