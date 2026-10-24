import { Inject, Controller, Get, Post, Put, Body, Param, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { PosRepository } from './pos.repository';
import { PosConfigRepository } from './pos-config.repository';
import { FastkeyItem } from './pos-config.entity';
import { MovementType } from './entities/cash-movement.entity';
import { describeUnmappedShiftKeys, normalizeShiftClose, normalizeShiftCreate, normalizeShiftUpdate } from './shift-request';
import { ShiftReportService } from './shift-report.service';
import { shiftDebug, shiftErrorDetails, summarizeShiftWrite } from './shift-debug.log';

const SHIFT_REQUEST_ALIASES = [
  ['merchant_id', 'merchantId'],
  ['store_id', 'storeId'],
  ['terminal_id', 'terminalId'],
  ['device_id', 'terminalId'],
  ['deviceId', 'terminalId'],
  ['shift_id', 'shiftId'],
  ['movement_type', 'movementType'],
  ['performed_by', 'performedBy'],
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeShiftRequest<T extends object>(input: T): T {
  const request = { ...input } as T & Record<string, unknown>;
  for (const [snakeName, camelName] of SHIFT_REQUEST_ALIASES) {
    if (!(snakeName in request)) continue;
    if (camelName in request && !Object.is(request[snakeName], request[camelName])) {
      throw new BadRequestException(`Conflicting values for ${snakeName} and ${camelName}`);
    }
    Object.assign(request, { [camelName]: request[snakeName] });
    delete request[snakeName];
  }
  return request;
}

@Controller('api/v1/pos')
export class AppController {
  constructor(
    @Inject(PosRepository) private readonly posRepository: PosRepository,
    @Inject(PosConfigRepository) private readonly posConfigRepository: PosConfigRepository,
    @Inject(ShiftReportService) private readonly shiftReport: ShiftReportService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'pos-integration-service',
      version: '2.0.0 (PCH Module 5)',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('stores/:storeId/fastkeys')
  async getFastkeys(@Param('storeId') storeId: string) {
    const config = await this.posConfigRepository.getStoreConfig(storeId);
    return {
      success: true,
      storeId,
      fastkeys: config.fastkeys || [],
      version: config.version,
    };
  }

  @Put('stores/:storeId/fastkeys')
  async saveFastkeys(
    @Param('storeId') storeId: string,
    @Body('fastkeys') fastkeys: FastkeyItem[],
  ) {
    if (!Array.isArray(fastkeys)) {
      throw new BadRequestException('fastkeys must be an array');
    }
    const config = await this.posConfigRepository.updateFastkeys(storeId, fastkeys);
    return {
      success: true,
      message: 'Fast Keys saved successfully',
      storeId,
      fastkeys: config.fastkeys,
      version: config.version,
    };
  }

  @Post('activate')
  async activateTerminal(@Body('activationPin') pin: string) {
    if (!pin || pin.trim().length !== 6) {
      throw new BadRequestException('A valid 6-digit terminal activation PIN is required');
    }
    return {
      success: true,
      message: 'Sunmi POS Terminal Paired Successfully!',
      sessionToken: `jwt_pos_${Date.now()}_${pin}`,
      store: {
        id: 'STR-5001',
        merchantId: 'MCH-1001',
        storeName: 'Fresh Mart - Downtown Branch',
        storeType: 'GROCERY',
        currency: 'USD',
        taxRate: 8.25,
      },
      entitlements: ['POS', 'BARCODE_SCANNING', 'UBER_EATS', 'DOORDASH', 'PAYROLL', 'LOYALTY'],
    };
  }

  @Post(['shifts', 'shifts/open'])
  async openShift(@Body() request: Record<string, unknown>) {
    return this.traceShift('POST /shifts', request, async () => {
      const write = normalizeShiftCreate(request);
      shiftDebug('normalized', { action: 'POST /shifts', save: summarizeShiftWrite(write) });
      const shift = await this.posRepository.createShift(write);
      return {
        success: true,
        message: 'Shift created and opened successfully',
        shift_id: shift.id,
        shiftId: shift.id,
        shift,
      };
    });
  }

  @Post('shifts/update')
  async updateShift(@Body() request: Record<string, unknown>) {
    return this.traceShift('POST /shifts/update', request, async () => {
      const write = normalizeShiftUpdate(request);
      shiftDebug('normalized', { action: 'POST /shifts/update', save: summarizeShiftWrite(write) });
      const shift = await this.posRepository.updateShift(write.shiftId, write);
      if (!shift) throw new NotFoundException(`Shift '${write.shiftId}' not found`);
      return {
        success: true,
        message: 'Shift updated successfully',
        shift_id: shift.id,
        shift,
      };
    });
  }

  @Put('shifts/:shift_id')
  async updateShiftById(
    @Param('shift_id') shiftId: string,
    @Body() request: Record<string, unknown>,
  ) {
    return this.traceShift('PUT /shifts/:shift_id', { shift_id: shiftId, ...(request ?? {}) }, async () => {
      const write = normalizeShiftUpdate(request ?? {}, shiftId);
      shiftDebug('normalized', { action: 'PUT /shifts/:shift_id', save: summarizeShiftWrite(write) });
      const shift = await this.posRepository.updateShift(write.shiftId, write);
      if (!shift) throw new NotFoundException(`Shift '${write.shiftId}' not found`);
      return {
        success: true,
        message: 'Shift updated successfully',
        shift_id: shift.id,
        shift,
      };
    });
  }

  @Post('shifts/cash-movement')
  async recordCashMovement(@Body() request: {
    shiftId?: string;
    shift_id?: string;
    storeId?: string;
    store_id?: string;
    movementType?: MovementType;
    movement_type?: MovementType;
    amount: number;
    performedBy?: string;
    performed_by?: string;
    reason?: string;
  }) {
    return this.traceShift('POST /shifts/cash-movement', request, async () => {
      const body = normalizeShiftRequest(request);
      if (!body.shiftId || !body.storeId || !body.amount) {
        throw new BadRequestException('shiftId, storeId, and amount are required');
      }
      const movement = await this.posRepository.recordCashMovement(body.shiftId, body.storeId, body.movementType || MovementType.SAFE_DROP, body.amount, body.performedBy || 'Manager', body.reason);
      return {
        success: true,
        message: `Cash movement '${movement.movementType}' recorded successfully!`,
        cashMovement: movement,
      };
    });
  }

  @Post('shifts/close')
  async closeShift(@Body() request: Record<string, unknown>) {
    return this.traceShift('POST /shifts/close', request, async () => {
      const write = normalizeShiftClose(request);
      shiftDebug('normalized', { action: 'POST /shifts/close', save: summarizeShiftWrite(write) });
      const shift = await this.posRepository.updateShift(write.shiftId, write);
      if (!shift) throw new NotFoundException(`Shift '${write.shiftId}' not found`);
      return {
        success: true,
        message: 'Shift closed successfully! Z-Report generated for thermal printing.',
        shift_id: shift.id,
        shift,
        reportType: 'Z_REPORT',
      };
    });
  }

  @Get('shifts/get-shift-by-id')
  async getShiftById(
    @Query('shiftId') shiftId?: string,
    @Query('shift_id') shift_id?: string,
    @Query('employeeId') employeeId?: string,
    @Query('employee_id') employee_id?: string,
  ) {
    const query = { shiftId, shift_id, employeeId, employee_id };
    return this.traceShift('GET /shifts/get-shift-by-id', query, () => this.shiftReport.getShiftById(shiftId || shift_id, employeeId || employee_id));
  }

  @Get('shifts/active')
  async getActiveShift(@Query() query: { storeId?: string; store_id?: string }) {
    return this.traceShift('GET /shifts/active', query, async () => {
      const { storeId } = normalizeShiftRequest(query);
      const shifts = await this.posRepository.getActiveShifts(storeId || 'STR-5001');
      return {
        success: true,
        storeId: storeId || 'STR-5001',
        count: shifts.length,
        shifts,
      };
    });
  }

  @Get('shifts/employee/:employeeId')
  async getShiftsByEmployee(
    @Param('employeeId') employeeId: string,
    @Query() query: { storeId?: string; store_id?: string },
  ) {
    return this.traceShift('GET /shifts/employee/:employeeId', { employeeId, ...query }, async () => {
      const id = employeeId.trim();
      if (!UUID_PATTERN.test(id)) {
        throw new BadRequestException('employeeId must be a valid UUID');
      }
      const { storeId } = normalizeShiftRequest(query);
      const shifts = await this.posRepository.getShiftsByEmployee(id, storeId?.trim() || undefined);
      return { success: true, employeeId: id, count: shifts.length, shifts };
    });
  }

  @Get('stores/:store_id/shifts')
  async getShiftsByStore(@Param('store_id') store_id: string) {
    return this.traceShift('GET /stores/:store_id/shifts', { store_id }, async () => {
      const storeId = store_id.trim();
      if (!storeId) throw new BadRequestException('store_id is required');
      const shifts = await this.posRepository.getShiftsByStore(storeId);
      return { success: true, store_id: storeId, count: shifts.length, shifts };
    });
  }

  @Get('stores/:store_id/shifts/:shift_id')
  async getShift(
    @Param('store_id') store_id: string,
    @Param('shift_id') shift_id: string,
  ) {
    return this.traceShift('GET /stores/:store_id/shifts/:shift_id', { store_id, shift_id }, async () => {
      const shift = await this.posRepository.getShiftWithSafeTransactions(shift_id, store_id);
      if (!shift) throw new NotFoundException('POS shift not found');
      return { success: true, shift };
    });
  }

  private async traceShift<T>(action: string, request: unknown, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    shiftDebug('request', { action, ignored_keys: describeUnmappedShiftKeys(request), payload: request });
    try {
      const result = await work();
      shiftDebug('response', { action, ms: Date.now() - started, payload: result });
      return result;
    } catch (error) {
      shiftDebug('error', { action, ms: Date.now() - started, ...shiftErrorDetails(error) });
      throw error;
    }
  }
}
