import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { StaffEmployeeEntity, StaffRole } from './entities/staff-employee.entity';
import { StaffAttendanceEntity } from './entities/staff-attendance.entity';

@Injectable()
export class StaffRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private empRepo?: Repository<StaffEmployeeEntity>;
  private attRepo?: Repository<StaffAttendanceEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  public isRedisConnected = false;

  private inMemoryEmps: StaffEmployeeEntity[] = [];
  private inMemoryAtts: StaffAttendanceEntity[] = [];

  async onModuleInit() {
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [StaffEmployeeEntity, StaffAttendanceEntity],
        synchronize: true,
      });

      await this.dataSource.initialize();
      this.empRepo = this.dataSource.getRepository(StaffEmployeeEntity);
      this.attRepo = this.dataSource.getRepository(StaffAttendanceEntity);
      this.isDbConnected = true;
      console.log('🐘 [Staff Service DB] Connected to PostgreSQL Database');
      await this.seedDefaultStaff();
    } catch (err: any) {
      console.log(`⚠️ [Staff Service DB] Offline (${err.message}). Using In-Memory fallback.`);
      this.isDbConnected = false;
      this.seedInMemory();
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
      console.log('⚡ [Staff Service Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [Staff Service Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultStaff() {
    if (this.empRepo) {
      const existing = await this.empRepo.findOne({ where: { employeeCode: 'EMP-101' } });
      if (!existing) {
        const emps = [
          {
            id: 'EMP-101',
            merchantId: 'MCH-1001',
            storeId: 'STR-5001',
            employeeCode: 'EMP-101',
            fullName: 'Sarah Jenkins',
            role: StaffRole.CASHIER,
            pinCode: '1234',
            hourlyRate: 18.50,
            isActive: true,
          },
          {
            id: 'EMP-102',
            merchantId: 'MCH-1001',
            storeId: 'STR-5001',
            employeeCode: 'EMP-102',
            fullName: 'Alex Rodriguez',
            role: StaffRole.STORE_MANAGER,
            pinCode: '9999',
            hourlyRate: 28.00,
            isActive: true,
          },
        ];

        for (const emp of emps) {
          const entity = this.empRepo.create(emp);
          await this.empRepo.save(entity);
        }
        console.log('👥 [Staff Service] Seeded default employee roster for STR-5001');
      }
    }
  }

  private seedInMemory() {
    if (this.inMemoryEmps.length === 0) {
      this.inMemoryEmps.push(
        {
          id: 'EMP-101',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          employeeCode: 'EMP-101',
          fullName: 'Sarah Jenkins',
          role: StaffRole.CASHIER,
          pinCode: '1234',
          hourlyRate: 18.50,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'EMP-102',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          employeeCode: 'EMP-102',
          fullName: 'Alex Rodriguez',
          role: StaffRole.STORE_MANAGER,
          pinCode: '9999',
          hourlyRate: 28.00,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );
    }
  }

  async verifyPin(storeId: string, pinCode: string): Promise<StaffEmployeeEntity | null> {
    if (this.isDbConnected && this.empRepo) {
      return await this.empRepo.findOne({ where: { storeId, pinCode, isActive: true } });
    }
    return this.inMemoryEmps.find((e) => e.storeId === storeId && e.pinCode === pinCode && e.isActive) || null;
  }

  async clockIn(merchantId: string, storeId: string, employeeId: string): Promise<StaffAttendanceEntity> {
    let empName = 'Employee';
    const emp = this.inMemoryEmps.find((e) => e.id === employeeId);
    if (emp) empName = emp.fullName;

    const att: StaffAttendanceEntity = {
      id: `ATT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      merchantId,
      storeId,
      employeeId,
      employeeName: empName,
      clockInTime: new Date(),
      totalHoursWorked: 0.00,
      notes: 'Shift Clock-In via Sunmi POS',
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.attRepo) {
      const entity = this.attRepo.create(att);
      const saved = await this.attRepo.save(entity);
      console.log(`⏰ [Clock-In] ${saved.employeeName} clocked in at store ${saved.storeId}`);
      return saved;
    } else {
      this.inMemoryAtts.unshift(att);
      return att;
    }
  }

  async clockOut(attendanceId: string, hoursWorked?: number): Promise<StaffAttendanceEntity | null> {
    let att: StaffAttendanceEntity | null = null;
    const hours = hoursWorked || 8.00;

    if (this.isDbConnected && this.attRepo) {
      att = await this.attRepo.findOne({ where: { id: attendanceId } });
      if (att) {
        att.clockOutTime = new Date();
        att.totalHoursWorked = hours;
        att = await this.attRepo.save(att);
      }
    } else {
      att = this.inMemoryAtts.find((a) => a.id === attendanceId) || null;
      if (att) {
        att.clockOutTime = new Date();
        att.totalHoursWorked = hours;
      }
    }

    if (att) {
      console.log(`⏰ [Clock-Out] ${att.employeeName} clocked out. Total hours: ${att.totalHoursWorked} hrs`);
    }
    return att;
  }

  async getEmployeesByStore(storeId: string): Promise<StaffEmployeeEntity[]> {
    if (this.isDbConnected && this.empRepo) {
      return await this.empRepo.find({ where: { storeId }, order: { fullName: 'ASC' } });
    }
    return this.inMemoryEmps.filter((e) => e.storeId === storeId);
  }
}
