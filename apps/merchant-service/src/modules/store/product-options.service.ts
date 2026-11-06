import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createDecipheriv, createHash } from 'node:crypto';
import { MerchantRepository } from '../merchant/merchant.repository';

export interface ProductOptionsConnection {
  wordpressUrl: string;
  wordpressJwt: string;
}

@Injectable()
export class ProductOptionsService {
  constructor(
    @Inject(MerchantRepository)
    private readonly merchantRepository: MerchantRepository,
  ) {}

  async getForStore(merchantId: string, storeId: string) {
    const connector = await this.merchantRepository.getWebsiteConnection(storeId);
    if (
      connector?.status !== 'CONNECTED' ||
      !connector.wordpressUrl ||
      !connector.encryptedJwt
    ) {
      throw new BadRequestException('Connect and validate the WordPress site first');
    }
    return this.getFromConnection(
      { merchantId, storeId },
      {
        wordpressUrl: connector.wordpressUrl,
        wordpressJwt: this.decryptConnectorSecret(connector.encryptedJwt),
      },
    );
  }

  async getFromConnection(
    scope: { merchantId: string; storeId: string },
    params: ProductOptionsConnection,
  ) {
    const [categories, tags, classes, attributes] = await Promise.all([
      this.collect(params, 'products/categories'),
      this.collect(params, 'products/tags'),
      this.collect(params, 'taxes/classes'),
      this.collect(params, 'products/attributes'),
    ]);
    const attributeOrder = ['color', 'packs', 'size', 'weight'];
    const attributeKey = (attribute: any) => {
      const name = String(attribute.name ?? '').trim().toLowerCase();
      const slug = String(attribute.slug ?? '').trim().toLowerCase().replace(/^pa_/, '');
      return attributeOrder.includes(name) ? name : slug;
    };
    const selectedAttributes = attributes
      .filter((attribute) => attributeOrder.includes(attributeKey(attribute)))
      .sort(
        (a, b) =>
          attributeOrder.indexOf(attributeKey(a)) -
          attributeOrder.indexOf(attributeKey(b)),
      );
    const withTerms: Record<string, unknown>[] = [];
    for (const attribute of selectedAttributes) {
      withTerms.push({
        ...attribute,
        terms: await this.collect(
          params,
          `products/attributes/${attribute.id}/terms`,
        ),
      });
    }
    return {
      success: true,
      merchant_id: scope.merchantId,
      store_id: scope.storeId,
      categories,
      tags,
      tax_classes: [
        { name: 'Standard', slug: '' },
        ...classes.filter((item) => item.slug !== '' && item.slug !== 'standard'),
      ],
      attributes: withTerms,
    };
  }

  async collect(params: ProductOptionsConnection, path: string): Promise<any[]> {
    const records: any[] = [];
    for (let page = 1; ; page++) {
      const url = new URL(
        params.wordpressUrl.replace(/\/+$/, '') + '/wp-json/wc/v3/' + path,
      );
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      url.searchParams.set('hide_empty', 'false');
      let response: Response;
      try {
        response = await fetch(url.toString(), {
          headers: {
            Authorization: 'Bearer ' + params.wordpressJwt,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new BadRequestException('Could not load product options from WordPress');
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data)) {
        throw new BadRequestException({
          message: data?.message || 'Could not load product options',
          upstreamStatus: response.status,
        });
      }
      records.push(...data);
      const totalPages = Number(response.headers.get('x-wp-totalpages'));
      if (
        data.length < 100 ||
        (totalPages > 0 && page >= totalPages) ||
        path === 'taxes/classes'
      ) {
        return records;
      }
    }
  }

  private decryptConnectorSecret(value: string): string {
    const [version, ivPart, ciphertextPart, tagPart] = value.split(':');
    if (!ivPart || !ciphertextPart || !tagPart || version !== 'v1') {
      throw new BadRequestException(
        'The saved WordPress JWT is no longer valid. Edit the website connection and save the JWT token again.',
      );
    }
    try {
      const keyValue = process.env.STORE_CONFIG_ENCRYPTION_KEY;
      const key = keyValue
        ? Buffer.from(keyValue, 'base64')
        : createHash('sha256')
            .update(process.env.AUTH_JWT_SECRET || 'pdh-local-development-secret-change-me')
            .digest();
      if (key.length !== 32) {
        throw new InternalServerErrorException(
          'STORE_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
        );
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivPart, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw new BadRequestException(
        'The saved WordPress JWT was encrypted with a different server key. Edit the website connection and save the JWT token again.',
      );
    }
  }
}
