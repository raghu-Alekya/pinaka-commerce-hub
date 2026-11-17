import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Disk layout for merchant files.
 *
 *   uploads/{MerchantName}/{StoreName}/
 *
 * "Fresh Mart" + store "Main Street" becomes uploads/FreshMart/MainStreet.
 * Nest serves that directory at /uploads/ (see main.ts).
 */
@Injectable()
export class FileStorageService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageService.name);
  readonly root =
    process.env.MERCHANT_UPLOAD_ROOT?.trim() || join(process.cwd(), 'uploads');

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.logger.log(`Merchant file root: ${this.root}`);
  }

  folderName(value: string): string {
    const cleaned = String(value ?? '')
      .replace(/\s+/g, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/^\.+/, '');
    if (!cleaned || cleaned === '.' || cleaned === '..') {
      throw new BadRequestException('A folder name is required');
    }
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
      ? `${cleaned}_`
      : cleaned;
  }

  async ensureMerchantFolder(merchantName: string): Promise<string> {
    const path = join(this.root, this.folderName(merchantName));
    await mkdir(path, { recursive: true });
    this.logger.log(`Merchant folder ready: ${path}`);
    return path;
  }

  async ensureStoreFolder(
    merchantName: string,
    storeName: string,
  ): Promise<string> {
    const path = join(
      this.root,
      this.folderName(merchantName),
      this.folderName(storeName),
    );
    await mkdir(path, { recursive: true });
    this.logger.log(`Store folder ready: ${path}`);
    return path;
  }

  /**
   * uploads/{MerchantName}/{StoreName}/images
   * Served by Nest at /uploads/{MerchantName}/{StoreName}/images/.
   */
  async ensureStoreImagesFolder(merchantName: string, storeName: string): Promise<string> {
    const path = join(await this.ensureStoreFolder(merchantName, storeName), 'images');
    await mkdir(path, { recursive: true });
    return path;
  }

  storeImagePublicPath(merchantName: string, storeName: string, filename: string): string {
    const file = this.imageFileName(filename);
    if (!file) throw new BadRequestException('Invalid icon file name');
    return `/uploads/${encodePathSegment(this.folderName(merchantName))}/${encodePathSegment(this.folderName(storeName))}/images/${encodePathSegment(file)}`;
  }

  /**
   * Returns the canonical /uploads path when the value already points at this
   * store's images folder. Any other location returns null.
   */
  ownedStoreImagePath(merchantName: string, storeName: string, value: string): string | null {
    let pathname = String(value ?? '').trim();
    if (!pathname) return null;
    if (/^https?:\/\//i.test(pathname)) {
      try {
        pathname = new URL(pathname).pathname;
      } catch {
        return null;
      }
    }
    const parts = pathname.split('/');
    if (parts.length !== 6 || parts[1] !== 'uploads' || parts[4] !== 'images') return null;
    const decode = (part: string) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    };
    if (decode(parts[2]) !== this.folderName(merchantName) || decode(parts[3]) !== this.folderName(storeName)) {
      return null;
    }
    const file = this.imageFileName(decode(parts[5]));
    if (!file) return null;
    return this.storeImagePublicPath(merchantName, storeName, file);
  }

  async saveStoreImage(
    merchantName: string,
    storeName: string,
    filename: string,
    contents: Buffer,
  ): Promise<string> {
    const file = this.imageFileName(filename);
    if (!file) throw new BadRequestException('Invalid icon file name');
    const directory = await this.ensureStoreImagesFolder(merchantName, storeName);
    await writeFile(join(directory, file), contents);
    return this.storeImagePublicPath(merchantName, storeName, file);
  }

  private imageFileName(filename: string): string | null {
    const file = String(filename ?? '');
    return /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(file) ? file : null;
  }
}

/** encodeURIComponent leaves quotes in names such as AA'sCorner, which breaks image URLs. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
