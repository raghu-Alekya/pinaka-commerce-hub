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
import { StoreEntity } from "./entities/store.entity";
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
    const store = body.storeId
      ? await this.repository.getStoreById(body.storeId)
      : null;
    if (body.storeId && !store) throw new NotFoundException("Store not found");
    if (store && store.merchantId !== merchantId)
      throw new BadRequestException("Store does not belong to the selected merchant");
    const details = this.deviceDetails(body, {});
    const { serialNumber } = body;
    const deviceCode = body.deviceCode || `DEV-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const device = await this.repository.createDevice({
      id: randomUUID(),
      deviceName: String(details.deviceName),
      deviceCode,
      deviceType: body.deviceType,
      merchantId,
      merchantName: merchant.businessName,
      storeId: store?.id ?? null,
      storeName: store?.storeName ?? null,
      serialNumber,
      status: String(details.status),
      createdAt: new Date(),
      details,
    });
    return {
      success: true,
      device: this.publicDevice(
        device,
        merchant?.businessName,
        store?.storeName,
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
          storeId: query.storeId,
          deviceType: query.deviceType,
          status,
          from,
          to,
        })
      : await this.repository.listDevices().then(devices => ({ devices, total: devices.length, summary: {} }));
    const [merchants, stores] = await Promise.all([
      this.repository.getAllMerchants(),
      this.repository.listStores(),
    ]);
    const merchantNames = new Map(
      merchants.map((item: MerchantEntity) => [item.id, item.businessName]),
    );
    const storeNames = new Map(
      stores.map((item: StoreEntity) => [item.id, item.storeName]),
    );
    const response: Record<string, unknown> = {
      count: result.total,
      devices: result.devices.map((device: DeviceEntity) =>
        this.publicDevice(
          device,
          merchantNames.get(device.merchantId),
          device.storeId ? storeNames.get(device.storeId) : undefined,
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

  @Get(":deviceId")
  async get(@Param("deviceId", new ParseUUIDPipe()) deviceId: string) {
    const device = await this.repository.getDevice(deviceId);
    if (!device) throw new NotFoundException("Device not found");
    const [merchants, stores] = await Promise.all([
      this.repository.getAllMerchants(),
      this.repository.listStores(),
    ]);
    return {
      success: true,
      device: this.publicDevice(
        device,
        merchants.find((item) => item.id === device.merchantId)?.businessName,
        stores.find((item) => item.id === device.storeId)?.storeName,
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
    let storeId = current.storeId;
    let storeName = current.storeName;
    if (body.storeId === null) {
      storeId = null;
      storeName = null;
    } else if (body.storeId !== undefined) {
      const store = await this.repository.getStoreById(body.storeId);
      if (!store) throw new NotFoundException("Store not found");
      if (store.merchantId !== merchantId)
        throw new BadRequestException("Store does not belong to the selected merchant");
      storeId = store.id;
      storeName = store.storeName;
    }
    const existingDetails = (current.details || {}) as Record<string, unknown>;
    const details = this.deviceDetails(body, existingDetails);
    const updated = await this.repository.updateDevice(deviceId, {
      deviceName: String(details.deviceName ?? current.deviceName),
      deviceType: String(details.deviceType ?? current.deviceType),
      deviceCode: body.deviceCode ?? current.deviceCode,
      serialNumber: body.serialNumber ?? current.serialNumber,
      merchantId,
      merchantName: merchant.businessName,
      storeId,
      storeName,
      status: String(details.status),
      details,
    });
    return {
      success: true,
      device: this.publicDevice(
        updated,
        merchant.businessName,
        storeName || undefined,
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

  private deviceDetails(
    input: Partial<CreateDeviceDto & UpdateDeviceDto>,
    previous: Record<string, unknown>,
  ) {
    const details = { ...previous };
    for (const key of [
      "deviceName",
      "deviceType",
      "macAddress",
      "model",
      "manufacturer",
      "timeZone",
      "location",
      "floor",
      "notes",
      "image",
    ] as const) {
      if (input[key] !== undefined) details[key] = input[key];
    }
    const timeZone =
      (input.timeZone as string | undefined) ??
      (details.timeZone as string | undefined) ??
      "Asia/Kolkata";
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      throw new BadRequestException("Invalid time zone");
    }
    if (input.image) {
      const bytes = Buffer.from(input.image.split(",")[1], "base64");
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (
        bytes.length > 2 * 1024 * 1024 ||
        !(input.image.startsWith("data:image/png") ? png : jpeg)
      ) {
        throw new BadRequestException(
          "Image must be a JPG or PNG no larger than 2MB",
        );
      }
    }
    const enableImmediately =
      input.enableImmediately ??
      (input.status
        ? input.status !== "Inactive"
        : details.enableImmediately !== false);
    const status = input.status ?? details.status ?? "Active";
    details.status =
      status === "Inactive" || !enableImmediately ? "Inactive" : "Active";
    details.enableImmediately = enableImmediately;
    details.timeZone = timeZone;
    if (typeof details.deviceName === "string")
      details.deviceName = details.deviceName.trim();
    return details;
  }

  private publicDevice(
    device: DeviceEntity,
    merchantName?: string,
    storeName?: string | null,
  ) {
    const { image, ...details } = (device.details || {}) as Record<
      string,
      unknown
    >;
    return {
      ...details,
      id: device.id,
      deviceName: device.deviceName,
      deviceCode: device.deviceCode,
      deviceType: device.deviceType,
      status: device.status,
      merchantId: device.merchantId,
      merchantName: merchantName || device.merchantName || device.merchantId,
      storeId: device.storeId ?? null,
      storeName: storeName || device.storeName || device.storeId || null,
      serialNumber: device.serialNumber,
      createdAt: device.createdAt,
      connectionStatus: details.status === "Inactive" ? "Inactive" : "Offline",
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
