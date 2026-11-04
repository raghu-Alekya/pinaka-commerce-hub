import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AnalyticsRepository } from './analytics.repository';

type SalesPeriod = 'daily' | 'weekly' | 'monthly';
type Period = { label: string; start: string; end: string };

function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function dateAtNoon(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

function addDays(key: string, days: number): string {
  const date = dateAtNoon(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function salesPeriods(type: SalesPeriod, today: string): Period[] {
  const date = dateAtNoon(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (type === 'daily') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const monday = addDays(today, -mondayOffset);
    return Array.from({ length: 7 }, (_, index) => {
      const start = addDays(monday, index);
      return { label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index], start, end: start };
    });
  }
  if (type === 'weekly') {
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const last = dateKey(new Date(Date.UTC(year, month + 1, 0, 12)));
    const periods: Period[] = [];
    for (let start = first, index = 1; start <= last; index += 1) {
      const mondayOffset = (dateAtNoon(start).getUTCDay() + 6) % 7;
      const daysUntilSunday = 6 - mondayOffset;
      const daysRemaining = Math.round((dateAtNoon(last).getTime() - dateAtNoon(start).getTime()) / 86_400_000);
      const end = addDays(start, Math.min(daysUntilSunday, daysRemaining));
      periods.push({ label: `Week ${index}`, start, end });
      start = addDays(end, 1);
    }
    return periods;
  }
  return Array.from({ length: 12 }, (_, index) => {
    const start = `${year}-${String(index + 1).padStart(2, '0')}-01`;
    const end = dateKey(new Date(Date.UTC(year, index + 1, 0, 12)));
    return { label: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, index, 1, 12))), start, end };
  });
}

function parseIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('date must be a valid YYYY-MM-DD date');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('date must be a valid YYYY-MM-DD date');
  }
  return value;
}

@Injectable()
export class SalesReportsService {
  constructor(@Inject(AnalyticsRepository) private readonly repository: AnalyticsRepository) {}

  private async timezoneForStore(storeId: string): Promise<string> {
    const timezone = process.env.REPORT_TIMEZONE
      || await this.repository.getStoreReportTimezone?.(storeId)
      || 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      return timezone;
    } catch {
      return 'UTC';
    }
  }

  async sales(typeValue: string | undefined, storeId: string, merchantId: string, now = new Date()) {
    const type = (typeValue || 'daily').toLowerCase();
    if (!['daily', 'weekly', 'monthly'].includes(type)) {
      throw new BadRequestException('type must be one of: daily, weekly, monthly');
    }
    const timezone = await this.timezoneForStore(storeId);
    const periods = salesPeriods(type as SalesPeriod, localDate(now, timezone));
    const rows = await this.repository.querySalesReport(
      storeId,
      merchantId,
      timezone,
      periods[0].start,
      periods[periods.length - 1].end,
    );
    const byDate = new Map(rows.map((row) => [row.local_date, row]));
    const chart = periods.map((period) => {
      let orders = 0;
      let sales = 0;
      for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
        const row = byDate.get(date);
        orders += Number(row?.orders || 0);
        sales += Number(row?.sales || 0);
      }
      return { label: period.label, orders, sales: Number(sales.toFixed(2)) };
    });
    return {
      total_sales: Number(chart.reduce((sum, item) => sum + item.sales, 0).toFixed(2)),
      total_orders: chart.reduce((sum, item) => sum + item.orders, 0),
      chart,
    };
  }

  async shiftSales(dateValue: string | undefined, storeId: string, merchantId: string) {
    const timezone = await this.timezoneForStore(storeId);
    const date = dateValue === undefined ? localDate(new Date(), timezone) : parseIsoDate(dateValue);
    const rows = await this.repository.queryShiftSales(storeId, merchantId, timezone, date);
    const shifts = rows.map((row) => ({
      shift_name: row.shift_name,
      orders: Number(row.orders || 0),
      sales: Number(Number(row.sales || 0).toFixed(2)),
    }));
    return {
      date,
      total_sales: Number(shifts.reduce((sum, shift) => sum + shift.sales, 0).toFixed(2)),
      total_orders: shifts.reduce((sum, shift) => sum + shift.orders, 0),
      shifts,
    };
  }
}
