import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Post, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MerchantRepository } from './merchant.repository';
import { CreateDeviceDto } from './device.dto';

@Controller('api/v1/devices')
export class DeviceController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Post()
  async create(@Body(new ValidationPipe({ expectedType: CreateDeviceDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateDeviceDto) {
    const { merchant } = await this.repository.getMerchantById(body.merchantId);
    if (!merchant) throw new NotFoundException('Merchant not found');
    const store = await this.repository.getStoreById(body.storeId);
    if (!store) throw new NotFoundException('Store not found');
    if (store.merchantId !== body.merchantId) throw new BadRequestException('Store does not belong to the selected merchant');
    const timeZone = body.timeZone || 'Asia/Kolkata';
    try { new Intl.DateTimeFormat('en', { timeZone }); }
    catch { throw new BadRequestException('Invalid time zone'); }
    if (body.image) {
      const bytes = Buffer.from(body.image.split(',')[1], 'base64');
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (bytes.length > 2 * 1024 * 1024 || !(body.image.startsWith('data:image/png') ? png : jpeg)) {
        throw new BadRequestException('Image must be a JPG or PNG no larger than 2MB');
      }
    }
    const { merchantId, storeId, serialNumber, ...details } = body;
    const device = await this.repository.createDevice({
      id: randomUUID(), merchantId, storeId, serialNumber, createdAt: new Date(),
      details: { ...details, deviceName: body.deviceName.trim(), timeZone,
        status: body.status === 'Inactive' || body.enableImmediately === false ? 'Inactive' : 'Active',
        enableImmediately: body.enableImmediately !== false },
    });
    return { success: true, device: { ...device.details, id: device.id, merchantId, storeId, serialNumber, createdAt: device.createdAt } };
  }

  @Get()
  async list() {
    const [devices, merchants, stores] = await Promise.all([
      this.repository.listDevices(), this.repository.getAllMerchants(), this.repository.listStores(),
    ]);
    const merchantNames = new Map(merchants.map(item => [item.id, item.businessName]));
    const storeNames = new Map(stores.map(item => [item.id, item.storeName]));
    return { count: devices.length, devices: devices.map(device => {
      const { image, ...details } = device.details;
      return { ...details, id: device.id, merchantId: device.merchantId, storeId: device.storeId,
        serialNumber: device.serialNumber, createdAt: device.createdAt,
        merchantName: merchantNames.get(device.merchantId) || device.merchantId,
        storeName: storeNames.get(device.storeId) || device.storeId,
        connectionStatus: details.status === 'Inactive' ? 'Inactive' : 'Offline', lastSeenAt: null };
    }) };
  }
}
