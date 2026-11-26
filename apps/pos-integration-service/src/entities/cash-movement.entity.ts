import type { DataSource } from 'typeorm';

export enum MovementType {
  SAFE_DROP = 'SAFE_DROP',
  PAID_IN = 'PAID_IN',
  PAID_OUT = 'PAID_OUT',
}

export class CashMovementEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.cash_movements RESTRICT');
  }


  id!: string;

  shiftId!: string;

  storeId!: string;

  movementType!: MovementType;

  amount!: number;

  performedBy!: string; // Cashier / Manager

  reason?: string;

  createdAt!: Date;
}
