import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  ValidationPipe,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MerchantRepository } from "./merchant.repository";
import { CreateDeviceDto, UpdateDeviceDto } from "./device.dto";
import { MerchantEntity } from "./entities/merchant.entity";
import { DeviceEntity } from "./entities/device.entity";

@Controller("api/v1/devices")
export class DeviceController {
  constructor(
    @Inject(MerchantRepository) private readonly repository: MerchantRepository,
  ) {}

  @Post()
  async create(
    @Body(
      new ValidationPipe({
        expectedType: CreateDeviceDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: CreateDeviceDto,
  ) {
    const { merchant } = await this.repository.getMerchantById(body.merchantId);
    if (!merchant) throw new NotFoundException("Merchant not found");
    const merchantId = merchant.merchantId || body.merchantId;
    const { serialNumber } = body;
    const deviceCode = body.deviceCode || `DEV-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const device = await this.repository.createDevice({
      id: randomUUID(),
      deviceName: body.deviceName,
      deviceCode,
      deviceType: body.deviceType,
      merchantId,
      merchantName: merchant.businessName,
      serialNumber,
      status: body.status || "Active",
      createdAt: new Date(),
    });
    return {
      success: true,
      device: this.publicDevice(
        device,
      ),
    };
  }

  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const page = this.positiveInt(query.page, 1, "page");
    const limit = this.positiveInt(query.limit, 10, "limit");
    if (limit > 100) throw new BadRequestException("limit must not exceed 100");
    const from = this.queryDate(query.from, "from");
    const to = this.queryDate(query.to, "to");
    if (from && to && from >= to)
      throw new BadRequestException("from must be earlier than to");
    const status = query.status?.trim();
    if (
      status &&
      !["active", "inactive", "online", "offline"].includes(
        status.toLowerCase(),
      )
    ) {
      throw new BadRequestException(
        "status must be Active, Inactive, Online, or Offline",
      );
    }
    const result = this.repository.queryDevices
      ? await this.repository.queryDevices({
          page,
          limit,
          search: query.search?.trim() || undefined,
          merchantId: query.merchantId,
          deviceType: query.deviceType,
          status,
          from,
          to,
        })
      : await this.repository.listDevices().then(devices => ({ devices, total: devices.length, summary: {} }));
    const merchants = await this.repository.getAllMerchants();
    const merchantNames = new Map(
      merchants.map((item: MerchantEntity) => [item.id, item.businessName]),
    );
    const response: Record<string, unknown> = {
      count: result.total,
      devices: result.devices.map((device: DeviceEntity) =>
        this.publicDevice(
          device,
          merchantNames.get(device.merchantId),
        ),
      ),
    };
    if (query.page !== undefined || query.limit !== undefined) {
      response.pagination = {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      };
    }
    return response;
  }

  @Get("merchant/:merchantId")
  async listByMerchant(@Param("merchantId") merchantIdentifier: string) {
    const { merchant } = await this.repository.getMerchantById(merchantIdentifier);
    if (!merchant) throw new NotFoundException("Merchant not found");
    const merchantId = merchant.merchantId || merchantIdentifier;
    const devices = await this.repository.listDevicesByMerchantId(merchantId);
    return {
      count: devices.length,
      devices: devices.map((device) => this.publicDevice(device, merchant.businessName)),
    };
  }

  @Get(":deviceId")
  async get(@Param("deviceId", new ParseUUIDPipe()) deviceId: string) {
    const device = await this.repository.getDevice(deviceId);
    if (!device) throw new NotFoundException("Device not found");
    const merchants = await this.repository.getAllMerchants();
    return {
      success: true,
      device: this.publicDevice(
        device,
        merchants.find((item) => item.id === device.merchantId)?.businessName,
      ),
    };
  }

  @Put(":deviceId")
  async update(
    @Param("deviceId", new ParseUUIDPipe()) deviceId: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateDeviceDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateDeviceDto,
  ) {
    const current = await this.repository.getDevice(deviceId);
    if (!current) throw new NotFoundException("Device not found");
    if (!Object.keys(body).length)
      throw new BadRequestException("Provide at least one field to update");
    const requestedMerchantId = body.merchantId ?? current.merchantId;
    const { merchant } = await this.repository.getMerchantById(requestedMerchantId);
    if (!merchant) throw new NotFoundException("Merchant not found");
    const merchantId = merchant.merchantId || requestedMerchantId;
    const updated = await this.repository.updateDevice(deviceId, {
      deviceName: body.deviceName ?? current.deviceName,
      deviceType: body.deviceType ?? current.deviceType,
      deviceCode: body.deviceCode ?? current.deviceCode,
      serialNumber: body.serialNumber ?? current.serialNumber,
      merchantId,
      merchantName: merchant.businessName,
      status: body.status ?? current.status,
    });
    return {
      success: true,
      device: this.publicDevice(
        updated,
      ),
    };
  }

  @Patch(":deviceId")
  patch(
    @Param("deviceId", new ParseUUIDPipe()) deviceId: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateDeviceDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateDeviceDto,
  ) {
    return this.update(deviceId, body);
  }

  @Delete(":deviceId")
  async remove(@Param("deviceId", new ParseUUIDPipe()) deviceId: string) {
    if (!(await this.repository.deleteDevice(deviceId)))
      throw new NotFoundException("Device not found");
    return { success: true, message: "Device deleted" };
  }

  private publicDevice(
    device: DeviceEntity,
    merchantName?: string,
  ) {
    return {
      id: device.id,
      deviceName: device.deviceName,
      deviceCode: device.deviceCode,
      deviceType: device.deviceType,
      status: device.status,
      merchantId: device.merchantId,
      merchantName: merchantName || device.merchantName || device.merchantId,
      serialNumber: device.serialNumber,
      createdAt: device.createdAt,
      connectionStatus: device.status === "Inactive" ? "Inactive" : "Offline",
      lastSeenAt: null,
    };
  }

  private positiveInt(
    value: string | undefined,
    fallback: number,
    name: string,
  ): number {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1)
      throw new BadRequestException(`${name} must be a positive integer`);
    return Number(value);
  }

  private queryDate(value: string | undefined, name: string): Date | undefined {
    if (value === undefined) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      throw new BadRequestException(`${name} must be a valid date`);
    return date;
  }
}
