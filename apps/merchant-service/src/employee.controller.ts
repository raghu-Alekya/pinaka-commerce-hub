import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { Public } from '@pinaka-delivery-hub/auth';
import { MerchantRepository } from './merchant.repository';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employee.dto';

@Public()
@Controller('api/v1/merchants/:merchantId/employees')
export class EmployeeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query('status') status?: string) {
    const employees = await this.repository.listEmployees(merchantId, status);
    return { success: true, count: employees.length, employees };
  }

  @Get(':idOrCode')
  async get(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const employee = await this.repository.getEmployeeByIdOrCode(merchantId, idOrCode);
    if (!employee) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, employee };
  }

  @Post()
  async create(@Param('merchantId') merchantId: string, @Body() body: CreateEmployeeDto) {
    body.merchantId = merchantId;
    const existing = await this.repository.getEmployeeByIdOrCode(merchantId, body.employeeCode);
    if (existing) throw new ConflictException(`Employee code '${body.employeeCode}' already exists for this merchant`);
    const employee = await this.repository.createEmployee(body);
    return { success: true, message: 'Employee workforce record created successfully', employee };
  }

  @Put(':idOrCode')
  async update(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string, @Body() body: UpdateEmployeeDto) {
    const updated = await this.repository.updateEmployee(merchantId, idOrCode, body);
    if (!updated) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, message: 'Employee record updated successfully', employee: updated };
  }

  @Delete(':idOrCode')
  async delete(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const deleted = await this.repository.deleteEmployee(merchantId, idOrCode);
    if (!deleted) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, message: 'Employee record deactivated successfully' };
  }
}
