import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { salesPeriods, SalesReportsService } from './sales-reports';
import { AnalyticsRepository } from './analytics.repository';

test('daily periods cover Monday through Sunday of the current week', () => {
  const periods = salesPeriods('daily', '2026-10-22');
  assert.equal(periods.length, 7);
  assert.deepEqual(periods.map((period) => period.start), [
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
  ]);
});

test('weekly periods use Monday to Sunday blocks clipped to the current month', () => {
  const periods = salesPeriods('weekly', '2026-10-22');
  assert.equal(periods.length, 5);
  assert.deepEqual(periods.map(({ start, end }) => [start, end]), [
    ['2026-10-01', '2026-10-04'], ['2026-10-05', '2026-10-11'], ['2026-10-12', '2026-10-18'],
    ['2026-10-19', '2026-10-25'], ['2026-10-26', '2026-10-31'],
  ]);
});

test('monthly periods return all twelve calendar months', () => {
  const periods = salesPeriods('monthly', '2026-10-22');
  assert.equal(periods.length, 12);
  assert.equal(periods[0].label, 'Jan');
  assert.equal(periods[11].end, '2026-12-31');
});

test('sales totals aggregate all returned chart periods and zero-fill empty dates', async () => {
  const repository = {
    querySalesReport: async () => [
      { local_date: '2026-10-19', orders: 2, sales: '35.50' },
      { local_date: '2026-10-22', orders: 1, sales: '10.00' },
    ],
    queryShiftSales: async () => [],
  } as any;
  const reports = new SalesReportsService(repository);
  const result = await reports.sales('daily', 'store-1', 'merchant-1', new Date('2026-10-22T12:00:00Z'));
  assert.equal(result.total_orders, 3);
  assert.equal(result.total_sales, 45.5);
  assert.deepEqual(result.chart.map((item) => item.orders), [2, 0, 0, 1, 0, 0, 0]);
});

test('sales rejects unsupported types', async () => {
  const reports = new SalesReportsService({ querySalesReport: async () => [] } as any);
  await assert.rejects(() => reports.sales('yearly', 'store-1', 'merchant-1'), BadRequestException);
});

test('shift sales validates dates and aggregates returned shifts', async () => {
  const repository = {
    querySalesReport: async () => [],
    queryShiftSales: async () => [
      { shift_id: 'shift-1', shift_name: 'Morning Shift', orders: 2, sales: '30.00' },
      { shift_id: 'shift-2', shift_name: 'Evening Shift', orders: 1, sales: '12.50' },
    ],
  } as any;
  const reports = new SalesReportsService(repository);
  const result = await reports.shiftSales('2026-10-22', 'store-1', 'merchant-1');
  assert.equal(result.total_orders, 3);
  assert.equal(result.total_sales, 42.5);
  assert.equal(result.shifts[0].shift_name, 'Morning Shift');
  await assert.rejects(() => reports.shiftSales('2026-02-30', 'store-1', 'merchant-1'), BadRequestException);
});

test('empty sales and shift datasets return zero totals and empty periods or shifts', async () => {
  const repository = {
    querySalesReport: async () => [],
    queryShiftSales: async () => [],
  } as any;
  const reports = new SalesReportsService(repository);
  const sales = await reports.sales('monthly', 'store-1', 'merchant-1', new Date('2026-10-22T12:00:00Z'));
  assert.equal(sales.total_orders, 0);
  assert.equal(sales.total_sales, 0);
  assert.equal(sales.chart.length, 12);
  assert.deepEqual(await reports.shiftSales('2026-10-22', 'store-1', 'merchant-1'), {
    date: '2026-10-22', total_sales: 0, total_orders: 0, shifts: [],
  });
});

test('repository queries use PCH order status, shift relationship, date, and tenant fields', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const repository = new AnalyticsRepository() as any;
  repository.dataSource = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [];
    },
  };
  await repository.querySalesReport('store-1', 'merchant-1', 'Asia/Kolkata', '2026-10-19', '2026-10-25');
  await repository.queryShiftSales('store-1', 'merchant-1', 'Asia/Kolkata', '2026-10-22');
  assert.match(calls[0].sql, /lower\(status\) IN \('completed', 'processing'\)/);
  assert.match(calls[0].sql, /store_id = \$1/);
  assert.match(calls[0].sql, /merchant_id = \$2/);
  assert.match(calls[0].sql, /SELECT \(created_at AT TIME ZONE \$3\)/);
  assert.deepEqual(calls[0].params, ['store-1', 'merchant-1', 'Asia/Kolkata', '2026-10-19', '2026-10-25']);
  assert.match(calls[1].sql, /sale\.shift_id = shift\.id OR sale\.local_shift_id = shift\.id/);
  assert.match(calls[1].sql, /sale\.store_id::text = shift\.store_id/);
  assert.match(calls[1].sql, /lower\(sale\.status\) = 'completed'/);
  assert.match(calls[1].sql, /shift\.merchant_id = \$2/);
  assert.match(calls[1].sql, /opened_at AT TIME ZONE \$3/);
  assert.match(calls[1].sql, /public\.employees AS employee/);
  assert.match(calls[1].sql, /opener_meta\.meta_value/);
  assert.match(calls[1].sql, /cashier\.meta_value/);
});
