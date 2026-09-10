import { ValidationPipe, Inject, Controller, Get, Post, Put, Patch, Param, Body, Req, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Public } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';
import { BusinessType, RetailSubCategory, KycStatus, MerchantStatus } from './entities/merchant.entity';
import { PlanCode } from './entities/subscription.entity';
import { CreateStoreDto, CreateStoresDto, UpdateStoreDto } from './store.dto';
import { WebsiteConnectionEntity } from './entities/website-connection.entity';


@Controller('api/v1')
export class AppController {
  constructor(@Inject(MerchantRepository) private readonly merchantRepository: MerchantRepository) {}
  private toBusinessType(value?: string): BusinessType {
    return value?.toUpperCase() === 'RESTAURANT' ? BusinessType.RESTAURANT : BusinessType.RETAIL;
  }

  private toPlanCode(value?: string): PlanCode {
    return (value?.trim().toUpperCase() || '') as PlanCode;
  }

  private async requireMasterPlan(code: string) {
    const plan = await this.merchantRepository.getSubscriptionPlan(this.toPlanCode(code));
    if (!plan || plan.status !== 'ACTIVE') throw new BadRequestException('Select an active subscription master plan');
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
    (Array.isArray(body.stores) ? body.stores : []).forEach((store: any, index: number) => {
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
      retailSubCategory: body.retailSubCategory?.toUpperCase() || (body.businessType?.toUpperCase() === 'GROCERY' ? RetailSubCategory.GROCERY : body.businessType?.toUpperCase() === 'CONVENIENCE' ? RetailSubCategory.CONVENIENCE : undefined),
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

  private async saveWizardStores(merchantId: string, stores: any[], country: string, editing = false) {
    return Promise.all(stores.map(async (store) => {
      const fields = {
      id: store.id.trim(),
      storeName: store.name.trim(),
      storeCode: store.id.trim(),
      baseUrl: store.url?.trim(),
      phone: store.phone?.trim() || '',
      storeType: store.type?.trim().toUpperCase() || 'RETAIL',
      address: { street: store.address.trim(), city: store.city.trim(), state: store.state.trim(), zipCode: store.zip.trim(), country },
      currency: store.currency?.trim().toUpperCase() || 'USD',
      timezone: store.timezone?.trim() || 'UTC',
      status: store.status?.trim().toUpperCase() || 'ACTIVE',
    };
      const existing = editing ? await this.merchantRepository.getStoreById(fields.id) : null;
      return existing
        ? this.merchantRepository.updateStore(fields.id, fields)
        : this.merchantRepository.createStore(merchantId, fields);
    }));
  }

  @Post('merchants/create-merchant')
  async createMerchantFromWizard(@Body() body: any) {
    this.validateWizardPayload(body);
    await this.requireMasterPlan(body.plan);
    const existing = await this.merchantRepository.getMerchantById(body.merchantId);
    if (existing.merchant) throw new ConflictException(`Merchant ID '${body.merchantId}' already exists`);

    const merchant = await this.merchantRepository.createMerchant(this.merchantFields(body));
    const stores = await this.saveWizardStores(merchant.id, body.stores, body.country);
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
    await this.requireMasterPlan(body.plan);
    const current = await this.merchantRepository.getMerchantById(id);
    if (!current.merchant) throw new NotFoundException('Merchant not found');
    const ids = body.stores.map((store: any) => store.id.trim());
    if (new Set(ids).size !== ids.length) throw new ConflictException('Each store must have a unique ID');
    for (const storeId of ids) {
      const store = await this.merchantRepository.getStoreById(storeId);
      if (store && store.merchantId !== id) throw new ConflictException('Store belongs to another merchant');
    }
    const merchant = await this.merchantRepository.updateMerchant(id, this.merchantFields({ ...body, merchantId: id }));
    if (!merchant) throw new NotFoundException(`Merchant with ID '${id}' not found`);
    const subscription = await this.merchantRepository.createOrUpdateSubscription(id, {
      planCode: this.toPlanCode(body.plan), billingCycle: this.toBillingCycle(body.billingCycle), trialDays: Number(body.trialPeriod) || 0,
    });
    const stores = await this.saveWizardStores(id, body.stores, body.country, true);
    return { success: true, message: 'Merchant updated successfully', merchant, stores, subscription };
  }

  @Post('ids/:kind')
  async allocateId(@Param('kind') kind: string) {
    if (kind !== 'merchant' && kind !== 'store') throw new BadRequestException('Unknown ID type');
    return { id: await this.merchantRepository.allocateId(kind) };
  }

  @Public()
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
  @Public()
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
   * Website Connection tab: save WordPress URL and JWT (screenshot Save JWT Token).
   * Path matches production `/connector/api/v1/stores/:storeId/connector`.
   */
  @Put('stores/:storeId/connector')
  async saveWebsiteConnector(
    @Param('storeId') storeId: string,
    @Body() body: { wordpressUrl?: string; wordpressJwt?: string; merchantId?: string },
    @Req() request: { user?: { role?: string } },
  ) {
    this.requireOwnerRole(request.user?.role);
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    const wordpressUrl = this.validateWordPressUrl(body.wordpressUrl);
    const wordpressJwt = body.wordpressJwt?.trim();
    if (!wordpressJwt) throw new BadRequestException('wordpressJwt is required');

    const test = await this.pingWordPress(wordpressUrl, wordpressJwt);
    const connection = await this.merchantRepository.saveWebsiteConnection({
      storeId: store.id,
      merchantId: store.merchantId,
      wordpressUrl,
      encryptedJwt: this.encryptConnectorSecret(wordpressJwt),
      status: test.ok ? 'CONNECTED' : 'NOT_CONNECTED',
      lastTestedAt: new Date(),
      lastTestMessage: test.message,
    });
    const catalog = await this.syncStoreCatalog(store.merchantId, store.id, wordpressUrl, wordpressJwt);
    await this.merchantRepository.recordAuditLog(
      'STORE_WEBSITE_CONNECTOR_UPDATED',
      store.merchantId,
      store.id,
      'merchant',
      { provider: 'WORDPRESS', wordpressUrl, status: connection.status, catalog },
    );
    return {
      success: true,
      message: test.ok ? 'Website connected. JWT token saved.' : 'JWT saved, but the WordPress site could not be verified.',
      storeId: store.id,
      merchantId: store.merchantId,
      connector: this.toPublicConnector(connection),
      catalog,
    };
  }

  @Post('stores/:storeId/connector/test')
  async testWebsiteConnector(
    @Param('storeId') storeId: string,
    @Body() body: { wordpressUrl?: string; wordpressJwt?: string },
    @Req() request: { user?: { role?: string } },
  ) {
    this.requireOwnerRole(request.user?.role);
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    const existing = await this.merchantRepository.getWebsiteConnection(storeId);
    const wordpressUrl = this.validateWordPressUrl(body.wordpressUrl || existing?.wordpressUrl);
    const wordpressJwt = body.wordpressJwt?.trim();
    if (!wordpressJwt) throw new BadRequestException('wordpressJwt is required to test the connection');
    const test = await this.pingWordPress(wordpressUrl, wordpressJwt);
    return {
      success: test.ok,
      status: test.ok ? 'CONNECTED' : 'NOT_CONNECTED',
      message: test.message,
      wordpressUrl,
    };
  }

  @Get('stores/:storeId/connector')
  async getWebsiteConnector(
    @Param('storeId') storeId: string,
    @Req() request: { user?: { role?: string } },
  ) {
    this.requireOwnerRole(request.user?.role);
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    const connection = await this.merchantRepository.getWebsiteConnection(storeId);
    return {
      success: true,
      storeId,
      storeName: store.storeName,
      connector: this.toPublicConnector(connection),
    };
  }

  @Post('stores/:storeId/catalog/sync')
  async syncStoreCatalogFromWebsite(
    @Param('storeId') storeId: string,
    @Req() request: { user?: { role?: string } },
  ) {
    this.requireOwnerRole(request.user?.role);
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    const connection = await this.merchantRepository.getWebsiteConnection(storeId);
    if (!connection?.encryptedJwt || !connection.wordpressUrl) {
      throw new BadRequestException('Connect the WordPress site before syncing the catalog');
    }
    const catalog = await this.syncStoreCatalog(
      store.merchantId,
      store.id,
      connection.wordpressUrl,
      this.decryptConnectorSecret(connection.encryptedJwt),
    );
    return {
      success: true,
      message: 'Store catalog synced from WordPress.',
      storeId: store.id,
      merchantId: store.merchantId,
      catalog,
    };
  }

  @Get('stores/:storeId/catalog')
  async getStoreCatalog(@Param('storeId') storeId: string) {
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    const catalog = await this.merchantRepository.getStoreCatalog(storeId);
    return {
      success: true,
      storeId: store.id,
      merchantId: store.merchantId,
      categoryCount: catalog.categories.length,
      productCount: catalog.products.length,
      categories: catalog.categories,
      products: catalog.products,
    };
  }

  @Get('stores/:storeId/configuration')
  async getStoreConfiguration(@Param('storeId') storeId: string) {
    const store = await this.merchantRepository.getStoreById(storeId);
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    const connection = await this.merchantRepository.getWebsiteConnection(storeId);
    return {
      success: true,
      store,
      websiteConnection: this.toPublicConnector(connection),
    };
  }

  // --- Standard CRUD ---
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
    const connection = await this.merchantRepository.getWebsiteConnection(storeId);
    return { success: true, store, websiteConnection: this.toPublicConnector(connection) };
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
    if (!store) throw new NotFoundException(`Store '${storeId}' not found`);
    return { success: true, store };
  }

  @Get('merchants')
  async getAllMerchants() {
    const list = await this.merchantRepository.getAllMerchants();
    const [stores, subscriptions] = await Promise.all([this.merchantRepository.listStores(), this.merchantRepository.listSubscriptions()]);
    const merchants = list.map(merchant => ({ ...merchant,
      storeCount: stores.filter(store => store.merchantId === merchant.id).length,
      subscription: subscriptions.find(subscription => subscription.merchantId === merchant.id) || null,
    }));
    return { success: true, count: merchants.length, merchants };
  }

  @Get('merchants/:id')
  async getMerchantById(@Param('id') id: string) {
    const result = await this.merchantRepository.getMerchantById(id);
    if (!result.merchant) {
      throw new NotFoundException(`Merchant with ID '${id}' not found`);
    }
    return { success: true, ...result };
  }

  private toPublicConnector(connection: WebsiteConnectionEntity | null) {
    if (!connection) {
      return {
        status: 'NOT_CONNECTED' as const,
        provider: 'WORDPRESS',
        wordpressUrl: '',
        wordpressJwtConfigured: false,
      };
    }
    return {
      status: connection.status,
      provider: connection.provider,
      wordpressUrl: connection.wordpressUrl,
      wordpressJwtConfigured: Boolean(connection.encryptedJwt),
      lastTestedAt: connection.lastTestedAt,
      lastTestMessage: connection.lastTestMessage,
      updatedAt: connection.updatedAt,
    };
  }

  private requireOwnerRole(role?: string): void {
    if (process.env.SKIP_AUTH === 'true') return;
    if (role !== 'OWNER') throw new ForbiddenException('Only owners may manage website connectors');
  }

  private async pingWordPress(wordpressUrl: string, wordpressJwt: string): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`${wordpressUrl}/wp-json/wp/v2/users/me`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${wordpressJwt}` },
      });
      if (!response.ok) {
        return { ok: false, message: `WordPress returned HTTP ${response.status}. Check the site URL and JWT token.` };
      }
      return { ok: true, message: 'WordPress JWT verified successfully.' };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `Could not reach WordPress: ${message}` };
    }
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

  private connectorEncryptionKey(): Buffer {
    const keyValue = process.env.STORE_CONFIG_ENCRYPTION_KEY;
    const key = keyValue
      ? Buffer.from(keyValue, 'base64')
      : createHash('sha256').update(process.env.AUTH_JWT_SECRET || 'pdh-local-development-secret-change-me').digest();
    if (key.length !== 32) {
      throw new InternalServerErrorException('STORE_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    return key;
  }

  private encryptConnectorSecret(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.connectorEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
  }

  private decryptConnectorSecret(value: string): string {
    const [version, ivPart, ciphertextPart, tagPart] = value.split(':');
    if (version !== 'v1' || !ivPart || !ciphertextPart || !tagPart) {
      throw new InternalServerErrorException('Stored website JWT cannot be decrypted');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.connectorEncryptionKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private async syncStoreCatalog(
    merchantId: string,
    storeId: string,
    wordpressUrl: string,
    wordpressJwt: string,
  ) {
    try {
      return await this.merchantRepository.syncStoreCatalogFromWordPress({
        merchantId,
        storeId,
        wordpressUrl,
        wordpressJwt,
      });
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Could not sync WordPress catalog: ${message}`);
    }
  }
}
