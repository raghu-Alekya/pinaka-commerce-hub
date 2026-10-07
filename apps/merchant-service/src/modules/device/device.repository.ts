import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { MerchantRepository } from '../merchant/merchant.repository';
import { MerchantDeviceEntity } from '../../entities/merchant-device.entity';
import { DeviceEntity } from '../../entities/device.entity';
import { RecordStatus } from '../../entities/commerce-enums';

@Injectable()
export class DeviceRepository {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  async createDeviceWithMerchantMapping(data: {
    id: string;
    deviceName?: string;
    deviceCode?: string;
    deviceType: string;
    merchantId: string;
    merchantName?: string;
    serialNumber: string;
    status?: RecordStatus;
    createdBy: string;
    updatedBy: string;
  }): Promise<DeviceEntity> {
    try {
      return await this.merchants.requireDataSource().transaction(async manager => {
        const deviceRepository = manager.getRepository(DeviceEntity);
        const device = await deviceRepository.save(deviceRepository.create({
          id: data.id,
          deviceName: data.deviceName || 'Unnamed device',
          deviceCode: data.deviceCode || `DEV-${data.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          deviceType: data.deviceType,
          merchantId: data.merchantId,
          merchantName: data.merchantName || data.merchantId,
          serialNumber: data.serialNumber,
          status: data.status || RecordStatus.ACTIVE,
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
        }));

        const mappingRepository = manager.getRepository(MerchantDeviceEntity);
        await mappingRepository.save(mappingRepository.create({
          deviceId: device.id,
          merchantId: data.merchantId,
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
          isDeleted: false,
        }));
        return device;
      });
    } catch (error: any) {
      if ((error?.driverError?.code || error?.code) === '23505') {
        throw new ConflictException('Device code or serial number already exists');
      }
      throw error;
    }
  }

  private repository() {
    return this.merchants.requireDataSource().getRepository(MerchantDeviceEntity);
  }

  async findDevicesByMerchant(merchantId: string): Promise<DeviceEntity[]> {
    const rows = await this.repository()
      .createQueryBuilder('mapping')
      .innerJoinAndSelect('mapping.device', 'device', 'device.isDeleted = false')
      .where('mapping.merchantId = :merchantId', { merchantId })
      .andWhere('mapping.isDeleted = false')
      .orderBy('mapping.createdAt', 'DESC')
      .getMany();
    return rows.flatMap(mapping => mapping.device ? [mapping.device] : []);
  }

  async findAvailableDevicesByMerchant(merchantId: string): Promise<DeviceEntity[]> {
    return this.merchants.requireDataSource().getRepository(DeviceEntity)
      .createQueryBuilder('device')
      .where(`device.id IN (
        SELECT merchant_device.device_id
        FROM public.merchant_devices merchant_device
        WHERE merchant_device.merchant_id = :merchantId
          AND merchant_device.is_deleted = false
      )`, { merchantId })
      .andWhere('device.is_deleted = false')
      .andWhere(`NOT EXISTS (
        SELECT 1 FROM public.store_devices store_device
        WHERE store_device.device_id = device.id
          AND store_device.is_mapped = true
          AND store_device.is_deleted = false
      )`)
      .orderBy('device.created_at', 'DESC')
      .getMany();
  }

  async queryDevicesByMerchant(filters: {
    merchantId: string;
    page: number;
    limit: number;
    search?: string;
    deviceType?: string;
    status?: string;
    from?: Date;
    to?: Date;
  }): Promise<{ devices: DeviceEntity[]; total: number; summary: Record<string, number> }> {
    const repository = this.merchants.requireDataSource().getRepository(DeviceEntity);
    const buildQuery = (withFilters: boolean) => {
      const query = repository.createQueryBuilder('device')
        .innerJoin(
          'public.merchant_devices',
          'mapping',
          'mapping.device_id = device.id AND mapping.is_deleted = false',
        )
        .where('mapping.merchant_id = :merchantId', { merchantId: filters.merchantId })
        .andWhere('device.is_deleted = false');

      if (!withFilters) return query;
      if (filters.search) {
        query.andWhere(
          '(device.device_name ILIKE :search OR device.device_code ILIKE :search OR device.serial_number ILIKE :search)',
          { search: `%${filters.search}%` },
        );
      }
      if (filters.deviceType) query.andWhere('device.device_type = :deviceType', { deviceType: filters.deviceType });
      if (filters.status?.toLowerCase() === 'active' || filters.status?.toLowerCase() === 'offline') {
        query.andWhere(`device.status = 'ACTIVE'`);
      }
      if (filters.status?.toLowerCase() === 'inactive') query.andWhere(`device.status = 'INACTIVE'`);
      if (filters.status?.toLowerCase() === 'online') query.andWhere('1 = 0');
      if (filters.from) query.andWhere('device.created_at >= :from', { from: filters.from });
      if (filters.to) query.andWhere('device.created_at < :to', { to: filters.to });
      return query;
    };

    const [devices, total] = await buildQuery(true)
      .orderBy('device.created_at', 'DESC')
      .skip((filters.page - 1) * filters.limit)
      .take(filters.limit)
      .getManyAndCount();
    const summaryRows = await buildQuery(false)
      .select('device.status', 'status')
      .addSelect('COUNT(DISTINCT device.id)', 'count')
      .groupBy('device.status')
      .getRawMany();
    const summary = Object.fromEntries(
      summaryRows.map((row: { status: string; count: string | number }) => [
        String(row.status).toLowerCase(),
        Number(row.count),
      ]),
    );
    return { devices, total, summary };
  }

  async updateMerchantForDevice(deviceId: string, merchantId: string, actorId: string): Promise<void> {
    await this.repository().update(
      { deviceId, isDeleted: false },
      { merchantId, updatedBy: actorId },
    );
  }

}
