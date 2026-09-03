import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum StaffRole {
  STORE_MANAGER = 'STORE_MANAGER',
  CASHIER = 'CASHIER',
  KITCHEN_STAFF = 'KITCHEN_STAFF',
  INVENTORY_CLERK = 'INVENTORY_CLERK',
}

@Entity('staff_employees')
export class StaffEmployeeEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "EMP-101"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 50 })
  employeeCode!: string;

  @Column({ type: 'varchar', length: 150 })
  fullName!: string;

  @Column({ type: 'varchar', length: 50, default: StaffRole.CASHIER })
  role!: StaffRole;

  @Column({ type: 'varchar', length: 10 })
  pinCode!: string; // 4-digit PIN for Sunmi POS login (e.g. "1234")

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 18.50 })
  hourlyRate!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
