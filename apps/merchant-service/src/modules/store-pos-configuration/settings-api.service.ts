import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SettingsApiRepository, SettingsJson as Json, SettingsScope } from './settings-api.repository';

@Injectable()
export class SettingsApiService {
  constructor(@Inject(SettingsApiRepository) private readonly repository: SettingsApiRepository) {}

  async getEmailSettings(scope: SettingsScope, templateId?: string) {
    const saved = await this.repository.readConfiguration(scope, 'email_settings');
    const data = templateId
      ? saved.templates?.[templateId] ?? (templateId === 'new-order' ? saved : {})
      : saved;
    return { success: true, data: { ...this.normalizeEmailSettings(data, templateId), ...(templateId ? { template_id: templateId } : {}) } };
  }

  async saveEmailSettings(body: Json, scope: SettingsScope) {
    const saved = await this.repository.readConfiguration(scope, 'email_settings');
    const templateId = this.text(body.template_id);
    const current = templateId
      ? saved.templates?.[templateId] ?? (templateId === 'new-order' ? saved : {})
      : saved;
    const data = this.normalizeEmailSettings({ ...current, ...body }, templateId);
    if (templateId) {
      const templates = { ...(saved.templates ?? {}), [templateId]: data };
      await this.repository.merge(scope, {}, { email_settings: { ...saved, templates } });
    } else {
      await this.repository.merge(scope, {}, { email_settings: data });
    }
    return { success: true, message: 'Email settings updated successfully', data: { ...data, ...(templateId ? { template_id: templateId } : {}) } };
  }

  async sendTestEmail(body: Json, scope: SettingsScope) {
    const saved = await this.repository.readConfiguration(scope, 'email_settings');
    const templateId = this.text(body.template_id);
    const current = templateId
      ? saved.templates?.[templateId] ?? (templateId === 'new-order' ? saved : {})
      : saved;
    const settings = this.normalizeEmailSettings({ ...current, ...body }, templateId);
    const recipient = this.sanitizeEmail(body.recipient)
      || settings.recipients.split(',').map((email: string) => this.sanitizeEmail(email)).find(Boolean);
    if (!recipient) throw new BadRequestException('Provide a test recipient or configure a valid recipient email');
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('Email delivery is not configured (RESEND_API_KEY is missing)');
    const storeName = await this.repository.storeName(scope) ?? '';
    const render = (value: unknown) => String(value ?? '').replace(/\{site_title\}/g, storeName);
    const storeNameDisplay = render(settings.store_name_display);
    const subject = render(settings.subject || 'Test email from POS email settings');
    const heading = render(settings.heading);
    const introText = render(settings.intro_text);
    const summaryHeading = render(settings.summary_heading);
    const additionalContent = render(settings.additional_content);
    const showOrderSummary = !templateId || templateId === 'new-order';
    const html = [
      storeNameDisplay ? `<p>${this.escapeHtml(storeNameDisplay)}</p>` : '',
      `<h2>${this.escapeHtml(heading)}</h2>`,
      introText ? `<p>${this.escapeHtml(introText)}</p>` : '',
      showOrderSummary && summaryHeading ? `<h3>${this.escapeHtml(summaryHeading)}</h3>` : '',
      settings.email_type === 'plain'
        ? `<p>${this.escapeHtml(additionalContent).replace(/\n/g, '<br>')}</p>`
        : `<div>${additionalContent}</div>`,
    ].filter(Boolean).join('\n');
    const text = [
      storeNameDisplay,
      heading,
      introText,
      showOrderSummary ? summaryHeading : '',
      additionalContent,
    ].filter(Boolean).join('\n\n');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Pinaka Commerce Hub <onboarding@resend.dev>',
        to: [recipient],
        subject,
        html,
        text,
        reply_to: process.env.MAIL_REPLY_TO || undefined,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new BadRequestException(`Email provider rejected the test email (${response.status}): ${details}`);
    }
    return { success: true, message: 'Test email sent successfully', data: { recipient } };
  }

  async getWhatsAppSettings(scope: SettingsScope, templateId?: string) {
    return this.getMessageSettings(scope, 'whatsapp_notification_settings', templateId);
  }

  async saveWhatsAppSettings(body: Json, scope: SettingsScope) {
    return this.saveMessageSettings(body, scope, 'whatsapp_notification_settings');
  }

  async getTextSettings(scope: SettingsScope, templateId?: string) {
    return this.getMessageSettings(scope, 'text_notification_settings', templateId);
  }

  async saveTextSettings(body: Json, scope: SettingsScope) {
    return this.saveMessageSettings(body, scope, 'text_notification_settings');
  }

  private async getMessageSettings(scope: SettingsScope, configurationName: string, templateId?: string) {
    const saved = await this.repository.readConfiguration(scope, configurationName);
    const data = templateId ? saved.templates?.[templateId] ?? {} : saved;
    const settings = this.normalizeWhatsAppSettings(data);
    const storeName = settings.store_name || await this.repository.storeName(scope) || 'snowfewall';
    return { success: true, data: { ...settings, ...this.messagePreview(settings, storeName), ...(templateId ? { template_id: templateId } : {}) } };
  }

  private async saveMessageSettings(body: Json, scope: SettingsScope, configurationName: string) {
    const saved = await this.repository.readConfiguration(scope, configurationName);
    const templateId = this.text(body.template_id);
    const current = templateId ? saved.templates?.[templateId] ?? {} : saved;
    const data = this.normalizeWhatsAppSettings({ ...current, ...body });
    const storeName = data.store_name || await this.repository.storeName(scope) || 'snowfewall';
    if (templateId) {
      await this.repository.merge(scope, {}, {
        [configurationName]: { ...saved, templates: { ...(saved.templates ?? {}), [templateId]: data } },
      });
    } else {
      await this.repository.merge(scope, {}, { [configurationName]: data });
    }
    return { success: true, message: 'Notification settings updated successfully', data: { ...data, ...this.messagePreview(data, storeName), ...(templateId ? { template_id: templateId } : {}) } };
  }

  private messagePreview(settings: Json, storeName: string) {
    const variables: Record<string, string> = {
      customer_name: 'Alex',
      order_number: '1048',
      store_name: storeName,
    };
    const message = settings.message_text.replace(/\{(customer_name|order_number|store_name)\}/g,
      (_match, key: string) => variables[key] ?? '');
    return { preview: message, placeholders: ['{customer_name}', '{order_number}', '{store_name}'] };
  }

  private normalizeWhatsAppSettings(value: Json): Json {
    return {
      enabled: this.phpNotEmpty(value.enabled),
      store_name: String(value.store_name ?? ''),
      message_text: String(value.message_text ?? 'Hi {customer_name}, your order #{order_number} has been received. Thank you for shopping with {store_name}!'),
    };
  }

  private normalizeEmailSettings(value: Json, templateId?: string): Json {
    const recipients = String(value.recipients ?? '').trim();
    const parsedRecipients = recipients.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (parsedRecipients.some((email) => !this.sanitizeEmail(email))) {
      throw new BadRequestException('recipients must contain valid email addresses separated by commas');
    }
    const type = String(value.email_type ?? 'html').toLowerCase();
    return {
      enabled: this.phpNotEmpty(value.enabled),
      recipients: parsedRecipients.join(', '),
      subject: String(value.subject ?? ''),
      heading: String(value.heading ?? ''),
      additional_content: String(value.additional_content ?? ''),
      store_name_display: String(value.store_name_display ?? '{site_title}'),
      intro_text: String(value.intro_text ?? (
        templateId === 'new-user-registration'
          ? 'A new user has registered on {site_title}.'
          : 'You’ve received a new order from John Doe.'
      )),
      summary_heading: String(value.summary_heading ?? 'Order summary'),
      email_type: ['plain', 'plain_text'].includes(type) ? 'plain' : 'html',
    };
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
  }

  async general(body: Json, scope: SettingsScope) {
    const current = (await this.repository.read(scope)).general ?? {};
    // Preserve populated settings, but clean empty placeholders left by older saves.
    const general: Json = Object.fromEntries(Object.entries(current).filter(([, value]) =>
      value !== null && value !== undefined && value !== false && !(typeof value === 'string' && !value.trim()),
    ));
    const textFields = ['business_name', 'language', 'nav_bar_location', 'pos_theme', 'contact_info', 'address', 'currency', 'timezone', 'version', 'gstin', 'receipt_header', 'receipt_footer'];
    for (const key of textFields) {
      if (body[key] === undefined) continue;
      const value = this.sanitizeText(body[key]);
      if (value) general[key] = value;
      else delete general[key];
    }
    if (body.company_name !== undefined) {
      const value = this.sanitizeText(body.company_name);
      if (value) general.company_name = value;
      else delete general.company_name;
    }
    else if (body.business_name !== undefined && !current.company_name) general.company_name = general.business_name;
    if (body.email !== undefined) {
      const email = this.sanitizeEmail(body.email);
      if (email) general.email = email;
      else delete general.email;
    }
    if (body.email_notification !== undefined) general.email_notification = this.phpNotEmpty(body.email_notification) ? 1 : 0;
    if (body.sound_notification !== undefined) general.sound_notification = this.phpNotEmpty(body.sound_notification) ? 1 : 0;
    // image_url belongs to the authenticated employee profile and is read-only
    // through this endpoint. Only logo_url is writable as a setting.
    for (const key of ['logo_url']) {
      if (body[key] === undefined) continue;
      const rawUrl = this.text(body[key]);
      if (!rawUrl) {
        delete general[key];
        continue;
      }
      const imageUrl = this.sanitizeUrl(body[key]);
      if (!imageUrl || !imageUrl.startsWith('/uploads/')) {
        throw new BadRequestException(`${key} must be an uploaded image path under /uploads`);
      }
      general[key] = imageUrl;
    }
    const printerSettings: Json = {};
    for (const key of ['receipt_header', 'receipt_footer', 'address', 'logo_url']) {
      if (body[key] !== undefined) printerSettings[key] = general[key] ?? '';
    }
    // Older saves may have used `logo` instead of `logo_url`. Clear both
    // aliases when the user explicitly removes the logo so GET endpoints do
    // not resurrect the old value through their compatibility fallback.
    if (body.logo_url !== undefined && !this.text(body.logo_url)) printerSettings.logo = '';
    const data = await this.repository.merge(scope, { general },
      Object.keys(printerSettings).length ? { printer_settings: printerSettings } : {});
    const responseFields = [
      'business_name', 'email', 'language', 'nav_bar_location', 'pos_theme', 'contact_info',
      'address', 'currency', 'timezone', 'email_notification', 'sound_notification',
      'version', 'image_url', 'logo_url', 'company_name', 'gstin', 'receipt_header',
      'receipt_footer',
    ];
    const responseData: Json = {};
    for (const key of responseFields) {
      if (body[key] === undefined) continue;
      // business_name may also be stored as company_name for older clients.
      const value = key === 'business_name'
        ? data.general.business_name ?? data.general.company_name
        : data.general[key];
      if (value === undefined || value === null || value === false
        || (typeof value === 'string' && !value.trim())) continue;
      responseData[key] = value;
    }
    return { success: true, message: 'Settings updated successfully', data: responseData };
  }

  async getGeneral(scope: SettingsScope) {
    const [value, storeEmail, employeeImage] = await Promise.all([
      this.repository.read(scope),
      this.repository.storeEmail(scope),
      this.repository.employeeProfileImage(scope),
    ]);
    const general: Json = { ...(value.general ?? {}) };
    delete general.image_url;
    if (storeEmail) general.email = storeEmail;
    const printer = await this.repository.readConfiguration(scope, 'printer_settings');
    for (const key of ['receipt_header', 'receipt_footer', 'address']) {
      if (printer[key] !== undefined && printer[key] !== null) general[key] = printer[key];
    }
    // Keep the general image and receipt logo independent. Older code copied
    // one printer logo value into both keys, hiding distinct uploaded images.
    const printerLogo = printer.logo_url || printer.logo;
    if (employeeImage) general.image_url = employeeImage;
    if (typeof printerLogo === 'string' && printerLogo.trim()) general.logo_url = printerLogo;
    const fields = [
      'business_name', 'email', 'language', 'nav_bar_location', 'pos_theme', 'contact_info',
      'address', 'currency', 'timezone', 'email_notification', 'sound_notification',
      'version', 'image_url', 'logo_url', 'company_name', 'gstin', 'receipt_header',
      'receipt_footer',
    ];
    const data: Json = {};
    for (const key of fields) {
      const raw = key === 'business_name'
        ? general.business_name ?? general.company_name
        : key === 'company_name'
          ? general.company_name ?? general.business_name
          : general[key];
      // Keep receipt fields present in the GET contract even before a receipt
      // header or footer has been configured.
      if ((key === 'receipt_header' || key === 'receipt_footer')
        && (raw === null || raw === undefined)) {
        data[key] = '';
        continue;
      }
      if (key === 'logo_url' && (raw === null || raw === undefined || raw === '')) {
        data[key] = '';
        continue;
      }
      if (raw === null || raw === undefined || raw === false || (typeof raw === 'string' && !raw.trim())) continue;
      data[key] = raw;
    }
    return { success: true, data };
  }

  async printerSettings(body: Json, scope: SettingsScope) {
    const data = await this.repository.readConfiguration(scope, 'printer_settings');
    const merged = { ...data, ...body };
    await this.repository.merge(scope, {}, { printer_settings: body });
    return { success: true, message: 'Printer settings updated successfully', data: merged };
  }

  async getPrinterSettings(scope: SettingsScope) {
    const [settings, printer] = await Promise.all([
      this.repository.read(scope),
      this.repository.readConfiguration(scope, 'printer_settings'),
    ]);
    const general = settings.general ?? {};
    const data: Json = { ...general, ...printer };
    // Older PCH saves kept receipt branding in the general-settings record,
    // while the printer screen reads the dedicated printer-settings record.
    // Expose the saved image using the names consumed by the printer screen.
    const logoWasExplicitlyCleared = Object.prototype.hasOwnProperty.call(printer, 'logo_url')
      && !this.text(printer.logo_url);
    data.logo_url = logoWasExplicitlyCleared
      ? ''
      : printer.logo_url || printer.logo || general.logo_url || general.image_url || '';
    if (!data.image_url && general.image_url) data.image_url = general.image_url;
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

  async configurationFlags(scope: SettingsScope) {
    const value = await this.repository.readConfigurationFlags(scope);
    const enabled = (flag: unknown) => flag === true || flag === 1
      || (typeof flag === 'string' && ['true', '1', 'yes', 'on'].includes(flag.trim().toLowerCase()));
    return { success: true, data: {
      enable_safes: enabled(value.safe_and_safe_drop?.enabled),
      enable_safes_drop: enabled(value.safe_and_safe_drop?.dropEnabled ?? value.safe_and_safe_drop?.dropenabled),
      tax_enabled: enabled(value.currency_taxes?.taxEnabled),
      cashback_enabled: enabled(value.cashback_settings?.enabled),
    } };
  }

  async cash(scope: SettingsScope) {
    const value = await this.repository.read(scope);
    const configurations = await this.repository.readConfigurationFlags(scope);
    const cash = value.cash ?? {};
    const business = value.business ?? {};
    const currencyTaxes = configurations.currency_taxes ?? {};
    return { success: true, data: {
      enable_safes: Boolean(cash.enable_safes),
      enable_safes_drop: Boolean(cash.enable_safes_drop),
      currency_symbol: currencyTaxes.currency_symbol || cash.currency_symbol || this.currencySymbol(currencyTaxes.currency || cash.selected_currency),
      currencies: this.currencies(),
      selected_currency: currencyTaxes.currency || cash.selected_currency || 'USD',
      pinaka_pos_cashback_settings: { enabled: 0, max_cashback: '', tiers: [], ...(value.cashback ?? {}) },
      pinaka_pos_service_charge_settings: {
        enabled: 0, charge_type: 'fixed', apply_to: 'order', max_charge: '', tiers: [], ...(value.service_charge ?? {}),
      },
      pinaka_pos_enable_loyalty_points: value.enable_loyalty_points === 'yes',
      shop_info: business,
      tax_enabled: currencyTaxes.taxEnabled !== undefined ? (currencyTaxes.taxEnabled ? 1 : 0) : (value.enable_taxes ? 1 : 0),
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
    const targets: Record<string, [string, string]> = {
      enable_safes: ['safe_and_safe_drop', 'enabled'],
      enable_safes_drop: ['safe_and_safe_drop', 'dropEnabled'],
      enable_taxes: ['currency_taxes', 'taxEnabled'],
      enable_cashback: ['cashback_settings', 'enabled'],
    };
    const target = targets[key];
    const configurations = target ? { [target[0]]: { [target[1]]: Boolean(enabled) } } : {};
    if (key === 'enable_safes' && !enabled) {
      configurations.safe_and_safe_drop = {
        ...(configurations.safe_and_safe_drop ?? {}),
        dropEnabled: false,
      };
    }
    if (key === 'enable_safes_drop' && enabled) {
      const currentFlags = await this.repository.readConfigurationFlags(scope);
      if (!this.boolean(currentFlags.safe_and_safe_drop?.enabled)) {
        throw new BadRequestException('Safe must be enabled before Safe Drop can be enabled.');
      }
    }
    if (key === 'enable_cashback' || key === 'enable_service_charge') {
      const configKey = key === 'enable_cashback' ? 'cashback' : 'service_charge';
      const current = (await this.repository.read(scope))[configKey] ?? {};
      await this.repository.merge(scope, { [configKey]: { ...current, enabled } }, configurations);
    } else if (key === 'enable_safes' || key === 'enable_safes_drop') {
      const value = await this.repository.read(scope);
      await this.repository.merge(scope, { cash: { ...(value.cash ?? {}), [key]: Boolean(enabled) } }, configurations);
    } else await this.repository.merge(scope, { [key]: Boolean(enabled) }, configurations);
    const labels: Json = {
      enable_taxes: 'Taxes', enable_coupons: 'Coupons', coupon_sequential: 'Sequential coupons',
      enable_safes: 'Safes', enable_safes_drop: 'Safes drop', enable_cashback: 'Cashback',
      enable_service_charge: 'Service charge',
    };
    const responseKey = key === 'coupon_sequential' ? 'sequential_coupons' : key;
    return { success: true, message: `${labels[key]} ${enabled ? 'enabled' : 'disabled'}`, data: { [responseKey]: enabled } };
  }

  async getPromotionalImages(scope: SettingsScope) {
    const data = await this.repository.readPromotionalImages(scope);
    return { success: true, data: this.presentPromotionalImages(data) };
  }

  async savePromotionalImages(body: Json, scope: SettingsScope) {
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled must be true or false');
    if (!Array.isArray(body.images)) throw new BadRequestException('images must be an array');
    if (body.images.length > 20) throw new BadRequestException('A maximum of 20 promotional images is allowed');
    const removeIds = body.removeIds === undefined ? [] : body.removeIds;
    if (!Array.isArray(removeIds) || removeIds.some((id: unknown) => typeof id !== 'string')) {
      throw new BadRequestException('removeIds must be an array of image IDs');
    }
    const images = body.images.map((image: unknown, index: number) => {
      if (!image || typeof image !== 'object' || Array.isArray(image)) {
        throw new BadRequestException(`images[${index}] must be an object`);
      }
      const item = image as Json;
      const url = this.sanitizeImageUrl(item.url);
      if (!url) throw new BadRequestException(`images[${index}].url must be an http(s) URL or /uploads path`);
      return {
        id: this.text(item.id) || randomUUID(),
        url,
      };
    });
    const data = await this.repository.savePromotionalImages(scope, { enabled: body.enabled, images, removeIds });
    return { success: true, message: 'Promotional images saved successfully', data: this.presentPromotionalImages(data) };
  }

  private presentPromotionalImages(value: Json | null) {
    const images = Array.isArray(value?.images) ? value.images : [];
    return {
      enabled: value?.enabled === true,
      images: images.map((item: unknown) => {
        const image = item && typeof item === 'object' && !Array.isArray(item) ? item as Json : {};
        return { id: this.text(image.id) || randomUUID(), url: this.sanitizeImageUrl(image.url) || '' };
      }),
    };
  }

  private sanitizeImageUrl(value: unknown): string {
    const raw = this.text(value);
    if (raw.startsWith('/uploads/')) return raw;
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch { return ''; }
  }

  private binary(value: unknown): number {
    if (value === 0 || value === '0' || value === false) return 0;
    if (value === 1 || value === '1' || value === true) return 1;
    throw new BadRequestException('Invalid value; expected 0 or 1');
  }
  private boolean(value: unknown, name: string) { try { return Boolean(this.binary(value)); } catch { throw new BadRequestException(`${name} must be 0 or 1`); } }
  private text(value: unknown) { return String(value ?? '').trim(); }
  private sanitizeText(value: unknown): string {
    return this.text(value).replace(/<[^>]*>/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  private sanitizeEmail(value: unknown): string {
    const email = this.text(value).replace(/[^a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~@-]/g, '');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }
  private sanitizeUrl(value: unknown): string {
    const raw = this.text(value);
    if (raw.startsWith('/uploads/') && !raw.includes('..')) return raw;
    try {
      const url = new URL(raw);
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
