import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';

export interface StoreDeviceMapping {
  id: string;
  store_id: string;
  device_id: string;
  merchant_id: string;
  is_mapped: boolean;
  created_by: string | null;
  updated_by: string | null;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class StoreDeviceMappingRepository {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async create(data: {
    storeId: string;
    deviceId: string;
    merchantId: string;
    actorId: string;
  }): Promise<StoreDeviceMapping> {
    return this.merchants.requireDataSource().transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [data.deviceId]);
      const [active] = await manager.query(
        `SELECT id FROM public.store_devices
         WHERE device_id = $1 AND is_deleted = false AND is_mapped = true LIMIT 1`,
        [data.deviceId],
      );
      if (active) throw new ConflictException('Device already has an active store mapping');
      const [mapping] = await manager.query(
        `INSERT INTO public.store_devices
          (store_id, device_id, merchant_id, is_mapped, created_by, updated_by)
         VALUES ($1, $2, $3, true, $4, $4)
         RETURNING id, store_id, device_id, merchant_id, is_mapped,
                   created_by, updated_by, is_deleted, created_at, updated_at`,
        [data.storeId, data.deviceId, data.merchantId, data.actorId],
      );
      return mapping;
    });
  }

  async findByStore(storeId: string): Promise<StoreDeviceMapping[]> {
    return this.merchants.requireDataSource().query(
      `SELECT id, store_id, device_id, merchant_id, is_mapped,
              created_by, updated_by, is_deleted, created_at, updated_at
       FROM public.store_devices
       WHERE store_id = $1 AND is_deleted = false AND is_mapped = true
       ORDER BY created_at DESC`,
      [storeId],
    );
  }

  async findActiveByDevice(deviceId: string): Promise<StoreDeviceMapping | null> {
    const [mapping] = await this.merchants.requireDataSource().query(
      `SELECT id, store_id, device_id, merchant_id, is_mapped,
              created_by, updated_by, is_deleted, created_at, updated_at
       FROM public.store_devices
       WHERE device_id = $1 AND is_deleted = false AND is_mapped = true
       ORDER BY created_at DESC LIMIT 1`,
      [deviceId],
    );
    return mapping ?? null;
  }

  async softDelete(id: string, actorId: string): Promise<StoreDeviceMapping | null> {
    const [mapping] = await this.merchants.requireDataSource().query(
      `UPDATE public.store_devices
       SET is_mapped = false, is_deleted = true, updated_by = $2, updated_at = now()
       WHERE id = $1 AND is_deleted = false
       RETURNING id, store_id, device_id, merchant_id, is_mapped,
                 created_by, updated_by, is_deleted, created_at, updated_at`,
      [id, actorId],
    );
    return mapping ?? null;
  }
}
