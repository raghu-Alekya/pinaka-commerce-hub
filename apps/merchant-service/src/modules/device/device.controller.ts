import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CreateDeviceDto, UpdateDeviceDto } from "./dto/device.dto";
import { MerchantEntity } from "../../entities/merchant.entity";
import { DeviceEntity } from "../../entities/device.entity";
import { RecordStatus } from "../../entities/commerce-enums";
import { RequireAuth } from "../shared/session-auth.guard";
import { isWebConsoleRequest } from '../shared/console-access';
import { DeviceService } from './device.service';

type AuthenticatedRequest = { headers?: { 'x-pch-web-console'?: string }; user?: { id?: string; accountType?: string; merchantId?: string; merchantCode?: string } };

@Controller(["api/v1/devices", "connector/api/v1/devices", "devices"])
export class DeviceController {
  constructor(@Inject(DeviceService) private readonly service: DeviceService) {}

  @Post()
  @RequireAuth()
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
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.auditUser(request);
    const merchantIdentifier = body.merchant_id || body.merchantId || body.merchant;
    if (!merchantIdentifier) throw new BadRequestException("merchant_id is required");
    const merchant = await this.service.findDeviceMerchant(merchantIdentifier);
    if (!merchant) throw new NotFoundException("Merchant not found");
    const merchantId = merchant.id;
    this.assertMerchant(request, merchantId);
    const deviceName = body.device_name || body.deviceName || "POS Terminal";
    const deviceType = body.device_type || body.deviceType || "POS Terminal";
    const rawSerialNumber = (
      body.serial_number ||
      body.serialNumber ||
      body.device_serial_number ||
      body.deviceSerialNumber ||
      ""
    ).trim();
    const serial_number = rawSerialNumber || null;
    const device = await this.service.createDevice({
      id: randomUUID(),
      deviceId: body.device_id || body.deviceId || null,
      deviceName,
      deviceType,
      merchantId,
      merchantName: merchant.businessDisplayName ?? merchant.id,
      serialNumber: serial_number,
      activationCode: body.authorization_code || body.authorizationCode || null,
      notes: body.notes || null,
      status: body.status ?? RecordStatus.ACTIVE,
      createdBy: actor,
      updatedBy: actor,
    });
    return {
      success: true,
      device: this.publicDevice(
        device,
      ),
    };
  }

  @Get()
  async list(@Query() query: Record<string, string | undefined>, @Req() request: AuthenticatedRequest) {
    const scopedMerchantId = this.scopedMerchantId(request);
    if (scopedMerchantId && query.merchant_id) {
      const requested = await this.service.findDeviceMerchant(query.merchant_id);
      this.assertMerchant(request, requested?.id);
    }
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
    const result = this.service.queryDevices
      ? await this.service.queryDevices({
          page,
          limit,
          search: query.search?.trim() || undefined,
          merchantId: scopedMerchantId || query.merchant_id,
          deviceType: query.device_type,
          status,
          from,
          to,
        })
      : await (scopedMerchantId ? this.service.listDevicesByMerchantId(scopedMerchantId) : this.service.listDevices()).then(devices => ({
          devices,
          total: devices.length,
          summary: devices.reduce((counts, device) => {
            const status = String(device.status).toLowerCase();
            counts[status] = (counts[status] ?? 0) + 1;
            return counts;
          }, {} as Record<string, number>),
        }));
    const merchants = await this.service.getAllMerchants();
    const merchantNames = new Map(
      merchants.map((item: MerchantEntity) => [item.id, item.businessName ?? undefined]),
    );
    const response: Record<string, unknown> = {
      count: result.total,
      summary: {
        total_devices: (result.summary.active ?? 0) + (result.summary.inactive ?? 0),
        online_devices: 0,
        offline_devices: result.summary.active ?? 0,
        inactive_devices: result.summary.inactive ?? 0,
      },
      devices: await (async () => {
        const storeMap = await this.service.getStoreMappingsForDevices(result.devices.map((d: DeviceEntity) => d.id));
        return result.devices.map((device: DeviceEntity) => {
          const storeInfo = storeMap.get(device.id);
          return {
            ...this.publicDevice(
              device,
              merchantNames.get(device.merchantId),
            ),
            store_id: storeInfo?.storeId ?? null,
            storeId: storeInfo?.storeId ?? null,
            store_name: storeInfo?.storeName ?? null,
            storeName: storeInfo?.storeName ?? null,
            store: storeInfo?.storeName ?? null,
          };
        });
      })(),
    };
    if (query.page !== undefined || query.limit !== undefined) {
      response.pagination = {
        page,
        limit,
        total: result.total,
        total_pages: Math.ceil(result.total / limit),
      };
    }
    return response;
  }

  @Get("merchant/:merchant_id")
  async listByMerchant(@Param("merchant_id") merchantIdentifier: string, @Req() request: AuthenticatedRequest) {
    const merchant = await this.service.findDeviceMerchant(merchantIdentifier);
    if (!merchant) throw new NotFoundException("Merchant not found");
    const merchantId = merchant.id;
    this.assertMerchant(request, merchantId);
    const devices = await this.service.listDevicesByMerchantId(merchantId);
    const storeMap = await this.service.getStoreMappingsForDevices(devices.map((d) => d.id));
    return {
      count: devices.length,
      active_devices_count: devices.filter(device => device.status === RecordStatus.ACTIVE).length,
      inactive_devices_count: devices.filter(device => device.status === RecordStatus.INACTIVE).length,
      devices: devices.map((device) => {
        const storeInfo = storeMap.get(device.id);
        return {
          ...this.publicDevice(device, merchant.businessDisplayName ?? merchant.id),
          store_id: storeInfo?.storeId ?? null,
          storeId: storeInfo?.storeId ?? null,
          store_name: storeInfo?.storeName ?? null,
          storeName: storeInfo?.storeName ?? null,
          store: storeInfo?.storeName ?? null,
        };
      }),
    };
  }

  @Get("available")
  async listAvailableByMerchant(@Query("merchant_id", new ParseUUIDPipe()) merchantUuid: string, @Req() request: AuthenticatedRequest) {
    this.assertMerchant(request, merchantUuid);
    const devices = await this.service.findAvailableDevicesByMerchant(merchantUuid);
    if (!devices) throw new NotFoundException("Merchant not found");
    return {
      count: devices.length,
      devices: devices.map(device => this.publicDevice(device)),
    };
  }

  @Get(":device_id")
  async get(@Param("device_id", new ParseUUIDPipe()) deviceId: string, @Req() request: AuthenticatedRequest) {
    const device = await this.service.getDevice(deviceId);
    if (!device) throw new NotFoundException("Device not found");
    this.assertMerchant(request, device.merchantId);
    const merchants = await this.service.getAllMerchants();
    const storeMap = await this.service.getStoreMappingsForDevices([device.id]);
    const storeInfo = storeMap.get(device.id);
    return {
      success: true,
      device: {
        ...this.publicDevice(
          device,
          merchants.find((item) => item.id === device.merchantId)?.businessName ?? undefined,
        ),
        store_id: storeInfo?.storeId ?? null,
        storeId: storeInfo?.storeId ?? null,
        store_name: storeInfo?.storeName ?? null,
        storeName: storeInfo?.storeName ?? null,
        store: storeInfo?.storeName ?? null,
      },
    };
  }

  @Put(":device_id")
  @RequireAuth()
  async update(
    @Param("device_id", new ParseUUIDPipe()) deviceId: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateDeviceDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateDeviceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.auditUser(request);
    const current = await this.service.getDevice(deviceId);
    if (!current) throw new NotFoundException("Device not found");
    this.assertMerchant(request, current.merchantId);
    if (!Object.keys(body).length)
      throw new BadRequestException("Provide at least one field to update");
    const requestedMerchantId = body.merchant_id ?? current.merchantId;
    const merchant = await this.service.findDeviceMerchant(requestedMerchantId);
    if (!merchant) throw new NotFoundException("Merchant not found");
    const merchantId = merchant.id;
    this.assertMerchant(request, merchantId);
    const updated = await this.service.updateDevice(deviceId, {
      deviceName: body.device_name ?? current.deviceName,
      deviceType: body.device_type ?? current.deviceType,
      deviceCode: current.deviceCode,
      deviceId: body.device_id ?? current.deviceId,
      serialNumber: body.serial_number ?? current.serialNumber,
      authorizationCode: body.authorization_code ?? body.authorizationCode ?? current.authorizationCode,
      deviceActiveCode: body.authorization_code ?? body.authorizationCode ?? current.deviceActiveCode,
      merchantId,
      merchantName: merchant.businessDisplayName ?? merchant.id,
      status: body.status ?? current.status,
      updatedBy: actor,
      updatedAt: new Date(),
    });
    return {
      success: true,
      device: this.publicDevice(
        updated,
      ),
    };
  }

  @Patch(":device_id")
  @RequireAuth()
  patch(
    @Param("device_id", new ParseUUIDPipe()) deviceId: string,
    @Body(
      new ValidationPipe({
        expectedType: UpdateDeviceDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    body: UpdateDeviceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.update(deviceId, body, request);
  }

  @Delete(":device_id")
  @RequireAuth()
  async remove(@Param("device_id", new ParseUUIDPipe()) deviceId: string, @Req() request: AuthenticatedRequest) {
    const current = await this.service.getDevice(deviceId);
    if (!current) throw new NotFoundException("Device not found");
    this.assertMerchant(request, current.merchantId);
    if (!(await this.service.deleteDevice(deviceId, this.auditUser(request))))
      throw new NotFoundException("Device not found");
    return { success: true, message: "Device deactivated" };
  }

  private publicDevice(
    device: DeviceEntity,
    merchantName?: string,
  ) {
    return {
      id: device.id,
      device_id: device.deviceId ?? null,
      device_name: device.deviceName,
      device_code: device.deviceCode,
      device_type: device.deviceType,
      status: device.status,
      merchant_id: device.merchantId,
      merchant_name: merchantName || device.merchantName || device.merchantId,
      serial_number: device.serialNumber ?? null,
      device_active_code: device.deviceActiveCode ?? null,
      authorization_code: device.authorizationCode ?? device.deviceActiveCode ?? null,
      activation_code: device.deviceActiveCode ?? null,
      notes: (device as any).notes ?? null,
      created_at: device.createdAt,
      updated_at: device.updatedAt,
      created_by: device.createdBy ?? null,
      updated_by: device.updatedBy ?? null,
      connection_status: device.status === "INACTIVE" ? "Inactive" : "Offline",
      last_seen_at: null,
    };
  }

  private auditUser(request: AuthenticatedRequest): string {
    const id = request.user?.id;
    if (!id) {
      if (process.env.SKIP_AUTH === 'true') {
        return '11111111-1111-4111-8111-111111111111';
      }
      throw new UnauthorizedException("Authenticated user UUID is unavailable");
    }
    return id;
  }

  private scopedMerchantId(request: AuthenticatedRequest): string | undefined {
    const user = request.user;
    if (!isWebConsoleRequest(request)) return undefined;
    if (user?.accountType !== 'merchant' && user?.accountType !== 'employee') return undefined;
    if (!user.merchantId) throw new ForbiddenException('Merchant session is missing its merchant ID');
    return user.merchantId;
  }

  private assertMerchant(request: AuthenticatedRequest, merchantId?: string): void {
    const scoped = this.scopedMerchantId(request);
    if (scoped && (!merchantId || scoped.toLowerCase() !== merchantId.toLowerCase())) {
      throw new ForbiddenException('You can only access your own devices');
    }
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
