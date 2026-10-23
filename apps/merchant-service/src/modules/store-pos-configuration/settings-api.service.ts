import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SettingsApiRepository, SettingsJson as Json, SettingsScope } from './settings-api.repository';

@Injectable()
export class SettingsApiService {
  constructor(@Inject(SettingsApiRepository) private readonly repository: SettingsApiRepository) {}

  async general(body: Json, scope: SettingsScope) {
    const current = (await this.repository.read(scope)).general ?? {};
    // Keep omitted keys during partial updates and always expose the complete
    // supported settings shape to older clients and newly initialized stores.
    const general: Json = {
      business_name: '', company_name: '', email: '', language: '', nav_bar_location: '',
      pos_theme: '', contact_info: '', address: '', currency: '', timezone: '',
      email_notification: 0, sound_notification: 0, version: '', image_url: false, logo_url: false,
      gstin: '', receipt_header: '', receipt_footer: '', device_id: '', ...current,
    };
    const textFields = ['business_name', 'language', 'nav_bar_location', 'pos_theme', 'contact_info', 'address', 'currency', 'timezone', 'version', 'gstin', 'receipt_header', 'receipt_footer', 'device_id'];
    for (const key of textFields) if (body[key] !== undefined) general[key] = this.sanitizeText(body[key]);
    if (body.company_name !== undefined) general.company_name = this.sanitizeText(body.company_name);
    else if (body.business_name !== undefined && !current.company_name) general.company_name = general.business_name;
    if (body.email !== undefined) general.email = this.sanitizeEmail(body.email);
    if (body.email_notification !== undefined) general.email_notification = this.phpNotEmpty(body.email_notification) ? 1 : 0;
    if (body.sound_notification !== undefined) general.sound_notification = this.phpNotEmpty(body.sound_notification) ? 1 : 0;
    general.image_url ??= false;
    general.logo_url ??= false;
    if (this.phpNotEmpty(body.image_url)) general.image_url = this.sanitizeUrl(body.image_url);
    if (this.phpNotEmpty(body.logo_url)) general.logo_url = this.sanitizeUrl(body.logo_url);
    const data = await this.repository.merge(scope, { general });
    const responseFields = [
      'company_name', 'nav_bar_location', 'pos_theme', 'version', 'image_url', 'logo_url',
      'gstin', 'receipt_header', 'receipt_footer', 'device_id',
    ];
    const responseData = Object.fromEntries(
      responseFields.filter((key) => body[key] !== undefined).map((key) => [key, data.general[key]]),
    );
    return { success: true, message: 'Settings updated successfully', data: responseData };
  }

  async getGeneral(scope: SettingsScope) {
    const value = await this.repository.read(scope);
    const general = value.general ?? {};
    const data: Json = {
      company_name: general.company_name ?? general.business_name ?? '',
      nav_bar_location: general.nav_bar_location ?? '',
      pos_theme: general.pos_theme ?? '',
      version: general.version ?? '',
      image_url: general.image_url ?? false,
      logo_url: general.logo_url ?? false,
      gstin: general.gstin ?? '',
      receipt_header: general.receipt_header ?? '',
      receipt_footer: general.receipt_footer ?? '',
      device_id: general.device_id ?? '',
    };
    return { success: true, data };
  }

  async device(body: Json, scope: SettingsScope) {
    const keys = ['device_id', 'kot_printer', 'receipt_printer', 'paper_size', 'connection_type', 'kitchen_printer', 'bar_printer'];
    const settings: Json = { ...((await this.repository.read(scope)).device ?? {}) };
    for (const key of keys) if (body[key] !== undefined) settings[key] = this.text(body[key]);
    await this.repository.merge(scope, { device: settings });
    return { success: true, message: 'Device settings updated successfully', data: settings };
  }

  async getDevice(scope: SettingsScope) {
    const value = await this.repository.read(scope);
    return { success: true, data: value.device ?? {} };
  }

  async cash(scope: SettingsScope) {
    const value = await this.repository.read(scope);
    const cash = value.cash ?? {};
    const business = value.business ?? {};
    return { success: true, data: {
      enable_safes: Boolean(cash.enable_safes),
      enable_safes_drop: Boolean(cash.enable_safes_drop),
      currency_symbol: cash.currency_symbol || this.currencySymbol(cash.selected_currency),
      currencies: this.currencies(),
      selected_currency: cash.selected_currency || 'USD',
      pinaka_pos_cashback_settings: { enabled: 0, max_cashback: '', tiers: [], ...(value.cashback ?? {}) },
      pinaka_pos_service_charge_settings: {
        enabled: 0, charge_type: 'fixed', apply_to: 'order', max_charge: '', tiers: [], ...(value.service_charge ?? {}),
      },
      pinaka_pos_enable_loyalty_points: value.enable_loyalty_points === 'yes',
      shop_info: business,
      tax_enabled: value.enable_taxes ? 1 : 0,
      coupons_enabled: value.enable_coupons ? 1 : 0,
      calc_sequential_coupons: value.coupon_sequential ? 1 : 0,
    } };
  }

  async saveCash(body: Json, scope: SettingsScope) {
    const current = (await this.repository.read(scope)).cash ?? {};
    const cash = { ...current };
    if (body.currency !== undefined) {
      cash.selected_currency = this.text(body.currency).toUpperCase();
      cash.currency_symbol = this.currencySymbol(cash.selected_currency);
    }
    if (body.enable_safes !== undefined) cash.enable_safes = this.boolean(body.enable_safes, 'enable_safes');
    if (body.enable_safes_drop !== undefined) cash.enable_safes_drop = this.boolean(body.enable_safes_drop, 'enable_safes_drop');
    await this.repository.merge(scope, { cash });
    return { success: true, message: 'Cash settings updated successfully' };
  }

  async business(body: Json, scope: SettingsScope) {
    const incoming = body.shop_address;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new BadRequestException('shop_address is required');
    const keys = ['pinaka_pos_name', 'pinaka_pos_email', 'pinaka_pos_phone', 'pinaka_pos_business_address',
      'pinaka_pos_business_city', 'pinaka_pos_business_state', 'pinaka_pos_business_postcode'];
    const business: Json = { ...((await this.repository.read(scope)).business ?? {}) };
    for (const key of keys) if (incoming[key] !== undefined) business[key] = this.text(incoming[key]);
    await this.repository.merge(scope, { business });
    return { success: true, message: 'Business info updated successfully' };
  }

  async toggle(key: string, input: unknown, scope: SettingsScope, yesNo = false) {
    if (yesNo) {
      if (input !== 'yes' && input !== 'no') throw new BadRequestException({ status: false, message: 'Invalid value' });
      await this.repository.merge(scope, { [key]: input });
      return { success: true, message: input === 'yes' ? 'Loyalty points enabled' : 'Loyalty points disabled', data: { [key]: input } };
    }
    const enabled = this.binary(input);
    if (key === 'enable_cashback' || key === 'enable_service_charge') {
      const configKey = key === 'enable_cashback' ? 'cashback' : 'service_charge';
      const current = (await this.repository.read(scope))[configKey] ?? {};
      await this.repository.merge(scope, { [configKey]: { ...current, enabled } });
    } else if (key === 'enable_safes' || key === 'enable_safes_drop') {
      const value = await this.repository.read(scope);
      await this.repository.merge(scope, { cash: { ...(value.cash ?? {}), [key]: Boolean(enabled) } });
    } else await this.repository.merge(scope, { [key]: Boolean(enabled) });
    const labels: Json = {
      enable_taxes: 'Taxes', enable_coupons: 'Coupons', coupon_sequential: 'Sequential coupons',
      enable_safes: 'Safes', enable_safes_drop: 'Safes drop', enable_cashback: 'Cashback',
      enable_service_charge: 'Service charge',
    };
    const responseKey = key === 'coupon_sequential' ? 'sequential_coupons' : key;
    return { success: true, message: `${labels[key]} ${enabled ? 'enabled' : 'disabled'}`, data: { [responseKey]: enabled } };
  }

  private binary(value: unknown): number {
    if (value === 0 || value === '0' || value === false) return 0;
    if (value === 1 || value === '1' || value === true) return 1;
    throw new BadRequestException('Invalid value; expected 0 or 1');
  }
  private boolean(value: unknown, name: string) { try { return Boolean(this.binary(value)); } catch { throw new BadRequestException(`${name} must be 0 or 1`); } }
  private flag(value: unknown) { return this.binary(value); }
  private text(value: unknown) { return String(value ?? '').trim(); }
  private sanitizeText(value: unknown): string {
    return this.text(value).replace(/<[^>]*>/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  private sanitizeEmail(value: unknown): string {
    const email = this.text(value).replace(/[^a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~@-]/g, '');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }
  private sanitizeUrl(value: unknown): string {
    try {
      const url = new URL(this.text(value));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch {
      return '';
    }
  }
  private phpNotEmpty(value: unknown): boolean {
    if (value === undefined || value === null || value === false || value === 0 || value === '0' || value === '') return false;
    return !Array.isArray(value) || value.length > 0;
  }
  private currencySymbol(code: unknown) { return ({ USD: '$', EUR: '€', GBP: '£', INR: '₹', AUD: 'A$', CAD: 'C$' } as Json)[String(code || 'USD').toUpperCase()] || '$'; }
  private currencies() { return { USD: 'United States (US) dollar', EUR: 'Euro', GBP: 'Pound sterling', INR: 'Indian rupee', AUD: 'Australian dollar', CAD: 'Canadian dollar' }; }
}
