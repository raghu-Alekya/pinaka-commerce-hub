import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { encodePathSegment, FileStorageService } from '../file-storage/file-storage.service';
import { MerchantRepository } from '../merchant/merchant.repository';

const INLINE_IMAGE = 'data:image/';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\r\n]+)$/i;

const IMAGE_LISTS: Record<string, string[]> = {
  cash_denominations: ['cashDenominations', 'coinDenominations', 'notes', 'coins'],
  safe_and_safe_drop: ['drops', 'safeDenominations'],
};

export interface UploadedPosIcon {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

export interface MaterializedConfiguration {
  value: Record<string, unknown>;
  changed: boolean;
}

type StoreFileLocation = {
  storeId: string;
  merchantId: string;
  merchantLabel: string;
  storeName: string;
};

@Injectable()
export class PosConfigurationImageService implements OnModuleInit {
  private readonly logger = new Logger(PosConfigurationImageService.name);

  constructor(
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
    @Inject(FileStorageService) private readonly files: FileStorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const moved = await this.migrateStoredIcons();
      if (moved > 0) {
        this.logger.log(`Moved icons for ${moved} POS configuration(s) into store image folders`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`POS icon migration deferred: ${message}`);
    }
  }

  handles(configurationName: string): boolean {
    return configurationName === 'printer_settings' || Boolean(IMAGE_LISTS[configurationName]);
  }

  hasInlineImage(value: unknown): boolean {
    return JSON.stringify(value ?? '').includes(INLINE_IMAGE);
  }

  async saveUpload(storeId: string, file: UploadedPosIcon, origin: string) {
    const location = await this.requireLocation(storeId);
    const extension = extensionForMime(file.mimetype);
    if (!extension || !file.buffer?.length || file.buffer.length > MAX_IMAGE_BYTES || !matchesImage(file.buffer, extension)) {
      throw new BadRequestException('Icon image must be a PNG, JPG, or WEBP file up to 2 MB');
    }
    const path = await this.files.saveStoreImage(
      location.merchantLabel,
      location.storeName,
      `${randomUUID()}${extension}`,
      file.buffer,
    );
    return {
      success: true as const,
      path,
      url: `${origin}${path}`,
      imageName: imageName(file.originalname),
    };
  }

  /**
   * Replaces inline image data with a path in this store's images folder.
   * Strict saves reject anything that is not this store's file. Reads leave
   * a value unchanged when a legacy icon cannot be moved yet.
   */
  async materialize(
    storeId: string,
    configurationName: string,
    value: Record<string, unknown>,
    strict: boolean,
  ): Promise<MaterializedConfiguration> {
    if (!this.handles(configurationName)) return { value, changed: false };
    const location = await this.merchants.storeFileLocation(storeId);
    if (!location) {
      if (strict) throw new NotFoundException('Store not found');
      return { value, changed: false };
    }
    if (configurationName === 'printer_settings') {
      return this.materializeLogo(location, value, strict);
    }
    return this.materializeLists(location, value, IMAGE_LISTS[configurationName], strict);
  }

  async migrateStoredIcons(): Promise<number> {
    const names = ['printer_settings', ...Object.keys(IMAGE_LISTS)];
    const rows: Array<{
      id: string;
      store_id: string;
      configuration_name: string;
      configuration_value: unknown;
    }> = await this.merchants.requireDataSource().query(
      `SELECT id::text AS id,
              store_id::text AS store_id,
              configuration_name,
              configuration_value
         FROM public.store_pos_configurations
        WHERE configuration_name = ANY($1::text[])
          AND configuration_value::text LIKE '%data:image/%'`,
      [names],
    );
    let moved = 0;
    for (const row of rows) {
      const current = asRecord(row.configuration_value);
      if (!current) continue;
      try {
        const prepared = await this.materialize(row.store_id, row.configuration_name, current, false);
        if (!prepared.changed) continue;
        await this.merchants.requireDataSource().query(
          `UPDATE public.store_pos_configurations
              SET configuration_value = $2::jsonb,
                  updated_at = now()
            WHERE id = $1::uuid`,
          [row.id, JSON.stringify(prepared.value)],
        );
        moved += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not move icons for store ${row.store_id} ${row.configuration_name}: ${message}`);
      }
    }
    return moved;
  }

  publishImage(image: string | null, origin?: string): string | null {
    if (!image) return image;
    const pathname = encodedUploadPath(image);
    if (!pathname) return image;
    return origin ? `${origin}${pathname}` : pathname;
  }

  /** Response copy. The database row keeps the /uploads path. */
  publishValue(
    configurationName: string,
    value: Record<string, unknown>,
    origin?: string,
  ): Record<string, unknown> {
    if (!this.handles(configurationName)) return value;
    if (configurationName === 'printer_settings') {
      if (typeof value.logo !== 'string' || !value.logo) return value;
      const logo = this.publishImage(value.logo, origin);
      return logo === value.logo ? value : { ...value, logo };
    }
    const lists = IMAGE_LISTS[configurationName];
    if (!lists) return value;
    let changed = false;
    const next: Record<string, unknown> = { ...value };
    for (const key of lists) {
      if (!Array.isArray(next[key])) continue;
      next[key] = next[key].map((item) => {
        const row = asRecord(item);
        if (!row) return item;
        const raw = firstText(row.image, row.imageData, row.image_data, row.image_url);
        const image = this.publishImage(raw, origin);
        if (!image || image === row.image) return item;
        changed = true;
        const copy: Record<string, unknown> = { ...row, image };
        delete copy.imageData;
        delete copy.image_data;
        delete copy.image_url;
        return copy;
      });
    }
    return changed ? next : value;
  }

  private async materializeLogo(
    location: StoreFileLocation,
    value: Record<string, unknown>,
    strict: boolean,
  ): Promise<MaterializedConfiguration> {
    if (!('logo' in value) || value.logo === '' || value.logo === null) {
      return { value, changed: false };
    }
    if (typeof value.logo !== 'string') {
      if (strict) throw new BadRequestException('Store logo must be a PNG, JPG, or WEBP image');
      return { value, changed: false };
    }
    const stored = await this.persistReference(location, value.logo, strict);
    if (!stored || stored === value.logo) return { value, changed: false };
    return { value: { ...value, logo: stored }, changed: true };
  }

  private async materializeLists(
    location: StoreFileLocation,
    value: Record<string, unknown>,
    lists: string[],
    strict: boolean,
  ): Promise<MaterializedConfiguration> {
    let changed = false;
    const next: Record<string, unknown> = { ...value };
    for (const key of lists) {
      if (!Array.isArray(next[key])) continue;
      const items = await Promise.all(next[key].map(async (item) => {
        const row = asRecord(item);
        if (!row) return item;
        const prepared = await this.materializeIcon(location, row, strict);
        if (prepared.changed) changed = true;
        return prepared.item;
      }));
      next[key] = items;
    }
    return { value: changed ? next : value, changed };
  }

  private async materializeIcon(
    location: StoreFileLocation,
    item: Record<string, unknown>,
    strict: boolean,
  ): Promise<{ item: Record<string, unknown>; changed: boolean }> {
    const raw = firstText(item.image, item.imageData, item.image_data, item.image_url);
    if (!raw) {
      if (strict) throw new BadRequestException('Each denomination needs an icon in this store images folder');
      return { item, changed: false };
    }
    const stored = await this.persistReference(location, raw, strict);
    if (!stored) return { item, changed: false };
    const next: Record<string, unknown> = { ...item, image: stored };
    delete next.imageData;
    delete next.image_data;
    delete next.image_url;
    const changed = item.image !== stored
      || Object.prototype.hasOwnProperty.call(item, 'imageData')
      || Object.prototype.hasOwnProperty.call(item, 'image_data')
      || Object.prototype.hasOwnProperty.call(item, 'image_url');
    return { item: changed ? next : item, changed };
  }

  private async persistReference(
    location: StoreFileLocation,
    raw: string,
    strict: boolean,
  ): Promise<string | null> {
    const owned = this.files.ownedStoreImagePath(location.merchantLabel, location.storeName, raw);
    if (owned) return owned;
    if (raw.trim().startsWith(INLINE_IMAGE)) {
      const decoded = decodePosImageDataUrl(raw);
      if (decoded) {
        return this.files.saveStoreImage(
          location.merchantLabel,
          location.storeName,
          `${randomUUID()}${decoded.extension}`,
          decoded.bytes,
        );
      }
    }
    if (!strict) return null;
    throw new BadRequestException('Each icon must be a PNG, JPG, or WEBP file in this store images folder');
  }

  private async requireLocation(storeId: string): Promise<StoreFileLocation> {
    const location = await this.merchants.storeFileLocation(storeId);
    if (!location) throw new NotFoundException('Store not found');
    return location;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function imageName(original: string | undefined): string {
  const base = String(original || 'denomination').split(/[/\\]/).pop() || 'denomination';
  const cleaned = base.replace(/[^\w.\- ()]+/g, '').slice(0, 255);
  return cleaned || 'denomination';
}

function extensionForMime(mime: string): '.png' | '.jpg' | '.webp' | null {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  return null;
}

function decodePosImageDataUrl(value: string): { extension: '.png' | '.jpg' | '.webp'; bytes: Buffer } | null {
  const text = value.trim();
  if (text.length > 3_000_000) return null;
  const match = DATA_URL.exec(text);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const kind = match[1].toLowerCase();
  const extension = kind === 'png' ? '.png' : kind === 'webp' ? '.webp' : '.jpg';
  return matchesImage(bytes, extension) ? { extension, bytes } : null;
}

export function requestOrigin(request: {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
  get?(name: string): string | undefined;
}): string {
  const forwardedProtocol = request.headers?.['x-forwarded-proto'];
  const forwardedHost = request.headers?.['x-forwarded-host'];
  const protocol = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol)?.split(',')[0]?.trim()
    || request.protocol || 'http';
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)
    || request.get?.('host') || 'localhost:3003';
  return `${protocol}://${host}`;
}

function encodedUploadPath(value: string): string | null {
  let pathname = value.trim();
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith('/uploads/')) return null;
  const parts = pathname.split('/');
  if (parts.length !== 6 || parts[1] !== 'uploads' || parts[4] !== 'images') return null;
  return `/${parts.slice(1).map((part) => encodePathSegment(safeDecode(part))).join('/')}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function matchesImage(bytes: Buffer, extension: '.png' | '.jpg' | '.webp'): boolean {
  if (extension === '.png') {
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (extension === '.jpg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length > 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
}
