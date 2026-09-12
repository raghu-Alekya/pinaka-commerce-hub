import { Inject, Controller, Get, Post, Body, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { PosRepository } from './pos.repository';
import { MovementType } from './entities/cash-movement.entity';


@Controller('api/v1/pos')
export class AppController {
  constructor(@Inject(PosRepository) private readonly posRepository: PosRepository) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'pos-integration-service',
      version: '2.0.0 (PCH Module 5)',
      timestamp: new Date().toISOString(),
    };
  }

  // --- 1. Terminal Session Pairing & Entitlement Validation ---
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

  // --- 2. Open Cashier Shift ---
  @Post('shifts/open')
  async openShift(@Body() body: { merchantId: string; storeId: string; terminalId?: string; cashierName: string; openingCash: number }) {
    if (!body.merchantId || !body.storeId || !body.cashierName) {
      throw new BadRequestException('merchantId, storeId, and cashierName are required');
    }
    const shift = await this.posRepository.openShift(body.merchantId, body.storeId, body.terminalId || 'SUNMI-D3-01', body.cashierName, body.openingCash || 200.00);
    return {
      success: true,
      message: 'Cashier shift opened successfully!',
      shiftId: shift.id,
      shift,
    };
  }

  // --- 3. Record Safe Drop / Paid Out ---
  @Post('shifts/cash-movement')
  async recordCashMovement(@Body() body: { shiftId: string; storeId: string; movementType: MovementType; amount: number; performedBy: string; reason?: string }) {
    if (!body.shiftId || !body.storeId || !body.amount) {
      throw new BadRequestException('shiftId, storeId, and amount are required');
    }
    const movement = await this.posRepository.recordCashMovement(body.shiftId, body.storeId, body.movementType || MovementType.SAFE_DROP, body.amount, body.performedBy || 'Manager', body.reason);
    return {
      success: true,
      message: `Cash movement '${movement.movementType}' recorded successfully!`,
      cashMovement: movement,
    };
  }

  // --- 4. Close Shift & Generate Z-Report ---
  @Post('shifts/close')
  async closeShift(@Body() body: { shiftId: string; closingCashActual: number }) {
    if (!body.shiftId || body.closingCashActual === undefined) {
      throw new BadRequestException('shiftId and closingCashActual are required');
    }
    const result = await this.posRepository.closeShift(body.shiftId, Number(body.closingCashActual));
    if (!result.success) {
      throw new NotFoundException(result.message);
    }
    return {
      success: true,
      message: 'Shift closed successfully! Z-Report generated for thermal printing.',
      shift: result.shift,
      reportType: 'Z_REPORT',
    };
  }

  @Get('shifts/active')
  async getActiveShift(@Query('storeId') storeId: string) {
    const shift = await this.posRepository.getActiveShift(storeId || 'STR-5001');
    return {
      success: true,
      storeId: storeId || 'STR-5001',
      shift,
    };
  }
}
