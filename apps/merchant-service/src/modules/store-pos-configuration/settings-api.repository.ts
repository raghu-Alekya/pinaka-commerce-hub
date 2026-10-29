import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantRepository } from '../merchant/merchant.repository';

export type SettingsJson = Record<string, any>;

export interface SettingsScope {
  user?: { id?: string; merchantId?: string; storeId?: string };
  merchantHeader?: string;
  storeHeader?: string;
}

@Injectable()
export class SettingsApiRepository {
  private readonly configurationName = 'settings';
  private readonly promotionalImagesConfigurationName = 'promotional_images';
  private readonly legacyPromotionalImagesConfigurationName = 'customer_display_promotional_images';

  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async read(scope: SettingsScope): Promise<SettingsJson> {
    const { db, storeId } = await this.resolveScope(scope);
    const rows = await db.query(
      `SELECT configuration_value
       FROM public.store_pos_configurations
       WHERE store_id = $1::uuid AND configuration_name = $2
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1`,
      [storeId, this.configurationName],
    );
    return rows[0]?.configuration_value ?? {};
  }

  async merge(scope: SettingsScope, patch: SettingsJson): Promise<SettingsJson> {
    const { db, storeId, actorId } = await this.resolveScope(scope);
    return db.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${storeId}:${this.configurationName}`],
      );
      const params = [storeId, this.configurationName, JSON.stringify(patch), actorId];
      const updateResult = await manager.query(
        `UPDATE public.store_pos_configurations
         SET configuration_value = COALESCE(configuration_value, '{}'::jsonb) || $3::jsonb,
             updated_by = $4::uuid,
             updated_at = now()
         WHERE store_id = $1::uuid AND configuration_name = $2
         RETURNING configuration_value`,
        params,
      );
      const updatedRows = Array.isArray(updateResult[0]) ? updateResult[0] : updateResult;
      if (updatedRows[0]) return updatedRows[0].configuration_value;

      const insertedRows = await manager.query(
        `INSERT INTO public.store_pos_configurations
           (store_id, configuration_name, configuration_value, created_by, updated_by)
         VALUES ($1::uuid, $2, $3::jsonb, $4::uuid, $4::uuid)
         RETURNING configuration_value`,
        params,
      );
      return insertedRows[0].configuration_value;
    });
  }

  async readPromotionalImages(scope: SettingsScope): Promise<SettingsJson | null> {
    const { db, storeId } = await this.resolveScope(scope);
    await this.renameLegacyPromotionalImagesRow(db, storeId);
    const rows = await db.query(
      `SELECT configuration_value, created_at, updated_at
       FROM public.store_pos_configurations
       WHERE store_id = $1::uuid AND configuration_name = $2
       LIMIT 1`,
      [storeId, this.promotionalImagesConfigurationName],
    );
    const row = rows[0];
    if (!row) return { enabled: false, images: [] };
    return { ...(row.configuration_value ?? {}), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async savePromotionalImages(scope: SettingsScope, value: SettingsJson): Promise<SettingsJson> {
    const { db, storeId, actorId } = await this.resolveScope(scope);
    return db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${storeId}:${this.promotionalImagesConfigurationName}`]);
      await this.renameLegacyPromotionalImagesRow(manager, storeId);
      const currentRows = await manager.query(
        `SELECT configuration_value FROM public.store_pos_configurations
         WHERE store_id = $1::uuid AND configuration_name = $2 LIMIT 1`,
        [storeId, this.promotionalImagesConfigurationName],
      );
      const currentImages = Array.isArray(currentRows[0]?.configuration_value?.images)
        ? currentRows[0].configuration_value.images as Array<{ id: string; url: string }>
        : [];
      const incomingImages = value.images as Array<{ id: string; url: string }>;
      const removeIds = Array.isArray(value.removeIds) ? new Set(value.removeIds as string[]) : new Set<string>();
      const retainedImages = currentImages.filter((image) => !removeIds.has(image.id));
      const images = incomingImages.length === 0 && removeIds.size === 0 ? [] : [...retainedImages];
      for (const image of incomingImages) {
        const existingIndex = images.findIndex((saved) => saved.id === image.id || saved.url === image.url);
        if (existingIndex < 0) images.push(image);
        else images[existingIndex] = image;
      }
      if (images.length > 20) throw new BadRequestException('A maximum of 20 promotional images is allowed');
      const nextValue = { enabled: value.enabled, images };
      const rows = await manager.query(
        `INSERT INTO public.store_pos_configurations
           (store_id, configuration_name, configuration_value, created_by, updated_by)
         VALUES ($1::uuid, $2, $3::jsonb, $4::uuid, $4::uuid)
         ON CONFLICT (store_id, configuration_name) DO UPDATE
           SET configuration_value = EXCLUDED.configuration_value,
               updated_by = EXCLUDED.updated_by,
               updated_at = now()
         RETURNING configuration_value, created_at, updated_at`,
        [storeId, this.promotionalImagesConfigurationName, JSON.stringify(nextValue), actorId],
      );
      return { ...rows[0].configuration_value, createdAt: rows[0].created_at, updatedAt: rows[0].updated_at };
    });
  }

  private async renameLegacyPromotionalImagesRow(db: any, storeId: string): Promise<void> {
    await db.query(
      `UPDATE public.store_pos_configurations AS legacy
       SET configuration_name = $3
       WHERE legacy.store_id = $1::uuid
         AND legacy.configuration_name = $2
         AND NOT EXISTS (
           SELECT 1 FROM public.store_pos_configurations AS current
           WHERE current.store_id = legacy.store_id AND current.configuration_name = $3
         )`,
      [storeId, this.legacyPromotionalImagesConfigurationName, this.promotionalImagesConfigurationName],
    );
    await db.query(
      `UPDATE public.store_pos_configurations AS configuration
       SET configuration_value = jsonb_build_object(
         'enabled', COALESCE(configuration.configuration_value->'enabled', 'false'::jsonb),
         'images', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', COALESCE(image.value->'id', to_jsonb(gen_random_uuid()::text)),
             'url', image.value->'url'
           ) ORDER BY image.ordinality)
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(configuration.configuration_value->'images') = 'array'
               THEN configuration.configuration_value->'images' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS image(value, ordinality)
           WHERE image.value ? 'url'
         ), '[]'::jsonb)
       )
       WHERE configuration.store_id = $1::uuid AND configuration.configuration_name = $2`,
      [storeId, this.promotionalImagesConfigurationName],
    );
  }

  private async resolveScope(scope: SettingsScope) {
    const storeKey = this.text(scope.storeHeader || scope.user?.storeId);
    const merchantKey = this.text(scope.merchantHeader || scope.user?.merchantId);
    const actorId = this.text(scope.user?.id);
    if (!storeKey) throw new BadRequestException('x-store-id header is required');
    if (!merchantKey) throw new BadRequestException('x-merchant-id header is required');
    if (!actorId) throw new ForbiddenException('Authenticated employee is required');

    const db = this.merchants.requireDataSource();
    const rows = await db.query(
      `SELECT s.id::text AS "storeId", s.merchant_id::text AS "merchantId"
       FROM public.stores s
       JOIN public.merchants m ON m.id = s.merchant_id
       WHERE (s.id::text = $1 OR s.store_code = $1)
         AND (m.id::text = $2 OR m.merchant_code = $2)
       LIMIT 1`,
      [storeKey, merchantKey],
    );
    const resolved = rows[0];
    if (!resolved) throw new NotFoundException('Store not found for this merchant');
    if (this.isUuid(scope.user?.storeId) && scope.user?.storeId !== resolved.storeId) {
      throw new ForbiddenException('Store scope does not match the authenticated session');
    }
    if (this.isUuid(scope.user?.merchantId) && scope.user?.merchantId !== resolved.merchantId) {
      throw new ForbiddenException('Merchant scope does not match the authenticated session');
    }
    return { db, storeId: resolved.storeId, actorId };
  }

  private isUuid(value?: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  }

  private text(value: unknown): string {
    return String(value ?? '').trim();
  }
}
