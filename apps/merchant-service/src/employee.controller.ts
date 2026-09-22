import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { Controller, Get, Post, Put, Delete, Param, Body, Query, NotFoundException, ConflictException, Inject, Patch, UseGuards } from '@nestjs/common';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employee.dto';

@UseGuards(RelationshipOwnerGuard)
@Controller('api/v1/merchants/:merchantId/employees')
export class EmployeeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query('status') status?: string) {
    merchantId = await this.requireMerchantId(merchantId);
    const employees = await this.repository.listEmployees(merchantId, status);
    return { success: true, count: employees.length, employees };
  }

  @Get(':idOrCode')
  async get(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    merchantId = await this.requireMerchantId(merchantId);
    const employee = await this.repository.getEmployeeDetails(merchantId, idOrCode);
    if (!employee) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, employee };
  }

  @Post()
  async create(@Param('merchantId') merchantId: string, @Body(new WorkforceValidationPipe({ expectedType: CreateEmployeeDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateEmployeeDto) {
    merchantId = await this.requireMerchantId(merchantId);
    body.merchantId = merchantId;
    const existing = await this.repository.getEmployeeByIdOrCode(merchantId, body.employeeCode);
    if (existing) throw new ConflictException(`Employee code '${body.employeeCode}' already exists for this merchant`);
    const created = await this.repository.createEmployee(body);
    const employee = await this.repository.getEmployeeDetails(merchantId, created.id);
    return { success: true, message: 'Employee workforce record created successfully', employee };
  }

  @Put(':idOrCode')
  async update(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string, @Body(new WorkforceValidationPipe({ expectedType: UpdateEmployeeDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateEmployeeDto) {
    merchantId = await this.requireMerchantId(merchantId);
    const updated = await this.repository.updateEmployee(merchantId, idOrCode, body);
    if (!updated) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    const employee = await this.repository.getEmployeeDetails(merchantId, updated.id);
    return { success: true, message: 'Employee record updated successfully', employee };
  }

  @Patch(':idOrCode')
  patch(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string, @Body(new WorkforceValidationPipe({ expectedType: UpdateEmployeeDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateEmployeeDto) { return this.update(merchantId, idOrCode, body); }

  @Delete(':idOrCode')
  async delete(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    merchantId = await this.requireMerchantId(merchantId);
    const deleted = await this.repository.deleteEmployee(merchantId, idOrCode);
    if (!deleted) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, message: 'Employee record deactivated successfully' };
  }

  private async requireMerchantId(identifier: string): Promise<string> {
    const id = await this.repository.resolveMerchantUuid(identifier);
    if (!id) throw new NotFoundException(`Merchant '${identifier}' not found`);
    return id;
  }
}
