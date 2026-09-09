import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { PosShiftEntity, ShiftStatus } from './entities/pos-shift.entity';
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
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_commerce_hub',
        entities: [PosShiftEntity, CashMovementEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.shiftRepo = this.dataSource.getRepository(PosShiftEntity);
      this.movementRepo = this.dataSource.getRepository(CashMovementEntity);
      this.isDbConnected = true;
      console.log('🐘 [POS Integration DB] Connected to PostgreSQL Database');
    } catch (err: any) {
      console.log(`⚠️ [POS Integration DB] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
    }

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
  async openShift(merchantId: string, storeId: string, terminalId: string, cashierName: string, openingCash: number): Promise<PosShiftEntity> {
    const shift: PosShiftEntity = {
      id: `SHIFT-${Math.floor(8000 + Math.random() * 1000)}`,
      merchantId,
      storeId,
      terminalId: terminalId || 'SUNMI-D3-01',
      cashierName: cashierName || 'Cashier',
      openingCash: Number(openingCash) || 200.00,
      totalCashSales: 0.00,
      totalCardSales: 0.00,
      totalSafeDrops: 0.00,
      totalPaidOuts: 0.00,
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

  async getActiveShift(storeId: string): Promise<PosShiftEntity | null> {
    if (this.isDbConnected && this.shiftRepo) {
      return await this.shiftRepo.findOne({ where: { storeId, status: ShiftStatus.OPEN } });
    }
    return this.inMemoryShifts.find((s) => s.storeId === storeId && s.status === ShiftStatus.OPEN) || null;
  }

  private async cacheActiveShift(storeId: string, shift: PosShiftEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`shift:${storeId}`, JSON.stringify(shift), 'EX', 86400);
      } catch {}
    }
  }
}
