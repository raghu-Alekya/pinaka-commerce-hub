import { Controller, Get, Post, Body, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { LoyaltyRepository } from './loyalty.repository';

const loyaltyRepository = new LoyaltyRepository();
loyaltyRepository.onModuleInit();

@Controller('api/v1/loyalty')
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'loyalty-service',
      version: '2.0.0 (PCH Module 8)',
      timestamp: new Date().toISOString(),
    };
  }

  // --- 1. Lookup Customer Loyalty Profile by Phone (Sunmi POS Checkout) ---
  @Get('customer/lookup')
  async lookupCustomer(@Query('phone') phone: string) {
    const targetPhone = phone || '+1 (555) 019-2831';
    const customer = await loyaltyRepository.getCustomerByPhone(targetPhone);
    if (!customer) {
      throw new NotFoundException(`Customer with phone '${targetPhone}' not found`);
    }
    return {
      success: true,
      customer,
    };
  }

  // --- 2. Earn Points on Order Completion ---
  @Post('points/earn')
  async earnPoints(@Body() body: { customerId: string; orderId: string; orderTotal: number }) {
    if (!body.customerId || !body.orderId || !body.orderTotal) {
      throw new BadRequestException('customerId, orderId, and orderTotal are required');
    }
    const result = await loyaltyRepository.earnPoints(body.customerId, body.orderId, Number(body.orderTotal));
    return {
      success: true,
      message: `Customer earned ${result.pointsEarned} loyalty points!`,
      pointsEarned: result.pointsEarned,
      newPointsBalance: result.customer.rewardPointsBalance,
      tier: result.customer.loyaltyTier,
      customer: result.customer,
    };
  }

  // --- 3. Validate & Apply Promo Code (Sunmi POS / Web Cart) ---
  @Post('promotions/validate')
  async validatePromoCode(@Body() body: { promoCode: string; orderAmount: number }) {
    if (!body.promoCode || !body.orderAmount) {
      throw new BadRequestException('promoCode and orderAmount are required');
    }
    const result = await loyaltyRepository.validatePromoCode(body.promoCode, Number(body.orderAmount));
    if (!result.isValid) {
      throw new BadRequestException(result.message);
    }
    return {
      success: true,
      message: `Promo Code '${body.promoCode.toUpperCase()}' applied successfully!`,
      discountAmount: result.discountAmount,
      promo: result.promo,
    };
  }
}
