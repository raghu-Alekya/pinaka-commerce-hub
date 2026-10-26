import { BadRequestException, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres, createMissingTables } from '@pinaka-delivery-hub/database';
import { PosShiftEntity, ShiftStatus } from './entities/pos-shift.entity';
import { PosShiftMetaEntity } from './entities/pos-shift-meta.entity';
import { PosShiftTransactionEntity } from './entities/pos-shift-transaction.entity';
import { CashMovementEntity, MovementType } from './entities/cash-movement.entity';
import { ensureShiftSplitSchema } from './shift.schema';
import { ShiftTransactionInput, ShiftView, ShiftWrite, expectedCashInDrawer, roundMoney, toShiftView } from './shift.types';
import { shiftDebug, shiftErrorDetails } from './shift-debug.log';

async function ensurePosShiftSnakeCaseSchema(dataSource: DataSource): Promise<void> {
  try {
    // 1. Create table if not exists with all snake_case columns
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.pos_shifts (
        id VARCHAR(100) PRIMARY KEY,
        merchant_id VARCHAR(100) NOT NULL,
        store_id VARCHAR(100) NOT NULL,
        device_id VARCHAR(100) NOT NULL,
        opening_device_id VARCHAR(100),
        closing_device_id VARCHAR(100),
        created_by VARCHAR(100),
        updated_by VARCHAR(100),
        closed_by VARCHAR(100),
        status VARCHAR(50) DEFAULT 'OPEN',
        opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        closing_balance DECIMAL(12,2),
        over_short DECIMAL(12,2),
        declared_cash DECIMAL(12,2),
        discrepancy DECIMAL(12,2),
        opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Add the master columns. Legacy totals, notes, and denominations are not added back.
    await dataSource.query(`
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS merchant_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS store_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opening_device_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_device_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closed_by VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'OPEN';
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_balance DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS over_short DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS declared_cash DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS discrepancy DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    `);

    await dataSource.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'pos_shifts'
            AND column_name = 'opening_device_id' AND udt_name = 'uuid'
        ) THEN
          ALTER TABLE public.pos_shifts
            ALTER COLUMN opening_device_id TYPE VARCHAR(100) USING opening_device_id::text;
        END IF;
      END $$;
    `);

    // 3. Migrate legacy camelCase column values onto the master columns and drop those camelCase columns
    await dataSource.query(`
      DO $$
      DECLARE
        col RECORD;
      BEGIN
        FOR col IN
          SELECT legacy_col, snake_col, cast_text FROM (VALUES
            ('merchantId', 'merchant_id', false),
            ('storeId', 'store_id', false),
            ('terminalId', 'device_id', false),
            ('terminal_id', 'device_id', false),
            ('openingDeviceId', 'opening_device_id', true),
            ('openedByEmployeeId', 'created_by', true),
            ('closedByEmployeeId', 'closed_by', true),
            ('openingCash', 'opening_balance', false),
            ('closingCashActual', 'closing_balance', false),
            ('declaredCash', 'declared_cash', false),
            ('cashDifference', 'over_short', false),
            ('openedAt', 'opened_at', false),
            ('closedAt', 'closed_at', false),
            ('createdAt', 'created_at', false),
            ('updatedAt', 'updated_at', false)
          ) AS t(legacy_col, snake_col, cast_text)
        LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = col.legacy_col
          ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = col.snake_col
          ) THEN
            IF col.cast_text THEN
              EXECUTE format('UPDATE public.pos_shifts SET %I = %I::text WHERE %I IS NULL AND %I IS NOT NULL', col.snake_col, col.legacy_col, col.snake_col, col.legacy_col);
            ELSE
            EXECUTE format('UPDATE public.pos_shifts SET %I = %I WHERE %I IS NULL AND %I IS NOT NULL', col.snake_col, col.legacy_col, col.snake_col, col.legacy_col);
            END IF;
            IF col.legacy_col <> col.snake_col THEN
              EXECUTE format('ALTER TABLE public.pos_shifts DROP COLUMN IF EXISTS %I', col.legacy_col);
            END IF;
          END IF;
        END LOOP;
      END $$;
    `);

    // 4. Ensure cash_movements table with snake_case columns and drop legacy camelCase columns
    await dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.cash_movements (
        id VARCHAR(100) PRIMARY KEY,
        shift_id VARCHAR(100) NOT NULL,
        store_id VARCHAR(100) NOT NULL,
        movement_type VARCHAR(50) DEFAULT 'SAFE_DROP',
        amount DECIMAL(10,2) NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS shift_id VARCHAR(100);
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS store_id VARCHAR(100);
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS movement_type VARCHAR(50) DEFAULT 'SAFE_DROP';
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS performed_by VARCHAR(255);
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'shiftId') THEN
          UPDATE public.cash_movements SET shift_id = "shiftId" WHERE shift_id IS NULL AND "shiftId" IS NOT NULL;
          ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS "shiftId";
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'storeId') THEN
          UPDATE public.cash_movements SET store_id = "storeId" WHERE store_id IS NULL AND "storeId" IS NOT NULL;
          ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS "storeId";
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'movementType') THEN
          UPDATE public.cash_movements SET movement_type = "movementType" WHERE movement_type IS NULL AND "movementType" IS NOT NULL;
          ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS "movementType";
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'performedBy') THEN
          UPDATE public.cash_movements SET performed_by = "performedBy" WHERE performed_by IS NULL AND "performedBy" IS NOT NULL;
          ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS "performedBy";
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = 'createdAt') THEN
          UPDATE public.cash_movements SET created_at = "createdAt" WHERE created_at IS NULL AND "createdAt" IS NOT NULL;
          ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS "createdAt";
        END IF;
      END $$;
    `);
  } catch (err: any) {
    console.error('⚠️ [pos_shifts schema alignment error]:', err.message);
  }
}

@Injectable()
export class PosRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private shiftRepo?: Repository<PosShiftEntity>;
  private metaRepo?: Repository<PosShiftMetaEntity>;
  private transactionRepo?: Repository<PosShiftTransactionEntity>;
  private movementRepo?: Repository<CashMovementEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private memoryShifts: PosShiftEntity[] = [];
  private memoryMeta: PosShiftMetaEntity[] = [];
  private memoryTransactions: PosShiftTransactionEntity[] = [];
  private inMemoryMovements: CashMovementEntity[] = [];

  async onModuleInit() {
    this.dataSource = await connectPostgres('POS Integration DB', [
      PosShiftEntity,
      PosShiftMetaEntity,
      PosShiftTransactionEntity,
      CashMovementEntity,
    ], { synchronize: false });
    await createMissingTables(this.dataSource);
    await ensurePosShiftSnakeCaseSchema(this.dataSource);
    await ensureShiftSplitSchema(this.dataSource);
    await this.ensureSafeTransactionShiftConstraints();
    this.shiftRepo = this.dataSource.getRepository(PosShiftEntity);
    this.metaRepo = this.dataSource.getRepository(PosShiftMetaEntity);
    this.transactionRepo = this.dataSource.getRepository(PosShiftTransactionEntity);
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

  private async ensureSafeTransactionShiftConstraints() {
    await this.dataSource?.query(`
      DO $$ BEGIN
        IF to_regclass('public.pos_safe_transactions') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pos_safe_transactions_shift_fk'
        ) THEN
          ALTER TABLE public.pos_safe_transactions ADD CONSTRAINT pos_safe_transactions_shift_fk
            FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE RESTRICT;
        END IF;
        IF to_regclass('public.pos_safe_drop_transactions') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pos_safe_drop_transactions_shift_fk'
        ) THEN
          ALTER TABLE public.pos_safe_drop_transactions ADD CONSTRAINT pos_safe_drop_transactions_shift_fk
            FOREIGN KEY (shift_id) REFERENCES public.pos_shifts(id) ON DELETE RESTRICT;
        END IF;
      END $$;
    `);
  }

  async createShift(write: ShiftWrite): Promise<ShiftView> {
    const shift = this.masterFromWrite(write, true);
    const actor = shift.created_by ?? null;
    if (this.isDbConnected && this.dataSource) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        shiftDebug('db', { action: 'createShift', table: 'pos_shifts', op: 'insert', shift_id: shift.id, status: shift.status, opening_balance: shift.opening_balance });
        await runner.manager.getRepository(PosShiftEntity).save(shift);
        await this.writeMeta(runner.manager, shift.id, write.meta);
        await this.writeTransactions(runner.manager, shift.id, write.transactions, actor, 'create');
        await this.attachOrderSales(runner.manager, shift.id, actor);
        await this.applyVariance(runner.manager, shift.id, new Set(write.fields));
        await runner.commitTransaction();
        shiftDebug('db', { action: 'createShift', op: 'commit', shift_id: shift.id });
      } catch (error) {
        shiftDebug('db-rollback', { action: 'createShift', shift_id: shift.id, ...shiftErrorDetails(error) });
        await runner.rollbackTransaction();
        this.rethrowWrite(error);
      } finally {
        await runner.release();
      }
      const view = await this.getShiftView(shift.id);
      if (!view) throw new BadRequestException('Shift could not be read after it was created');
      await this.cacheActiveShift(view.store_id, view);
      return view;
    }

    shiftDebug('db-skip', { action: 'createShift', shift_id: shift.id, reason: 'database is not connected; shift kept in memory only' });
    this.memoryShifts.unshift(shift);
    this.memoryMeta.unshift(...this.metaRows(shift.id, write.meta));
    this.memoryTransactions.unshift(...this.transactionRows(shift.id, write.transactions, actor, 'create'));
    this.applyMemoryVariance(shift, new Set(write.fields));
    const view = await this.getShiftView(shift.id);
    if (!view) throw new BadRequestException('Shift could not be read after it was created');
    await this.cacheActiveShift(view.store_id, view);
    return view;
  }

  async updateShift(shiftId: string, write: ShiftWrite): Promise<ShiftView | null> {
    const actor = write.master.updated_by ?? write.master.closed_by ?? write.master.created_by ?? null;
    if (this.isDbConnected && this.dataSource) {
      const runner = this.dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const shift = await runner.manager.getRepository(PosShiftEntity).findOne({
          where: { id: shiftId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!shift) {
          shiftDebug('db-skip', { action: 'updateShift', shift_id: shiftId, reason: 'pos_shifts row not found' });
          await runner.rollbackTransaction();
          return null;
        }
        this.applyMasterPatch(shift, write);
        shiftDebug('db', { action: 'updateShift', table: 'pos_shifts', op: 'update', shift_id: shift.id, fields: write.fields, status: shift.status });
        await runner.manager.getRepository(PosShiftEntity).save(shift);
        await this.writeMeta(runner.manager, shift.id, write.meta);
        await this.writeTransactions(runner.manager, shift.id, write.transactions, actor ?? shift.updated_by ?? shift.created_by ?? null, 'update');
        await this.attachOrderSales(runner.manager, shift.id, actor ?? shift.created_by ?? null);
        await this.applyVariance(runner.manager, shift.id, new Set(write.fields));
        await runner.commitTransaction();
        shiftDebug('db', { action: 'updateShift', op: 'commit', shift_id: shift.id });
      } catch (error) {
        shiftDebug('db-rollback', { action: 'updateShift', shift_id: shiftId, ...shiftErrorDetails(error) });
        await runner.rollbackTransaction();
        this.rethrowWrite(error);
      } finally {
        await runner.release();
      }
      const view = await this.getShiftView(shiftId);
      if (view) await this.cacheActiveShift(view.store_id, view);
      return view;
    }

    shiftDebug('db-skip', { action: 'updateShift', shift_id: shiftId, reason: 'database is not connected; shift kept in memory only' });
    const shift = this.memoryShifts.find((row) => row.id === shiftId);
    if (!shift) return null;
    this.applyMasterPatch(shift, write);
    for (const row of this.metaRows(shift.id, write.meta)) {
      const existing = this.memoryMeta.find((meta) => meta.shift_id === shift.id && meta.meta_name === row.meta_name);
      if (existing) {
        existing.meta_value = row.meta_value;
        existing.status = row.status;
    } else {
        this.memoryMeta.push(row);
      }
    }
    this.memoryTransactions.push(...this.transactionRows(shift.id, write.transactions, actor ?? shift.created_by ?? null, 'update'));
    this.applyMemoryVariance(shift, new Set(write.fields));
    const view = await this.getShiftView(shift.id);
    if (view) await this.cacheActiveShift(view.store_id, view);
    return view;
  }

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
    const transaction: ShiftTransactionInput = {
      transaction_type: movementType,
      total_sum: Number(amount),
      json_payload: {
        source: 'cash_movement',
        movement_id: movement.id,
        store_id: storeId,
        reason: movement.reason,
        performed_by: movement.performedBy,
      },
      status: 'ACTIVE',
      created_by: movement.performedBy,
    };

    if (this.isDbConnected && this.movementRepo && this.dataSource) {
      const saved = await this.movementRepo.save(this.movementRepo.create(movement));
      const shift = await this.shiftRepo?.findOne({ where: { id: shiftId } });
      if (shift) {
        await this.dataSource.transaction(async (manager) => {
          await this.writeTransactions(manager, shiftId, [transaction], movement.performedBy, 'create');
        });
        const view = await this.getShiftView(shiftId);
        if (view) await this.cacheActiveShift(storeId, view);
      } else {
        shiftDebug('db-skip', {
          action: 'recordCashMovement',
          shift_id: shiftId,
          movement_id: saved.id,
          reason: 'cash_movements row saved, but pos_shift_transactions was not written because the shift id was not found',
        });
      }
      return saved;
    }

    this.inMemoryMovements.unshift(movement);
    if (this.memoryShifts.some((shift) => shift.id === shiftId)) {
      this.memoryTransactions.unshift(...this.transactionRows(shiftId, [transaction], movement.performedBy, 'create'));
    }
    return movement;
  }

  async getActiveShifts(storeId: string): Promise<ShiftView[]> {
    if (this.isDbConnected && this.shiftRepo) {
      const shifts = await this.shiftRepo.find({
        where: { store_id: storeId, status: ShiftStatus.OPEN },
        order: { opened_at: 'DESC', created_at: 'DESC' },
      });
      return this.viewsFor(shifts);
    }
    return this.viewsFor(this.memoryShifts
      .filter((shift) => shift.store_id === storeId && shift.status === ShiftStatus.OPEN)
      .sort((left, right) => right.opened_at.getTime() - left.opened_at.getTime()));
  }

  async getShiftsByStore(storeId: string): Promise<ShiftView[]> {
    if (this.isDbConnected && this.shiftRepo) {
      const shifts = await this.shiftRepo.find({
        where: { store_id: storeId },
        order: { opened_at: 'DESC', created_at: 'DESC' },
      });
      return this.viewsFor(shifts);
    }
    return this.viewsFor(this.memoryShifts
      .filter((shift) => shift.store_id === storeId)
      .sort((left, right) => right.opened_at.getTime() - left.opened_at.getTime()));
  }

  async getShiftsByEmployee(employeeId: string, storeId?: string): Promise<ShiftView[]> {
    if (this.isDbConnected && this.shiftRepo) {
      const query = this.shiftRepo.createQueryBuilder('shift')
        .where('lower(shift.created_by) = lower(:employeeId)', { employeeId })
        .orderBy('shift.opened_at', 'DESC')
        .addOrderBy('shift.created_at', 'DESC');
      if (storeId) query.andWhere('shift.store_id = :storeId', { storeId });
      return this.viewsFor(await query.getMany());
    }
    return this.viewsFor(this.memoryShifts
      .filter((shift) => shift.created_by?.toLowerCase() === employeeId.toLowerCase() && (!storeId || shift.store_id === storeId))
      .sort((left, right) => right.opened_at.getTime() - left.opened_at.getTime()));
  }

  async getShiftView(shiftId: string, storeId?: string): Promise<ShiftView | null> {
    if (this.isDbConnected && this.shiftRepo) {
      const shift = await this.shiftRepo.findOne({
        where: { id: shiftId, ...(storeId ? { store_id: storeId } : {}) },
      });
      if (!shift) return null;
      const [view] = await this.viewsFor([shift]);
      return view ?? null;
    }
    const shift = this.memoryShifts.find((row) => row.id === shiftId && (!storeId || row.store_id === storeId));
    if (!shift) return null;
    const [view] = await this.viewsFor([shift]);
    return view ?? null;
  }

  requireDataSource(): DataSource {
    if (!this.isDbConnected || !this.dataSource) {
      throw new ServiceUnavailableException('POS database is unavailable');
    }
    return this.dataSource;
  }

  async getShiftWithSafeTransactions(shiftId: string, storeId: string) {
    const shift = await this.getShiftView(shiftId, storeId);
    if (!shift || !this.dataSource) return shift;
    const safes = await this.dataSource.query(
      `SELECT id AS safe_id, title, created_at, safe_data, shift_id, created_by
       FROM public.pos_safe_transactions WHERE shift_id = $1 ORDER BY created_at DESC, id DESC`,
      [shiftId],
    );
    const safe_drops = await this.dataSource.query(
      `SELECT id AS safe_drop_id, title, created_at, safe_data, shift_id, created_by
       FROM public.pos_safe_drop_transactions WHERE shift_id = $1 ORDER BY created_at DESC, id DESC`,
      [shiftId],
    );
    return { ...shift, safes, safe_drops };
  }

  // Cash/card sales per shift from store_orders (order-service, same database),
  // matched on the PCH shift id the POS app sends in order meta_data.shift_id.
  // Split tenders come from meta_data._pos_payments; otherwise the order's
  // payment_method decides. Anything that is not cash counts as card.
  private async getSalesByShift(shiftIds: string[]): Promise<Map<string, { cash: number; card: number }>> {
    const sales = new Map<string, { cash: number; card: number }>();
    if (!this.dataSource || shiftIds.length === 0) return sales;
    try {
      const rows: Array<{ shift_id: string; cash: string; card: string }> = await this.dataSource.query(
        `WITH shift_orders AS (
           SELECT so.shift_id, so.total, lower(coalesce(so.payment_method, '')) AS method,
                  (SELECT e->'value'
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(so.meta_data) = 'array' THEN so.meta_data ELSE '[]'::jsonb END) e
                    WHERE e->>'key' = '_pos_payments' LIMIT 1) AS split
             FROM public.store_orders so
            WHERE so.shift_id = ANY($1)
              AND lower(so.status) IN ('completed', 'processing')
              AND NOT so.pay_later
         ),
         tenders AS (
           SELECT shift_id, lower(coalesce(p->>'method', '')) AS method, (p->>'amount')::numeric AS amount
             FROM shift_orders,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(split) = 'array' THEN split ELSE '[]'::jsonb END) p
            WHERE lower(coalesce(p->>'status', 'completed')) = 'completed'
           UNION ALL
           SELECT shift_id, method, total
             FROM shift_orders
            WHERE jsonb_array_length(CASE WHEN jsonb_typeof(split) = 'array' THEN split ELSE '[]'::jsonb END) = 0
         )
         SELECT shift_id,
                coalesce(sum(amount) FILTER (WHERE method = 'cash'), 0) AS cash,
                coalesce(sum(amount) FILTER (WHERE method <> 'cash'), 0) AS card
           FROM tenders
          GROUP BY shift_id`,
        [shiftIds],
      );
      for (const row of rows) {
        sales.set(row.shift_id, { cash: Number(row.cash), card: Number(row.card) });
      }
    } catch (error) {
      console.error('[POS] Could not total shift sales from store_orders:', error);
    }
    return sales;
  }

  private async viewsFor(shifts: PosShiftEntity[]): Promise<ShiftView[]> {
    if (!shifts.length) return [];
    const ids = shifts.map((shift) => shift.id);
    let meta: PosShiftMetaEntity[] = [];
    let transactions: PosShiftTransactionEntity[] = [];
    if (this.isDbConnected && this.metaRepo && this.transactionRepo) {
      meta = await this.metaRepo.find({ where: { shift_id: In(ids) }, order: { meta_name: 'ASC' } });
      transactions = await this.transactionRepo.find({ where: { shift_id: In(ids) }, order: { created_at: 'ASC' } });
    } else {
      meta = this.memoryMeta
        .filter((row) => ids.includes(row.shift_id))
        .sort((left, right) => left.meta_name.localeCompare(right.meta_name));
      transactions = this.memoryTransactions
        .filter((row) => ids.includes(row.shift_id))
        .sort((left, right) => left.created_at.getTime() - right.created_at.getTime());
    }
    const sales = this.isDbConnected ? await this.getSalesByShift(ids) : new Map<string, { cash: number; card: number }>();
    return shifts.map((shift) => toShiftView(
      shift,
      meta.filter((row) => row.shift_id === shift.id).map((row) => ({
        id: row.id,
        shift_id: row.shift_id,
        meta_name: row.meta_name,
        meta_value: row.meta_value,
        status: row.status,
      })),
      transactions.filter((row) => row.shift_id === shift.id).map((row) => ({
        id: row.id,
        shift_id: row.shift_id,
        transaction_type: row.transaction_type,
        total_sum: Number(row.total_sum),
        json_payload: row.json_payload,
        status: row.status,
        created_by: row.created_by ?? null,
        updated_by: row.updated_by ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })),
      sales.get(shift.id),
    ));
  }

  private masterFromWrite(write: ShiftWrite, creating: boolean): PosShiftEntity {
    const now = new Date();
    const status = write.master.status ?? ShiftStatus.OPEN;
    return {
      id: write.shiftId || `SHIFT-${randomUUID()}`,
      merchant_id: write.master.merchant_id || '',
      store_id: write.master.store_id || '',
      device_id: write.master.device_id || 'SUNMI-D3-01',
      opening_device_id: write.master.opening_device_id ?? null,
      closing_device_id: write.master.closing_device_id ?? null,
      created_by: write.master.created_by ?? null,
      updated_by: write.master.updated_by ?? null,
      closed_by: write.master.closed_by ?? null,
      status,
      opening_balance: write.master.opening_balance ?? 200,
      closing_balance: write.master.closing_balance ?? null,
      over_short: write.master.over_short ?? null,
      declared_cash: write.master.declared_cash ?? null,
      discrepancy: write.master.discrepancy ?? null,
      opened_at: write.master.opened_at ?? now,
      closed_at: write.fields.includes('closed_at')
        ? write.master.closed_at ?? null
        : (creating && status === ShiftStatus.CLOSED ? now : null),
      created_at: now,
      updated_at: now,
    };
  }

  private applyMasterPatch(shift: PosShiftEntity, write: ShiftWrite): void {
    if (write.fields.includes('merchant_id')) {
      if (!write.master.merchant_id) throw new BadRequestException('merchant_id is required');
      if (write.master.merchant_id !== shift.merchant_id) {
        throw new BadRequestException('merchant_id does not match this shift');
      }
    }
    if (write.fields.includes('store_id')) {
      if (!write.master.store_id) throw new BadRequestException('store_id is required');
      if (write.master.store_id !== shift.store_id) {
        throw new BadRequestException('store_id does not match this shift');
      }
    }
    if (write.fields.includes('device_id')) {
      if (!write.master.device_id) throw new BadRequestException('device_id is required');
      shift.device_id = write.master.device_id;
    }
    if (write.fields.includes('opening_device_id')) shift.opening_device_id = write.master.opening_device_id ?? null;
    if (write.fields.includes('closing_device_id')) shift.closing_device_id = write.master.closing_device_id ?? null;
    if (write.fields.includes('created_by')) shift.created_by = write.master.created_by ?? null;
    if (write.fields.includes('updated_by')) shift.updated_by = write.master.updated_by ?? null;
    if (write.fields.includes('closed_by')) shift.closed_by = write.master.closed_by ?? null;
    if (write.fields.includes('status') && write.master.status) shift.status = write.master.status;
    if (write.fields.includes('opening_balance') && write.master.opening_balance !== undefined) {
      shift.opening_balance = write.master.opening_balance;
    }
    if (write.fields.includes('closing_balance')) shift.closing_balance = write.master.closing_balance ?? null;
    if (write.fields.includes('over_short')) shift.over_short = write.master.over_short ?? null;
    if (write.fields.includes('declared_cash')) shift.declared_cash = write.master.declared_cash ?? null;
    if (write.fields.includes('discrepancy')) shift.discrepancy = write.master.discrepancy ?? null;
    if (write.fields.includes('opened_at') && write.master.opened_at) shift.opened_at = write.master.opened_at;
    if (write.fields.includes('closed_at')) shift.closed_at = write.master.closed_at ?? null;
    if (shift.status === ShiftStatus.CLOSED && !write.fields.includes('closed_at') && !shift.closed_at) {
      shift.closed_at = new Date();
    }
    shift.updated_at = new Date();
  }

  private async writeMeta(manager: EntityManager, shiftId: string, rows: ShiftWrite['meta']): Promise<void> {
    for (const row of rows) {
      await manager.query(
        `INSERT INTO public.pos_shift_meta (id, shift_id, meta_name, meta_value, status)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (shift_id, meta_name) DO UPDATE
         SET meta_value = EXCLUDED.meta_value, status = EXCLUDED.status`,
        [randomUUID(), shiftId, row.meta_name, JSON.stringify(row.meta_value), row.status],
      );
      shiftDebug('db', { table: 'pos_shift_meta', op: 'upsert', shift_id: shiftId, meta_name: row.meta_name, status: row.status, meta_value: row.meta_value });
    }
  }

  private async writeTransactions(
    manager: EntityManager,
    shiftId: string,
    rows: ShiftTransactionInput[],
    actor: string | null,
    mode: 'create' | 'update',
  ): Promise<void> {
    for (const row of rows) {
      const payload = JSON.stringify(row.json_payload ?? {});
      const createdBy = row.created_by ?? actor;
      const updatedBy = row.updated_by ?? actor;
      if (row.upsert_by_type) {
        await manager.query(
          `WITH updated AS (
             UPDATE public.pos_shift_transactions
             SET total_sum = $3, json_payload = $4::jsonb, status = $5, updated_by = $6, updated_at = CURRENT_TIMESTAMP
             WHERE id = (
               SELECT id FROM public.pos_shift_transactions
               WHERE shift_id = $1 AND transaction_type = $2
               ORDER BY created_at ASC, id ASC
               LIMIT 1
             )
             RETURNING id
           )
           INSERT INTO public.pos_shift_transactions (
             id, shift_id, transaction_type, total_sum, json_payload, status, created_by, updated_by
           )
           SELECT $7, $1, $2, $3, $4::jsonb, $5, $8, $6
           WHERE NOT EXISTS (SELECT 1 FROM updated)`,
          [shiftId, row.transaction_type, row.total_sum, payload, row.status, updatedBy, randomUUID(), createdBy],
        );
        shiftDebug('db', { table: 'pos_shift_transactions', op: 'upsert', shift_id: shiftId, transaction_type: row.transaction_type, total_sum: row.total_sum, json_payload: row.json_payload });
        continue;
      }
      if (row.id && mode === 'update') {
        const updated: Array<{ id: string }> = await manager.query(
          `UPDATE public.pos_shift_transactions
           SET transaction_type = $3, total_sum = $4, json_payload = $5::jsonb, status = $6,
               updated_by = $7, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND shift_id = $2
           RETURNING id`,
          [row.id, shiftId, row.transaction_type, row.total_sum, payload, row.status, updatedBy],
        );
        if (!updated.length) throw new BadRequestException(`Transaction '${row.id}' was not found on this shift`);
        shiftDebug('db', { table: 'pos_shift_transactions', op: 'update', shift_id: shiftId, id: row.id, transaction_type: row.transaction_type, total_sum: row.total_sum, json_payload: row.json_payload });
        continue;
      }
      const insertedId = row.id ?? randomUUID();
      await manager.query(
        `INSERT INTO public.pos_shift_transactions (
           id, shift_id, transaction_type, total_sum, json_payload, status, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [insertedId, shiftId, row.transaction_type, row.total_sum, payload, row.status, createdBy, updatedBy],
      );
      shiftDebug('db', { table: 'pos_shift_transactions', op: 'insert', shift_id: shiftId, id: insertedId, transaction_type: row.transaction_type, total_sum: row.total_sum, json_payload: row.json_payload });
    }
  }

  private async attachOrderSales(manager: EntityManager, shiftId: string, actor: string | null): Promise<void> {
    const shift = await manager.getRepository(PosShiftEntity).findOne({ where: { id: shiftId } });
    if (!shift || shift.status !== ShiftStatus.CLOSED) return;
    const existing: Array<{ transaction_type: string }> = await manager.query(
      `SELECT DISTINCT transaction_type FROM public.pos_shift_transactions
       WHERE shift_id = $1 AND status = 'ACTIVE' AND transaction_type = ANY($2)`,
      [shiftId, ['CASH_SALE', 'CARD_SALE']],
    );
    const have = new Set(existing.map((row) => row.transaction_type));
    const sales = (await this.getSalesByShift([shiftId])).get(shiftId);
    if (!sales) {
      shiftDebug('db-skip', { action: 'attachOrderSales', shift_id: shiftId, reason: 'no completed store_orders for this shift; CASH_SALE and CARD_SALE were not written' });
      return;
    }
    const rows: ShiftTransactionInput[] = [];
    if (!have.has('CASH_SALE') && sales.cash > 0) {
      rows.push({
        transaction_type: 'CASH_SALE',
        total_sum: sales.cash,
        json_payload: { source: 'store_orders' },
        status: 'ACTIVE',
        upsert_by_type: true,
      });
    }
    if (!have.has('CARD_SALE') && sales.card > 0) {
      rows.push({
        transaction_type: 'CARD_SALE',
        total_sum: sales.card,
        json_payload: { source: 'store_orders' },
        status: 'ACTIVE',
        upsert_by_type: true,
      });
    }
    shiftDebug('db', {
      action: 'attachOrderSales',
      shift_id: shiftId,
      cash: sales?.cash ?? null,
      card: sales?.card ?? null,
      wrote: rows.map((row) => row.transaction_type),
    });
    if (rows.length) await this.writeTransactions(manager, shiftId, rows, actor, 'update');
  }

  private async applyVariance(manager: EntityManager, shiftId: string, provided: Set<string>): Promise<void> {
    const shift = await manager.getRepository(PosShiftEntity).findOne({ where: { id: shiftId } });
    if (!shift || shift.status !== ShiftStatus.CLOSED || shift.closing_balance == null) return;
    const transactions = await manager.getRepository(PosShiftTransactionEntity).find({ where: { shift_id: shiftId } });
    const expected = expectedCashInDrawer(Number(shift.opening_balance), transactions);
    let changed = false;
    if (!provided.has('over_short')) {
      shift.over_short = roundMoney(Number(shift.closing_balance) - expected);
      changed = true;
    }
    if (!provided.has('discrepancy')) {
      const baseline = shift.declared_cash == null ? Number(shift.closing_balance) : Number(shift.declared_cash);
      shift.discrepancy = roundMoney(baseline - expected);
      changed = true;
    }
    if (!provided.has('closed_at') && !shift.closed_at) {
      shift.closed_at = new Date();
      changed = true;
    }
    if (changed) await manager.getRepository(PosShiftEntity).save(shift);
  }

  private applyMemoryVariance(shift: PosShiftEntity, provided: Set<string>): void {
    if (shift.status !== ShiftStatus.CLOSED || shift.closing_balance == null) return;
    const transactions = this.memoryTransactions.filter((row) => row.shift_id === shift.id);
    const expected = expectedCashInDrawer(Number(shift.opening_balance), transactions);
    if (!provided.has('over_short')) shift.over_short = roundMoney(Number(shift.closing_balance) - expected);
    if (!provided.has('discrepancy')) {
      const baseline = shift.declared_cash == null ? Number(shift.closing_balance) : Number(shift.declared_cash);
      shift.discrepancy = roundMoney(baseline - expected);
    }
    if (!provided.has('closed_at') && !shift.closed_at) shift.closed_at = new Date();
  }

  private metaRows(shiftId: string, rows: ShiftWrite['meta']): PosShiftMetaEntity[] {
    return rows.map((row) => ({
      id: randomUUID(),
      shift_id: shiftId,
      meta_name: row.meta_name,
      meta_value: row.meta_value,
      status: row.status,
    }));
  }

  private transactionRows(
    shiftId: string,
    rows: ShiftTransactionInput[],
    actor: string | null,
    mode: 'create' | 'update',
  ): PosShiftTransactionEntity[] {
    const now = new Date();
    const created: PosShiftTransactionEntity[] = [];
    for (const row of rows) {
      if (row.upsert_by_type) {
        const existing = this.memoryTransactions.find((item) => item.shift_id === shiftId && item.transaction_type === row.transaction_type);
        if (existing) {
          existing.total_sum = row.total_sum;
          existing.json_payload = row.json_payload;
          existing.status = row.status;
          existing.updated_by = row.updated_by ?? actor;
          existing.updated_at = now;
          continue;
        }
      }
      if (row.id && mode === 'update') {
        const existing = this.memoryTransactions.find((item) => item.id === row.id && item.shift_id === shiftId);
        if (!existing) throw new BadRequestException(`Transaction '${row.id}' was not found on this shift`);
        existing.transaction_type = row.transaction_type;
        existing.total_sum = row.total_sum;
        existing.json_payload = row.json_payload;
        existing.status = row.status;
        existing.updated_by = row.updated_by ?? actor;
        existing.updated_at = now;
        continue;
      }
      created.push({
        id: row.id ?? randomUUID(),
        shift_id: shiftId,
        transaction_type: row.transaction_type,
        total_sum: row.total_sum,
        json_payload: row.json_payload ?? {},
        status: row.status,
        created_by: row.created_by ?? actor,
        updated_by: row.updated_by ?? actor,
        created_at: now,
        updated_at: now,
      });
    }
    return created;
  }

  private rethrowWrite(error: unknown): never {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
    if (code === '23505') {
      throw new BadRequestException('Shift id, meta name, or transaction id already exists');
    }
    throw error;
  }

  private async cacheActiveShift(storeId: string, shift: ShiftView) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        if (shift.status === ShiftStatus.OPEN) {
        await this.redisClient.set(`shift:${storeId}`, JSON.stringify(shift), 'EX', 86400);
        } else {
          await this.redisClient.del(`shift:${storeId}`);
        }
      } catch {}
    }
  }
}
