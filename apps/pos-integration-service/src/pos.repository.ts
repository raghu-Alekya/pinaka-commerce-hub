import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres, createMissingTables } from '@pinaka-delivery-hub/database';
import { PosShiftEntity, ShiftDenominationData, ShiftStatus } from './entities/pos-shift.entity';
import { CashMovementEntity, MovementType } from './entities/cash-movement.entity';

@Injectable()
export class PosRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private shiftRepo?: Repository<PosShiftEntity>;
  private movementRepo?: Repository<CashMovementEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private inMemoryShifts: PosShiftEntity[] = [];
  private inMemoryMovements: CashMovementEntity[] = [];

  async onModuleInit() {
    this.dataSource = await connectPostgres('POS Integration DB', [
      PosShiftEntity,
      CashMovementEntity,
    ], { synchronize: false });
    await createMissingTables(this.dataSource);
    this.shiftRepo = this.dataSource.getRepository(PosShiftEntity);
    this.movementRepo = this.dataSource.getRepository(CashMovementEntity);
    this.isDbConnected = true;

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [POS Integration Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [POS Integration Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  // --- Open Cashier Shift ---
  async openShift(
    merchantId: string,
    storeId: string,
    terminalId: string,
    cashierName: string,
    openingCash: number,
    registerId?: string,
    denominationData: ShiftDenominationData = {},
  ): Promise<PosShiftEntity> {
    const shift: PosShiftEntity = {
      id: `SHIFT-${randomUUID()}`,
      merchantId,
      storeId,
      registerId,
      terminalId: terminalId || 'SUNMI-D3-01',
      cashierName: cashierName || 'Cashier',
      openingCash: Number(openingCash),
      totalCashSales: 0.00,
      totalCardSales: 0.00,
      totalSafeDrops: 0.00,
      totalPaidOuts: 0.00,
      ...denominationData,
      status: ShiftStatus.OPEN,
      openedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.isDbConnected && this.shiftRepo) {
      const entity = this.shiftRepo.create(shift);
      const saved = await this.shiftRepo.save(entity);
      await this.cacheActiveShift(storeId, saved);
      return saved;
    } else {
      this.inMemoryShifts.unshift(shift);
      await this.cacheActiveShift(storeId, shift);
      return shift;
    }
  }

  // --- Record Safe Drop / Cash Movement ---
  async recordCashMovement(shiftId: string, storeId: string, movementType: MovementType, amount: number, performedBy: string, reason?: string): Promise<CashMovementEntity> {
    const movement: CashMovementEntity = {
      id: `CSH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      shiftId,
      storeId,
      movementType,
      amount: Number(amount),
      performedBy: performedBy || 'Manager',
      reason: reason || 'Cash Drawer Management',
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.movementRepo && this.shiftRepo) {
      const entity = this.movementRepo.create(movement);
      const saved = await this.movementRepo.save(entity);

      const shift = await this.shiftRepo.findOne({ where: { id: shiftId } });
      if (shift) {
        if (movementType === MovementType.SAFE_DROP) shift.totalSafeDrops = Number(shift.totalSafeDrops) + Number(amount);
        if (movementType === MovementType.PAID_OUT) shift.totalPaidOuts = Number(shift.totalPaidOuts) + Number(amount);
        await this.shiftRepo.save(shift);
        await this.cacheActiveShift(storeId, shift);
      }
      return saved;
    } else {
      this.inMemoryMovements.unshift(movement);
      const shift = this.inMemoryShifts.find((s) => s.id === shiftId);
      if (shift) {
        if (movementType === MovementType.SAFE_DROP) shift.totalSafeDrops = Number(shift.totalSafeDrops) + Number(amount);
        if (movementType === MovementType.PAID_OUT) shift.totalPaidOuts = Number(shift.totalPaidOuts) + Number(amount);
      }
      return movement;
    }
  }

  // --- Close Shift & Generate Z-Report ---
  async closeShift(shiftId: string, closingCashActual: number): Promise<{ success: boolean; shift?: PosShiftEntity; message?: string }> {
    let shift: PosShiftEntity | null = null;

    if (this.isDbConnected && this.shiftRepo) {
      shift = await this.shiftRepo.findOne({ where: { id: shiftId } });
      if (shift) {
        const expected = Number(shift.openingCash) + Number(shift.totalCashSales) - Number(shift.totalSafeDrops) - Number(shift.totalPaidOuts);
        shift.closingCashActual = Number(closingCashActual);
        shift.expectedCashInDrawer = expected;
        shift.discrepancy = Number(closingCashActual) - expected;
        shift.status = ShiftStatus.CLOSED;
        shift.closedAt = new Date();
        shift = await this.shiftRepo.save(shift);
      }
    } else {
      shift = this.inMemoryShifts.find((s) => s.id === shiftId) || null;
      if (shift) {
        const expected = Number(shift.openingCash) + Number(shift.totalCashSales) - Number(shift.totalSafeDrops) - Number(shift.totalPaidOuts);
        shift.closingCashActual = Number(closingCashActual);
        shift.expectedCashInDrawer = expected;
        shift.discrepancy = Number(closingCashActual) - expected;
        shift.status = ShiftStatus.CLOSED;
        shift.closedAt = new Date();
      }
    }

    if (!shift) {
      return { success: false, message: `Shift '${shiftId}' not found` };
    }

    return { success: true, shift };
  }

  async getActiveShifts(storeId: string): Promise<PosShiftEntity[]> {
    if (this.isDbConnected && this.shiftRepo) {
      return await this.shiftRepo.find({
        where: { storeId, status: ShiftStatus.OPEN },
        order: { openedAt: 'DESC', createdAt: 'DESC' },
      });
    }
    return this.inMemoryShifts
      .filter((shift) => shift.storeId === storeId && shift.status === ShiftStatus.OPEN)
      .sort((left, right) => right.openedAt.getTime() - left.openedAt.getTime());
  }

  private async cacheActiveShift(storeId: string, shift: PosShiftEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`shift:${storeId}`, JSON.stringify(shift), 'EX', 86400);
      } catch {}
    }
  }
}
