import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantRepository } from '../../merchant/merchant.repository';
import { CreateStoreDeviceMappingDto } from './dto/create-store-device-mapping.dto';
import { StoreDeviceMappingRepository } from './store-device-mapping.repository';

@Injectable()
export class StoreDeviceMappingService {
  constructor(
    @Inject(StoreDeviceMappingRepository) private readonly mappings: StoreDeviceMappingRepository,
    @Inject(MerchantRepository) private readonly merchants: MerchantRepository,
  ) {}

  async map(dto: CreateStoreDeviceMappingDto, actorId: string) {
    const [store, device] = await Promise.all([
      this.merchants.getStoreById(dto.store_id),
      this.merchants.getDevice(dto.device_id),
    ]);
    if (!store) throw new NotFoundException('Store not found');
    if (!device) throw new NotFoundException('Device not found');
    if (store.merchantId !== device.merchantId) {
      throw new ConflictException('Store and device must belong to the same merchant');
    }

    const active = await this.mappings.findActiveByDevice(device.id);
    if (active) {
      if (active.store_id === store.id) {
        throw new ConflictException('Device is already mapped to this store');
      }
      throw new ConflictException('Device is already mapped to another store; unmap it first');
    }

    return this.mappings.create({
      storeId: store.id,
      deviceId: device.id,
      merchantId: store.merchantId,
      actorId,
    });
  }

  async findByStore(storeKey: string) {
    const store = await this.merchants.getStoreById(storeKey);
    if (!store) throw new NotFoundException('Store not found');
    return this.mappings.findByStore(store.id);
  }

  async unmap(id: string, actorId: string) {
    const mapping = await this.mappings.softDelete(id, actorId);
    if (!mapping) throw new NotFoundException('Active store-device mapping not found');
    return mapping;
  }
}
