import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { MerchantRepository } from './merchant.repository';
import { MerchantOnboardingDto } from './onboarding.dto';

const validate = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, expectedType: MerchantOnboardingDto });

@Controller('api/v1/merchants')
export class OnboardingController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Post('onboarding')
  async create(@Body(validate) body: MerchantOnboardingDto) {
    if (!body.subscription) throw new BadRequestException('subscription is required when creating a merchant');
    return { success: true, ...await this.repository.saveOnboarding(body, false) };
  }

  @Put(':id/onboarding')
  async update(@Param('id') id: string, @Body(validate) body: MerchantOnboardingDto) {
    if (body.merchant.code !== id) throw new BadRequestException('Merchant code cannot be changed');
    return { success: true, ...await this.repository.saveOnboarding(body, true) };
  }

  @Get(':id/onboarding')
  async get(@Param('id') id: string) {
    const result = await this.repository.getMerchantById(id);
    if (!result.merchant) throw new NotFoundException('Merchant not found');
    const m = result.merchant;
    return { success: true, merchant: {
      code: m.id, business: m.legalBusinessName || m.businessName, display: m.businessName,
      name: m.ownerName, email: m.email, phone: m.phone, country: m.country,
      city: m.city, state: m.state, address: m.businessAddress, postal: m.postalCode,
    }, subscription: result.subscription, stores: result.stores.map(store => ({
      ...store.onboardingSetup, merchantId: store.merchantId, storeId: store.id, name: store.storeName,
      type: store.storeType, phone: store.phone, url: store.baseUrl, currency: store.currency,
      status: store.status, timezone: store.timezone, country: store.address.country,
      address: store.address.street, city: store.address.city, state: store.address.state, zip: store.address.zipCode,
    })) };
  }
}
