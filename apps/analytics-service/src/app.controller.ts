import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsRepository } from './analytics.repository';

const analyticsRepository = new AnalyticsRepository();
analyticsRepository.onModuleInit();

@Controller('api/v1/analytics')
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'analytics-service',
      version: '2.0.0 (PCH Module 9)',
      timestamp: new Date().toISOString(),
    };
  }

  // --- 1. Executive Financial Dashboard KPIs ---
  @Get('dashboard')
  async getDashboardKpis(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const kpis = await analyticsRepository.getDashboardKpis(targetStore);
    return {
      success: true,
      storeId: targetStore,
      currency: 'USD',
      metrics: {
        totalGrossSales: Number(kpis.totalGrossSales),
        totalNetSales: Number(kpis.totalNetSales),
        totalOrdersCount: Number(kpis.totalOrdersCount),
        averageOrderValue: Number(kpis.averageOrderValue),
        totalTaxCollected: Number(kpis.totalTaxCollected),
        totalDiscountsGiven: Number(kpis.totalDiscountsGiven),
      },
      lastUpdated: kpis.updatedAt || kpis.createdAt,
    };
  }

  // --- 2. Top Revenue & Quantity Products Report ---
  @Get('top-products')
  async getTopProducts(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const products = await analyticsRepository.getTopProducts(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: products.length,
      topProducts: products,
    };
  }

  // --- 3. Sales Channel Performance Breakdown (POS vs Web vs Delivery) ---
  @Get('channels')
  async getChannelBreakdown(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const channels = await analyticsRepository.getChannelBreakdown(targetStore);
    return {
      success: true,
      storeId: targetStore,
      channelBreakdown: channels,
    };
  }

  // --- 4. Daily Z-Report Financial Summary ---
  @Get('z-report')
  async getZReportSummary(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const kpis = await analyticsRepository.getDashboardKpis(targetStore);
    return {
      success: true,
      reportType: 'DAILY_Z_REPORT',
      storeId: targetStore,
      date: kpis.dateString || '2026-09-03',
      financials: {
        grossSales: Number(kpis.totalGrossSales),
        tax: Number(kpis.totalTaxCollected),
        discounts: Number(kpis.totalDiscountsGiven),
        netSales: Number(kpis.totalNetSales),
        cashSales: Number(kpis.channelBreakdown?.IN_STORE_POS || 1450.00) * 0.4,
        cardSales: Number(kpis.channelBreakdown?.IN_STORE_POS || 1450.00) * 0.6,
        onlineSales: Number(kpis.channelBreakdown?.WOOCOMMERCE || 680.00) + Number(kpis.channelBreakdown?.DOORDASH || 220.80),
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
