import { Controller, Get, Post, Body, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { StaffRepository } from './staff.repository';

const staffRepository = new StaffRepository();
staffRepository.onModuleInit();

@Controller('api/v1/staff')
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'staff-service',
      version: '2.0.0 (PCH Module 10)',
      timestamp: new Date().toISOString(),
    };
  }

  // --- 1. Sunmi POS Fast Cashier Switch (Verify 4-Digit Employee PIN) ---
  @Post('verify-pin')
  async verifyPin(@Body() body: { storeId: string; pinCode: string }) {
    if (!body.storeId || !body.pinCode) {
      throw new BadRequestException('storeId and pinCode are required');
    }
    const emp = await staffRepository.verifyPin(body.storeId, body.pinCode);
    if (!emp) {
      throw new BadRequestException('Invalid employee PIN code');
    }
    return {
      success: true,
      message: `Employee '${emp.fullName}' authenticated successfully!`,
      employee: {
        id: emp.id,
        fullName: emp.fullName,
        role: emp.role,
        hourlyRate: emp.hourlyRate,
      },
    };
  }

  // --- 2. Clock-In at Start of Shift ---
  @Post('clock-in')
  async clockIn(@Body() body: { merchantId: string; storeId: string; employeeId: string }) {
    if (!body.merchantId || !body.storeId || !body.employeeId) {
      throw new BadRequestException('merchantId, storeId, and employeeId are required');
    }
    const att = await staffRepository.clockIn(body.merchantId, body.storeId, body.employeeId);
    return {
      success: true,
      message: `Clocked in successfully!`,
      attendanceId: att.id,
      clockInTime: att.clockInTime,
      attendance: att,
    };
  }

  // --- 3. Clock-Out at End of Shift ---
  @Post('clock-out')
  async clockOut(@Body() body: { attendanceId: string; hoursWorked?: number }) {
    if (!body.attendanceId) {
      throw new BadRequestException('attendanceId is required');
    }
    const updated = await staffRepository.clockOut(body.attendanceId, body.hoursWorked || 8.00);
    if (!updated) {
      throw new NotFoundException(`Attendance record '${body.attendanceId}' not found`);
    }
    return {
      success: true,
      message: `Clocked out successfully!`,
      totalHoursWorked: updated.totalHoursWorked,
      attendance: updated,
    };
  }

  // --- 4. Get Store Employee Roster ---
  @Get('employees')
  async getEmployees(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const roster = await staffRepository.getEmployeesByStore(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: roster.length,
      employees: roster,
    };
  }
}
