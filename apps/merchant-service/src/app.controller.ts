import { ValidationPipe, Inject, Controller, Get, Post, Put, Patch, Param, Body, Headers, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createCipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { MerchantRepository } from './merchant.repository';
import { BusinessType, RetailSubCategory, KycStatus, MerchantStatus } from './entities/merchant.entity';
import { PlanCode } from './entities/subscription.entity';
<<<<<<< HEAD
import { CreateStoreDto, CreateStoresDto, UpdateStoreDto } from './store.dto';
=======
import { StoreEntity, StoreStatus } from './entities/store.entity';
>>>>>>> 3ed0314e7bf901ae6aba82319f882ec67af15b2a


@Controller('api/v1')
export class AppController {
  constructor(@Inject(MerchantRepository) private readonly merchantRepository: MerchantRepository) {}
  private toBusinessType(value?: string): BusinessType {
    return value?.toUpperCase() === 'RESTAURANT' ? BusinessType.RESTAURANT : BusinessType.RETAIL;
  }

  private toPlanCode(value?: string): PlanCode {
    switch (value?.toUpperCase()) {
      case 'STARTER': return PlanCode.STARTER;
      case 'ENTERPRISE': return PlanCode.ENTERPRISE;
      default: return PlanCode.PRO; // UI label: Professional
    }
  }

  private toBillingCycle(value?: string): 'MONTHLY' | 'ANNUAL' | 'FREE_TRIAL' {
    if (value?.toUpperCase() === 'ANNUAL') return 'ANNUAL';
    if (value?.toUpperCase() === 'FREE TRIAL') return 'FREE_TRIAL';
    return 'MONTHLY';
  }

  private validateWizardPayload(body: any) {
    const required = ['merchantId', 'businessName', 'legalBusinessName', 'businessType', 'country', 'state', 'firstName', 'lastName', 'email', 'phone', 'plan'];
    const missing = required.filter((field) => !String(body[field] ?? '').trim());
    if (!Array.isArray(body.stores) || body.stores.length === 0) missing.push('stores');
    body.stores?.forEach((store: any, index: number) => {
      ['name', 'id', 'url', 'address', 'city', 'state', 'zip'].forEach((field) => {
        if (!String(store?.[field] ?? '').trim()) missing.push(`stores[${index}].${field}`);
      });
    }); 
    if (missing.length) throw new BadRequestException(`Missing required fields: ${missing.join(', ')}`);
  }

  private merchantFields(body: any) {
    return {
      id: body.merchantId,
      businessName: body.businessName.trim(),
      legalBusinessName: body.legalBusinessName.trim(),
      businessType: this.toBusinessType(body.businessType),
      retailSubCategory: body.businessType?.toUpperCase() === 'GROCERY' ? RetailSubCategory.GROCERY : body.businessType?.toUpperCase() === 'CONVENIENCE' ? RetailSubCategory.CONVENIENCE : undefined,
      ownerName: `${body.firstName.trim()} ${body.lastName.trim()}`,
      firstName: body.firstName.trim(),
      lastName: body.lastName.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim(),
      alternatePhone: body.alternatePhone?.trim() || undefined,
      jobTitle: body.jobTitle?.trim() || undefined,
      billingContact: body.billingContact !== false,
      taxId: body.taxId?.trim() || undefined,
      country: body.country.trim(),
      state: body.state.trim(),
      city: body.city?.trim() || undefined,
      postalCode: body.postalCode?.trim() || undefined,
      businessAddress: body.businessAddress?.trim() || undefined,
      status: MerchantStatus.ACTIVE,
      onboardingStep: 'COMPLETED',
    };
  }

  private async saveWizardStores(merchantId: string, stores: any[]) {
    return Promise.all(stores.map((store) => this.merchantRepository.createStore(merchantId, {
      id: store.id.trim(),
      storeName: store.name.trim(),
      storeCode: store.id.trim(),
      phone: store.phone?.trim() || '',
      storeType: store.type?.trim().toUpperCase() || 'RETAIL',
      address: { street: store.address.trim(), city: store.city.trim(), state: store.state.trim(), zipCode: store.zip.trim(), country: store.country?.trim() || 'USA' },
      currency: store.currency?.trim().toUpperCase() || 'USD',
      timezone: store.timezone?.trim() || 'UTC',
      status: store.status?.trim().toUpperCase() || 'ACTIVE',
    })));
  }

  @Post('merchants/create-merchant')
  async createMerchantFromWizard(@Body() body: any) {
    this.validateWizardPayload(body);
    const existing = await this.merchantRepository.getMerchantById(body.merchantId);
    if (existing.merchant) throw new ConflictException(`Merchant ID '${body.merchantId}' already exists`);

    const merchant = await this.merchantRepository.createMerchant(this.merchantFields(body));
    const stores = await this.saveWizardStores(merchant.id, body.stores);
    const subscription = await this.merchantRepository.createOrUpdateSubscription(merchant.id, {
      planCode: this.toPlanCode(body.plan),
      billingCycle: this.toBillingCycle(body.billingCycle),
      trialDays: Number(body.trialPeriod) || 0,
    });
    await this.merchantRepository.recordAuditLog('MERCHANT_ONBOARDING_COMPLETED', merchant.id, undefined, merchant.email, { storeCount: stores.length, plan: subscription.planCode });
    return { success: true, message: 'Merchant created successfully', merchant, stores, subscription };
  }

  @Put('merchants/:id')
  @Patch('merchants/:id')
  async updateMerchantFromWizard(@Param('id') id: string, @Body() body: any) {
    this.validateWizardPayload({ ...body, merchantId: id });
    const merchant = await this.merchantRepository.updateMerchant(id, this.merchantFields({ ...body, merchantId: id }));
    if (!merchant) throw new NotFoundException(`Merchant with ID '${id}' not found`);
    const subscription = await this.merchantRepository.createOrUpdateSubscription(id, {
      planCode: this.toPlanCode(body.plan), billingCycle: this.toBillingCycle(body.billingCycle), trialDays: Number(body.trialPeriod) || 0,
    });
    return { success: true, message: 'Merchant updated successfully', merchant, subscription };
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'merchant-service',
      version: '2.0.0 (PCH Module 1)',
      timestamp: new Date().toISOString(),
    };
  }

  // --- Step-by-Step Onboarding Endpoints ---

  @Post('onboarding/step1-business')
  async step1Business(@Body() body: { businessName: string; businessType?: BusinessType; retailSubCategory?: RetailSubCategory; ownerName: string; email: string; phone: string }) {
    if (!body.businessName || !body.email || !body.ownerName) {
      throw new BadRequestException('businessName, email, and ownerName are required');
    }
    const merchant = await this.merchantRepository.createMerchant({
      businessName: body.businessName,
      businessType: body.businessType || BusinessType.RETAIL,
      retailSubCategory: body.retailSubCategory,
      ownerName: body.ownerName,
      email: body.email,
      phone: body.phone,
      onboardingStep: 'STEP2_STORE',
    });
    return { success: true, step: 1, merchantId: merchant.id, merchant };
  }

  @Post('onboarding/step2-store')
  async step2Store(@Body() body: { merchantId: string; storeName: string; storeCode?: string; storeType?: string; address?: any; currency?: string; taxRate?: number }) {
    if (!body.merchantId || !body.storeName) {
      throw new BadRequestException('merchantId and storeName are required');
    }
    const store = await this.merchantRepository.createStore(body.merchantId, body);
    return { success: true, step: 2, storeId: store.id, activationPin: store.activationPin, store };
  }

  @Post('onboarding/step3-plan')
  async step3Plan(@Body() body: { merchantId: string; planCode: PlanCode; billingCycle?: 'MONTHLY' | 'ANNUAL' }) {
    if (!body.merchantId || !body.planCode) {
      throw new BadRequestException('merchantId and planCode are required');
    }
    const sub = await this.merchantRepository.createOrUpdateSubscription(body.merchantId, body);
    return { success: true, step: 3, subscriptionId: sub.id, entitlements: sub.entitlements, subscription: sub };
  }

  // --- All-in-One Complete Wizard Submission ---
  @Post('onboarding/complete')
  async completeOnboarding(@Body() body: any) {
    const merchant = await this.merchantRepository.createMerchant({
      businessName: body.businessName || 'Fresh Mart Organics LLC',
      businessType: body.businessType || BusinessType.RETAIL,
      retailSubCategory: body.retailSubCategory || (body.businessType === BusinessType.RETAIL ? RetailSubCategory.GROCERY : undefined),
      ownerName: body.ownerName || 'Alex Johnson',
      email: body.email || 'alex@freshmart.com',
      phone: body.phone || '+1 (555) 234-5678',
      taxId: body.taxId || '12-3456789',
      kycStatus: KycStatus.VERIFIED,
      status: MerchantStatus.ACTIVE,
      onboardingStep: 'COMPLETED',
    });

    const store = await this.merchantRepository.createStore(merchant.id, {
      storeName: body.storeName || `${merchant.businessName} - Main Store`,
      storeCode: body.storeCode || 'STR-MAIN-01',
      storeType: body.businessType || 'GROCERY',
      address: body.address || { street: '123 Main St', city: 'Austin', state: 'TX', zipCode: '78701', country: 'USA' },
      taxRate: body.taxRate || 8.25,
    });

    const subscription = await this.merchantRepository.createOrUpdateSubscription(merchant.id, {
      planCode: body.planCode || PlanCode.PRO,
    });

    return {
      success: true,
      message: 'Merchant onboarding completed successfully. Store is active!',
      merchant,
      store,
      subscription,
      terminalPairingPin: store.activationPin,
    };
  }

  // --- Flutter POS Activation by 6-Digit PIN ---
  @Post('stores/activate-terminal')
  async activateTerminal(@Body('activationPin') activationPin: string) {
    if (!activationPin || activationPin.trim().length !== 6) {
      throw new BadRequestException('A valid 6-digit activation PIN is required');
    }
    const result = await this.merchantRepository.activateTerminalByPin(activationPin.trim());
    if (!result.success) {
      throw new NotFoundException(result.message);
    }
    return {
      success: true,
      message: 'Terminal paired successfully with store!',
      store: result.store,
      entitlements: result.entitlements,
      sessionToken: `jwt_session_${Date.now()}_token`,
    };
  }

  /**
   * Saves the Website Connector tab. The supplied WordPress JWT is encrypted
   * before PostgreSQL receives it and is never included in this response.
   */
  @Put('stores/:storeId/connector')
  async saveWebsiteConnector(
    @Param('storeId') storeId: string,
    @Body() body: { wordpressUrl?: string; wordpressJwt?: string },
    @Headers('authorization') authorization?: string,
  ) {
    this.requireOwner(authorization);
    const wordpressUrl = this.validateWordPressUrl(body.wordpressUrl);
    const wordpressJwt = body.wordpressJwt?.trim();
    if (!wordpressJwt) throw new BadRequestException('wordpressJwt is required');

    const store = await this.merchantRepository.saveWebsiteConnector(storeId, {
      provider: 'WORDPRESS',
      wordpressUrl,
      encryptedJwt: this.encryptConnectorSecret(wordpressJwt),
      updatedAt: new Date().toISOString(),
    });
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    await this.merchantRepository.recordAuditLog(
      'STORE_WEBSITE_CONNECTOR_UPDATED',
      store.merchantId,
      store.id,
      'merchant',
      { provider: 'WORDPRESS', wordpressUrl },
    );
    return {
      success: true,
      storeId: store.id,
      connector: { provider: 'WORDPRESS', wordpressUrl, wordpressJwtConfigured: true },
    };
  }

  @Get('stores/:storeId/connector')
  async getWebsiteConnector(
    @Param('storeId') storeId: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.requireOwner(authorization);
    const connector = await this.merchantRepository.getWebsiteConnector(storeId);
    if (!connector) throw new NotFoundException(`Website connector for store '${storeId}' not found`);
    return {
      success: true,
      storeId,
      connector: {
        provider: connector.provider,
        wordpressUrl: connector.wordpressUrl,
        wordpressJwtConfigured: true,
        updatedAt: connector.updatedAt,
      },
    };
  }

  // --- Standard CRUD ---
<<<<<<< HEAD
  @Post(['stores', 'merchants/:merchantId/stores'])
  async createStore(
    @Body(new ValidationPipe({ transform: true, whitelist: true, expectedType: CreateStoreDto })) body: CreateStoreDto,
    @Param('merchantId') merchantId?: string,
  ) {
    if (merchantId && merchantId !== body.merchantId) {
      throw new BadRequestException('Merchant ID in the URL must match the request body');
    }
    const ownerId = merchantId || body.merchantId;
    const { merchant } = await this.merchantRepository.getMerchantById(ownerId);
    if (!merchant) throw new NotFoundException(`Merchant '${ownerId}' not found`);
    if (await this.merchantRepository.getStoreById(body.storeId)) {
      throw new ConflictException(`Store ID '${body.storeId}' already exists. Choose a different Store ID.`);
    }
    const store = await this.merchantRepository.createStore(ownerId, this.storeCreationFields(body, merchant.country));
    return { success: true, store };
  }

  private storeCreationFields(body: CreateStoreDto, country?: string) {
    const timezones: Record<string, string> = {
      Kolkata: 'Asia/Kolkata', 'Central Time (CT)': 'America/Chicago',
      'Eastern Time (ET)': 'America/New_York', 'Pacific Time (PT)': 'America/Los_Angeles',
    };
    return {
      id: body.storeId, storeCode: body.storeId, storeName: body.name.trim(),
      storeType: body.type?.trim().toUpperCase() || 'RETAIL',
      phone: body.phone?.trim() || '', baseUrl: body.url?.trim(),
      currency: body.currency, status: body.status,
      timezone: timezones[body.timezone || ''] || body.timezone || 'UTC',
      address: { street: body.address.trim(), city: body.city.trim(), state: body.state.trim(),
        zipCode: body.zip.trim(), country: country || '' },
    };
  }

  @Post('merchants/:merchantId/stores/bulk')
  async createStoresBatch(@Param('merchantId') merchantId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, expectedType: CreateStoresDto })) body: CreateStoresDto) {
    if (body.stores.some(s => s.merchantId !== merchantId)) {
      throw new BadRequestException('All stores must belong to the merchant in the URL');
    }
    const { merchant } = await this.merchantRepository.getMerchantById(merchantId);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const stores = await this.merchantRepository.createStoresBatch(merchantId,
      body.stores.map(s => this.storeCreationFields(s, merchant.country)));
    return { success: true, count: stores.length, stores };
  }

  @Get(['stores', 'merchants/:merchantId/stores'])
  async listStores(@Param('merchantId') merchantId?: string) {
    const [stores, merchants] = await Promise.all([
      this.merchantRepository.listStores(merchantId),
      this.merchantRepository.getAllMerchants(),
    ]);
    const names = new Map(merchants.map(m => [m.id, m.businessName]));
    if (merchantId && !names.has(merchantId)) throw new NotFoundException('Merchant not found');
    // Listing deliberately excludes activation PINs and channel credentials.
    const rows = stores.map(s => ({
      id: s.id, merchantId: s.merchantId, merchantName: names.get(s.merchantId) || s.merchantId,
      storeName: s.storeName, storeType: s.storeType, address: s.address,
      status: s.status, currency: s.currency, timezone: s.timezone,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
      deviceCount: null, lastSyncAt: null,
    }));
    return { success: true, count: rows.length, stores: rows };
  }

  @Get(['stores/:storeId', 'merchants/:merchantId/stores/:storeId'])
  async getStore(@Param('storeId') storeId: string, @Param('merchantId') merchantId?: string) {
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store || (merchantId && store.merchantId !== merchantId)) throw new NotFoundException(`Store '${storeId}' not found`);
    return { success: true, store };
  }

  @Put(['stores/:storeId', 'merchants/:merchantId/stores/:storeId'])
  async updateStore(@Param('storeId') storeId: string, @Body(new ValidationPipe({ transform: true, whitelist: true, expectedType: UpdateStoreDto })) body: UpdateStoreDto,
    @Param('merchantId') merchantId?: string) {
    const existing = await this.merchantRepository.getStoreById(storeId);
    if (!existing || (merchantId && existing.merchantId !== merchantId)) {
      throw new NotFoundException(`Store '${storeId}' not found`);
    }
    if (body.storeId !== storeId || body.merchantId !== existing.merchantId) {
      throw new BadRequestException('Merchant and store ID cannot be changed');
    }
    const store = await this.merchantRepository.updateStore(storeId, {
      storeName: body.name.trim(),
      storeType: body.type?.trim().toUpperCase() ?? existing.storeType,
      phone: body.phone?.trim() ?? existing.phone,
      baseUrl: body.url?.trim() ?? existing.baseUrl,
      currency: body.currency ?? existing.currency,
      status: body.status ?? existing.status,
      timezone: body.timezone ?? existing.timezone,
      address: { ...existing.address, street: body.address.trim(), city: body.city.trim(),
        state: body.state.trim(), zipCode: body.zip.trim() },
    });
=======
  @Get('stores/:storeId')
  async getStore(@Param('storeId') storeId: string) {
    const store = await merchantRepository.getStoreById(storeId);
>>>>>>> 3ed0314e7bf901ae6aba82319f882ec67af15b2a
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    return { success: true, store };
  }

<<<<<<< HEAD
=======
  private storeFields(body: any, existing?: StoreEntity): Partial<StoreEntity> {
    const limits: Record<string, number> = { name: 255, storeId: 50, address: 1000, city: 255, state: 255, zip: 50 };
    for (const [field, limit] of Object.entries(limits)) {
      if (typeof body[field] !== 'string' || !body[field].trim() || body[field].trim().length > limit) {
        throw new BadRequestException(`${field} is required and must be at most ${limit} characters`);
      }
    }
    for (const [field, limit] of Object.entries({ type: 50, phone: 50, currency: 100, timezone: 100, status: 50 })) {
      if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > limit)) {
        throw new BadRequestException(`Invalid ${field}`);
      }
    }
    const status = (body.status || 'ACTIVE').toUpperCase() as StoreStatus;
    if (!Object.values(StoreStatus).includes(status)) throw new BadRequestException('Invalid store status');
    const currency = (body.currency || 'USD').split(' - ')[0].trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Currency must be a three-letter code');
    return {
      storeName: body.name.trim(), storeType: body.type?.trim().toUpperCase() || 'RETAIL',
      phone: body.phone?.trim() || '', currency, status, timezone: body.timezone?.trim() || 'UTC',
      address: { ...existing?.address, street: body.address.trim(), city: body.city.trim(),
        state: body.state.trim(), zipCode: body.zip.trim(), country: existing?.address?.country || 'USA' },
    };
  }

  @Put(['stores/:storeId', 'merchants/:merchantId/stores/:storeId'])
  async updateStore(@Param('storeId') storeId: string, @Body() body: any, @Param('merchantId') merchantId?: string) {
    const existing = await merchantRepository.getStoreById(storeId);
    if (!existing) throw new NotFoundException(`Store '${storeId}' not found`);
    if (merchantId && merchantId !== existing.merchantId) {
      throw new NotFoundException(`Store '${storeId}' not found for this merchant`);
    }
    if (body.merchantId !== existing.merchantId || body.storeId !== storeId) {
      throw new BadRequestException('Merchant and store ID cannot be changed');
    }
    const store = await merchantRepository.updateStore(storeId, this.storeFields(body, existing));
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    return { success: true, store };
  }

  @Post(['stores', 'merchants/:merchantId/stores'])
  async createStore(@Param('merchantId') merchantId: string | undefined, @Body() body: any) {
    const ownerId = merchantId || body.merchantId;
    if (!ownerId || !(await merchantRepository.getMerchantById(ownerId)).merchant) {
      throw new NotFoundException('Merchant not found');
    }
    const fields = this.storeFields(body);
    if (await merchantRepository.getStoreById(body.storeId.trim())) throw new ConflictException('Store ID already exists');
    const store = await merchantRepository.createStore(ownerId, { ...fields, id: body.storeId.trim(), storeCode: body.storeId.trim() });
    return { success: true, store };
  }

>>>>>>> 3ed0314e7bf901ae6aba82319f882ec67af15b2a
  @Get('merchants')
  async getAllMerchants() {
    const list = await this.merchantRepository.getAllMerchants();
    return { success: true, count: list.length, merchants: list };
  }

  @Get('merchants/:id')
  async getMerchantById(@Param('id') id: string) {
    const result = await this.merchantRepository.getMerchantById(id);
    if (!result.merchant) {
      throw new NotFoundException(`Merchant with ID '${id}' not found`);
    }
    return { success: true, ...result };
  }

  private validateWordPressUrl(value?: string): string {
    if (!value?.trim()) throw new BadRequestException('wordpressUrl is required');
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:') throw new Error('not https');
      return url.toString().replace(/\/$/, '');
    } catch {
      throw new BadRequestException('wordpressUrl must be a valid HTTPS URL');
    }
  }

  private encryptConnectorSecret(value: string): string {
    const keyValue = process.env.STORE_CONFIG_ENCRYPTION_KEY;
    if (!keyValue) {
      throw new InternalServerErrorException('STORE_CONFIG_ENCRYPTION_KEY is not configured');
    }
    const key = Buffer.from(keyValue, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException('STORE_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
  }

  private requireOwner(authorization?: string): void {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const secret = process.env.AUTH_JWT_SECRET;
    if (!token || !secret) throw new UnauthorizedException('Owner bearer token is required');
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) throw new UnauthorizedException('Invalid access token');
    const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException('Invalid access token');
    }
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        role?: string; type?: string; exp?: number;
      };
      if (payload.type !== 'access' || typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException('Access token has expired');
      }
      if (payload.role !== 'OWNER') throw new ForbiddenException('Only owners may manage website connectors');
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
