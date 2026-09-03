import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('staff_attendance')
export class StaffAttendanceEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  id!: string; // e.g. "ATT-9001"

  @Column({ type: 'varchar', length: 100 })
  merchantId!: string;

  @Column({ type: 'varchar', length: 100 })
  storeId!: string;

  @Column({ type: 'varchar', length: 100 })
  employeeId!: string;

  @Column({ type: 'varchar', length: 150 })
  employeeName!: string;

  @Column({ type: 'timestamptz' })
  clockInTime!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  clockOutTime?: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  totalHoursWorked!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
