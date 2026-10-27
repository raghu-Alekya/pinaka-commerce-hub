import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { MerchantRepository } from '../merchant/merchant.repository';
import { StorePosConfigurationEntity } from '../../entities/store-pos-configuration.entity';
import { CreateStorePosConfigurationDto } from './dto/create-store-pos-configuration.dto';
import { UpdateStorePosConfigurationDto } from './dto/update-store-pos-configuration.dto';
import { CashBackSettingsResponse, mapCashbackSettings } from './cashback-settings.model';
import { PosConfigurationImageService, UploadedPosIcon } from './pos-configuration-image.service';

export const WOOCOMMERCE_ORDER_STATUSES = [
  { slug: 'pending', name: 'Pending payment' },
  { slug: 'processing', name: 'Processing' },
  { slug: 'on-hold', name: 'On hold' },
  { slug: 'completed', name: 'Completed' },
  { slug: 'cancelled', name: 'Cancelled' },
  { slug: 'partial-refund', name: 'Partially refunded' },
  { slug: 'refunded', name: 'Refunded' },
  { slug: 'failed', name: 'Failed' },
  { slug: 'checkout-draft', name: 'Draft' },
] as const;

@Injectable()
export class StorePosConfigurationsService {
  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(PosConfigurationImageService) private readonly images: PosConfigurationImageService,
  ) {}

  saveStoreIcon(storeId: string, file: UploadedPosIcon | undefined, origin: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a PNG, JPG, or WEBP icon');
    return this.images.saveUpload(storeId, file, origin);
  }

  private repository(): Repository<StorePosConfigurationEntity> {
    return this.merchants.requireDataSource().getRepository(StorePosConfigurationEntity);
  }

  private mergeConfigurationValue(
    name: string,
    current: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    // General currency/tax saves omit the separately managed WordPress classes.
    return name === 'currency_taxes' ? { ...current, ...incoming } : incoming;
  }

  /** Accepts a store UUID or a store code such as STORE-001. */
  private async storeUuid(storeKey: string): Promise<string> {
    const store = await this.merchants.getStoreById(storeKey);
    if (!store) throw new NotFoundException(`Store "${storeKey}" not found`);
    return store.id;
  }

  /**
   * Create a new POS configuration.
   */
  async create(
    dto: CreateStorePosConfigurationDto,
    actorId?: string,
    origin?: string,
  ): Promise<StorePosConfigurationEntity> {
    const storeId = await this.storeUuid(dto.storeId);
    const existing = await this.repository().findOne({
      where: {
        storeId,
        configurationName: dto.configurationName,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Configuration "${dto.configurationName}" already exists for this store.`,
      );
    }

    const actor = dto.createdBy || actorId || null;
    const configuration = this.repository().create({
      storeId,
      configurationName: dto.configurationName,
      configurationValue: await this.normalizeIcons(storeId, dto.configurationName, dto.configurationValue),
      createdBy: actor,
      updatedBy: actor,
    });

    return this.forClient(await this.repository().save(configuration), origin);
  }

  /**
   * Get all configurations for a store.
   */
  async findByStoreId(
    storeId: string,
    origin?: string,
  ): Promise<StorePosConfigurationEntity[]> {
    const resolvedStoreId = await this.storeUuid(storeId);
    const configurations = await this.repository().find({
      where: {
        storeId: resolvedStoreId,
      },
      order: {
        configurationName: 'ASC',
      },
    });
    for (const row of configurations) await this.migrateInlineIcons(row);
    return configurations.map((row) => this.forClient(row, origin));
  }

  /**
   * Get one configuration by store ID and configuration name.
   */
  async findOne(
    storeId: string,
    configurationName: string,
  ): Promise<StorePosConfigurationEntity> {
    const resolvedStoreId = await this.storeUuid(storeId);
    const configuration = await this.repository().findOne({
      where: {
        storeId: resolvedStoreId,
        configurationName,
      },
    });

    if (!configuration) {
      throw new NotFoundException(
        `Configuration "${configurationName}" not found for store "${storeId}".`,
      );
    }

    await this.migrateInlineIcons(configuration);
    return configuration;
  }

  /**
   * POS cashback reads the stored row and returns the cash_back_service model.
   * Every other configuration name keeps the stored row.
   */
  async findPresented(
    storeId: string,
    configurationName: string,
    origin?: string,
  ): Promise<StorePosConfigurationEntity | CashBackSettingsResponse> {
    const configuration = await this.findOne(storeId, configurationName);
    if (configurationName === 'cashback_settings') {
      return mapCashbackSettings(configuration.configurationValue);
    }
    return this.forClient(configuration, origin);
  }

  /**
   * Get only configuration JSON by store ID and name.
   */
  async getConfigurationValue(
    storeId: string,
    configurationName: string,
    origin?: string,
  ): Promise<Record<string, unknown>> {
    const configuration = await this.findOne(
      storeId,
      configurationName,
    );

    return this.images.publishValue(configurationName, configuration.configurationValue, origin);
  }

  /**
   * Update an existing configuration.
   */
  async update(
    storeId: string,
    configurationName: string,
    dto: UpdateStorePosConfigurationDto,
    actorId?: string,
    origin?: string,
  ): Promise<StorePosConfigurationEntity> {
    const configuration = await this.findOne(
      storeId,
      configurationName,
    );

    if (
      dto.configurationName &&
      dto.configurationName !== configurationName
    ) {
      const duplicate = await this.repository().findOne({
        where: {
          storeId: configuration.storeId,
          configurationName: dto.configurationName,
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Configuration "${dto.configurationName}" already exists for this store.`,
        );
      }

      configuration.configurationName = dto.configurationName;
    }

    if (dto.configurationValue !== undefined) {
      const name = dto.configurationName || configuration.configurationName;
      configuration.configurationValue = await this.normalizeIcons(
        configuration.storeId,
        name,
        this.mergeConfigurationValue(name, configuration.configurationValue, dto.configurationValue),
      );
    }

    const actor = dto.updatedBy || actorId;
    if (actor) configuration.updatedBy = actor;

    return this.forClient(await this.repository().save(configuration), origin);
  }

  /**
   * Create or update configuration.
   *
   * This is useful for the frontend configuration screen.
   */
  async upsert(
    dto: CreateStorePosConfigurationDto,
    actorId?: string,
    origin?: string,
  ): Promise<StorePosConfigurationEntity> {
    const storeId = await this.storeUuid(dto.storeId);
    const existing = await this.repository().findOne({
      where: {
        storeId,
        configurationName: dto.configurationName,
      },
    });
    const actor = dto.createdBy || actorId || null;

    if (existing) {
      existing.configurationValue = await this.normalizeIcons(
        storeId,
        existing.configurationName,
        this.mergeConfigurationValue(existing.configurationName, existing.configurationValue, dto.configurationValue),
      );
      if (actor) existing.updatedBy = actor;

      return this.forClient(await this.repository().save(existing), origin);
    }

    const configuration = this.repository().create({
      storeId,
      configurationName: dto.configurationName,
      configurationValue: await this.normalizeIcons(storeId, dto.configurationName, dto.configurationValue),
      createdBy: actor,
      updatedBy: actor,
    });

    return this.forClient(await this.repository().save(configuration), origin);
  }

  /**
   * Delete configuration.
   */
  async remove(
    storeId: string,
    configurationName: string,
  ): Promise<void> {
    const configuration = await this.findOne(
      storeId,
      configurationName,
    );

    await this.repository().remove(configuration);
  }

  
  
  
  async getStoreInfo(storeId: string, origin?: string): Promise<Record<string, unknown>> {
    const resolvedStoreId = await this.storeUuid(storeId);
    const configurations = await this.repository().find({
      where: { storeId: resolvedStoreId },
    });
    for (const row of configurations) await this.migrateInlineIcons(row);
    const configByName = new Map(
      configurations.map((row) => [row.configurationName, this.asObject(row.configurationValue)]),
    );
    const taxesConfig = configByName.get('currency_taxes') ?? null;
    const cashConfig = configByName.get('cash_denominations') ?? null;
    const safeConfig = configByName.get('safe_and_safe_drop') ?? null;
    const registerConfig = configByName.get('cash_register_settings') ?? null;

    const storeRows = await this.optionalRows(
      `SELECT store_website_url, store_name, address_line1, city, state, country, postal_code, phone
       FROM public.stores
       WHERE id = $1::uuid
       LIMIT 1`,
      [resolvedStoreId],
    );
    const store = storeRows[0] ?? {};

    const taxes = this.taxList(taxesConfig);
    const currency = this.textOrNull(taxesConfig?.currency);
    const currencySymbol = this.textOrNull(taxesConfig?.currencySymbol);
    const [notesDenom, coinDenom] = await this.cashDenominations(resolvedStoreId, cashConfig);
    const safe = await this.safeDrop(resolvedStoreId, safeConfig, currencySymbol);
    const roles = await this.storeRoles(resolvedStoreId);
    const vendors = await this.storeVendors(resolvedStoreId);
    const vendorPaymentTypes = await this.storeTenderNames(resolvedStoreId);
    const employees = await this.storeEmployees(resolvedStoreId);

    return {
      base_url: this.textOrNull(store.store_website_url),
      currency,
      currencySymbol,
      taxes,
      roles,
      store_details: {
        name: this.textOrNull(store.store_name),
        address: this.textOrNull(store.address_line1),
        city: this.textOrNull(store.city),
        state: this.textOrNull(store.state),
        country: this.textOrNull(store.country),
        zip_code: this.textOrNull(store.postal_code),
        phone_number: this.textOrNull(store.phone),
      },
      notes_denom: this.publishDenoms(notesDenom, origin),
      coin_denom: this.publishDenoms(coinDenom, origin),
      safe_denom: this.publishDenoms(safe.denominations, origin),
      tubes_denom: safe.tubes,
      max_tubes_count: safe.maxTubesCount,
      safe_drop_amount: safe.safeDropAmount,
      drawer_amount: await this.drawerAmount(resolvedStoreId, registerConfig),
      vendors,
      vendor_payment_types: vendorPaymentTypes,
      employees,
      order_types: [
        { slug: 'rest-api', name: 'Shop Order' },
        { slug: 'doordash', name: 'Takeaway Order' },
        { slug: 'uber-eats', name: 'Uber Eats Order' },
        { slug: 'online', name: 'Online Order' },
      ],
      order_statuses: WOOCOMMERCE_ORDER_STATUSES.map((status) => ({ ...status })),
    };
  }

  private taxList(taxesConfig: Record<string, unknown> | null): Array<{ slug: string; name: string }> {
    const taxClasses = taxesConfig?.taxClasses;
    if (!Array.isArray(taxClasses)) return [];
    return taxClasses.flatMap((tax) => {
      const name = this.textOrNull((tax as { name?: unknown })?.name);
      const slug = name ? name.toLowerCase().replace(/\s+/g, '_') : null;
      return name && slug ? [{ slug, name }] : [];
    });
  }

  private async storeRoles(storeId: string): Promise<Array<{ slug: string | null; name: string | null }>> {
    const rows = await this.optionalRows(
      `SELECT rt.role_code AS slug, rt.name AS name
       FROM public.store_role_templates srt
       JOIN public.role_templates rt ON rt.id = srt.role_template_id
       WHERE srt.store_id = $1::uuid
         AND COALESCE(srt.enabled, true) = true
         AND upper(COALESCE(srt.status, 'ACTIVE')) <> 'INACTIVE'
       ORDER BY rt.name ASC`,
      [storeId],
    );
    return rows.map((row) => ({
      slug: this.slug(row.slug ?? row.name),
      name: this.textOrNull(row.name),
    }));
  }

  private async cashDenominations(
    _storeId: string,
    config: Record<string, unknown> | null,
  ): Promise<[Array<{ denom: string | null; image: string | null }>, Array<{ denom: string | null; image: string | null }>]> {
    return [
      this.denomList(config?.cashDenominations ?? config?.notes),
      this.denomList(config?.coinDenominations ?? config?.coins),
    ];
  }

  private async safeDrop(
    _storeId: string,
    config: Record<string, unknown> | null,
    currencySymbol: string | null,
  ): Promise<{
    denominations: Array<{ denom: string | null; image: string | null }>;
    tubes: Array<{ denom: number | null; tube_limit: number | null; symbol: string | null }>;
    maxTubesCount: string | null;
    safeDropAmount: string | null;
  }> {
    const configDenoms = this.denomList(config?.drops ?? config?.safeDenominations);
    const configTubes = this.tubeList(config?.tubes, currencySymbol);
    return {
      denominations: configDenoms,
      tubes: configTubes,
      maxTubesCount: this.moneyText(config?.tubeSize),
      safeDropAmount: this.moneyText(config?.threshold),
    };
  }

  private async drawerAmount(
    _storeId: string,
    config: Record<string, unknown> | null,
  ): Promise<string | null> {
    const registers = Array.isArray(config?.registers) ? config.registers : [];
    const active = registers.find((row) => String((row as { status?: unknown })?.status || '').toLowerCase() === 'active')
      ?? registers[0];
    return this.moneyText((active as { maxCash?: unknown } | undefined)?.maxCash);
  }

  private async storeVendors(storeId: string): Promise<Array<{ id: string | null; vendor_name: string | null }>> {
    const rows = await this.optionalRows(
      `SELECT v.id::text AS id, v.vendor_name
       FROM public.vendor_stores vs
       JOIN public.stores s ON s.id = vs.store_id AND s.merchant_id = vs.merchant_id
       JOIN public.merchant_vendors mv ON mv.merchant_id = vs.merchant_id AND mv.vendor_id = vs.vendor_id
       JOIN public.vendors v ON v.id = vs.vendor_id
       WHERE s.id = $1::uuid
         AND vs.is_mapped = true
         AND upper(COALESCE(vs.status::text, 'ACTIVE')) = 'ACTIVE'
         AND upper(COALESCE(mv.status::text, 'ACTIVE')) = 'ACTIVE'
         AND upper(COALESCE(v.status::text, 'ACTIVE')) = 'ACTIVE'
         AND v.is_deleted = false
       ORDER BY v.vendor_name ASC`,
      [storeId],
    );
    return rows.map((row) => ({
      id: this.textOrNull(row.id),
      vendor_name: this.textOrNull(row.vendor_name),
    }));
  }

  private async storeTenderNames(storeId: string): Promise<string[]> {
    const assigned = await this.optionalRows(
      `SELECT DISTINCT t.tendor_name AS name
       FROM public.merchant_tendors mt
       JOIN public.tendors t ON t.id = mt.tendor_id
       JOIN public.stores s ON s.merchant_id = mt.merchant_id
       WHERE s.id = $1::uuid
         AND upper(COALESCE(mt.status::text, 'ACTIVE')) = 'ACTIVE'
         AND upper(COALESCE(t.status::text, 'ACTIVE')) = 'ACTIVE'
       ORDER BY t.tendor_name ASC`,
      [storeId],
    );
    const source = assigned.length
      ? assigned
      : await this.optionalRows(
        `SELECT t.tendor_name AS name
         FROM public.tendors t
         WHERE upper(COALESCE(t.status::text, 'ACTIVE')) = 'ACTIVE'
         ORDER BY t.tendor_name ASC`,
        [],
      );
    return source
      .map((row) => this.textOrNull(row.name))
      .filter((name): name is string => Boolean(name));
  }

  private async storeEmployees(storeId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.optionalRows(
      `SELECT e.id::text AS id,
              e.employee_code,
              e.username,
              e.email,
              e.first_name,
              e.last_name,
              e.status::text AS status,
              e.created_at
       FROM public.employee_stores es
       JOIN public.employees e ON e.id = es.employee_id
       WHERE es.store_id = $1::uuid
         AND upper(COALESCE(es.status, 'ACTIVE')) <> 'INACTIVE'
         AND upper(COALESCE(e.status::text, 'ACTIVE')) <> 'INACTIVE'
       ORDER BY e.first_name ASC, e.last_name ASC`,
      [storeId],
    );
    return rows.map((row) => {
      const login = this.textOrNull(row.username) || this.textOrNull(row.employee_code);
      const displayName = [row.first_name, row.last_name]
        .map((part) => this.textOrNull(part))
        .filter(Boolean)
        .join(' ') || null;
      return {
        ID: this.textOrNull(row.id),
        user_login: login,
        user_pass: null,
        user_nicename: login ? login.toLowerCase().replace(/\s+/g, '-') : null,
        user_email: this.textOrNull(row.email),
        user_url: null,
        user_registered: row.created_at ?? null,
        user_activation_key: null,
        user_status: this.textOrNull(row.status),
        display_name: displayName,
      };
    });
  }

  private denomList(value: unknown): Array<{ denom: string | null; image: string | null }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const row = this.asObject(item);
      if (!row) return [];
      return [{
        denom: this.moneyText(row.denom ?? row.amount),
        image: this.textOrNull(row.image ?? row.imageData ?? row.image_url),
      }];
    });
  }

  private tubeList(
    value: unknown,
    currencySymbol: string | null,
  ): Array<{ denom: number | null; tube_limit: number | null; symbol: string | null }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const row = this.asObject(item);
      if (!row) return [];
      const denom = Number(row.denom ?? row.amount);
      const limit = Number(row.tube_limit ?? row.quantity ?? row.tubeLimit);
      return [{
        denom: Number.isFinite(denom) ? denom : null,
        tube_limit: Number.isFinite(limit) ? limit : null,
        symbol: this.textOrNull(row.symbol) ?? currencySymbol,
      }];
    });
  }

  private async optionalRows(sql: string, params: unknown[]): Promise<Array<Record<string, any>>> {
    try {
      return await this.merchants.requireDataSource().query(sql, params);
    } catch (error) {
      const code = (error as { code?: string; driverError?: { code?: string } })?.code
        || (error as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '42P01' || code === '42703') return [];
      throw error;
    }
  }

  private asObject(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }

  private textOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
  }

  private moneyText(value: unknown): string | null {
    const text = this.textOrNull(value);
    if (!text) return null;
    const amount = Number(text);
    if (!Number.isFinite(amount)) return text;
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  }

  private slug(value: unknown): string | null {
    const text = this.textOrNull(value);
    if (!text) return null;
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || null;
  }

  private async normalizeIcons(
    storeId: string,
    configurationName: string,
    value: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.images.handles(configurationName)) return value;
    return (await this.images.materialize(storeId, configurationName, value, true)).value;
  }

  private async migrateInlineIcons(configuration: StorePosConfigurationEntity): Promise<void> {
    if (!this.images.handles(configuration.configurationName)) return;
    if (!this.images.hasInlineImage(configuration.configurationValue)) return;
    const prepared = await this.images.materialize(
      configuration.storeId,
      configuration.configurationName,
      configuration.configurationValue,
      false,
    );
    if (!prepared.changed) return;
    configuration.configurationValue = prepared.value;
    await this.repository().save(configuration);
  }

  private forClient<T extends StorePosConfigurationEntity>(row: T, origin?: string): T {
    if (!this.images.handles(row.configurationName)) return row;
    return {
      ...row,
      configurationValue: this.images.publishValue(row.configurationName, row.configurationValue, origin),
    } as T;
  }

  private publishDenoms(
    rows: Array<{ denom: string | null; image: string | null }>,
    origin?: string,
  ): Array<{ denom: string | null; image: string | null }> {
    return rows.map((row) => ({
      denom: row.denom,
      image: this.images.publishImage(row.image, origin),
    }));
  }



}
