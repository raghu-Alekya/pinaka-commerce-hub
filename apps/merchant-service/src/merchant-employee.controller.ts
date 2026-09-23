import { WorkforceValidationPipe } from './workforce-validation.pipe';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RelationshipOwnerGuard } from './relationships.controller';
import { MerchantRepository } from './merchant.repository';
import { CreateEmployeeDto, UpdateEmployeeDto } from './employee.dto';

const employeeImageDirectory = join(process.cwd(), 'uploads', 'employees');
mkdirSync(employeeImageDirectory, { recursive: true });
const { diskStorage } = require('multer');
const employeeImageUpload = FileInterceptor('image', {
  storage: diskStorage({
    destination: employeeImageDirectory,
    filename: (_request: unknown, file: { mimetype: string }, callback: (error: Error | null, filename: string) => void) => {
      const extension = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_request: unknown, file: { mimetype: string }, callback: (error: Error | null, accept: boolean) => void) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    callback(allowed ? null : new BadRequestException('Profile image must be JPG, PNG, or WebP'), allowed);
  },
});

type UploadedEmployeeImage = { filename: string; path: string };

@UseGuards(RelationshipOwnerGuard)
@Controller('api/v1/merchants/:merchantId/employees')
export class MerchantEmployeeController {
  constructor(@Inject(MerchantRepository) private readonly repository: MerchantRepository) {}

  @Get()
  async list(@Param('merchantId') merchantId: string, @Query('status') status?: string) {
    const merchantUuid = await this.requireMerchantId(merchantId);
    const employees = await this.repository.listEmployees(merchantUuid, status);
    return { success: true, count: employees.length, employees };
  }

  @Get(':idOrCode')
  async get(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const merchantUuid = await this.requireMerchantId(merchantId);
    const employee = await this.repository.getEmployeeDetails(merchantUuid, idOrCode);
    if (!employee) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, employee };
  }

  @Post()
  async create(
    @Param('merchantId') merchantId: string,
    @Body(new WorkforceValidationPipe({ expectedType: CreateEmployeeDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: CreateEmployeeDto,
  ) {
    const merchantUuid = await this.requireMerchantId(merchantId);
    body.merchantId = merchantUuid;
    const created = await this.repository.createEmployee(body);
    const employee = await this.repository.getEmployeeDetails(merchantUuid, created.id);
    return { success: true, message: 'Employee workforce record created successfully', employee };
  }

  @Put(':idOrCode')
  async update(
    @Param('merchantId') merchantId: string,
    @Param('idOrCode') idOrCode: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateEmployeeDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateEmployeeDto,
  ) {
    const merchantUuid = await this.requireMerchantId(merchantId);
    const updated = await this.repository.updateEmployee(merchantUuid, idOrCode, body);
    if (!updated) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    const employee = await this.repository.getEmployeeDetails(merchantUuid, updated.id);
    return { success: true, message: 'Employee record updated successfully', employee };
  }

  @Patch(':idOrCode')
  patch(
    @Param('merchantId') merchantId: string,
    @Param('idOrCode') idOrCode: string,
    @Body(new WorkforceValidationPipe({ expectedType: UpdateEmployeeDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) body: UpdateEmployeeDto,
  ) {
    return this.update(merchantId, idOrCode, body);
  }

  @Post(':idOrCode/profile-image')
  @UseInterceptors(employeeImageUpload)
  async uploadProfileImage(
    @Param('merchantId') merchantId: string,
    @Param('idOrCode') idOrCode: string,
    @UploadedFile() file?: UploadedEmployeeImage,
  ) {
    if (!file) throw new BadRequestException('Provide an image file in the image form-data field');
    const merchantUuid = await this.requireMerchantId(merchantId);
    const current = await this.repository.getEmployeeDetails(merchantUuid, idOrCode);
    if (!current) {
      await unlink(file.path).catch(() => undefined);
      throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    }
    const profileImageUrl = `/uploads/employees/${file.filename}`;
    const updated = await this.repository.updateEmployeeProfileImage(merchantUuid, idOrCode, profileImageUrl);
    await this.removeLocalImage(current.profileImageUrl);
    const employee = await this.repository.getEmployeeDetails(merchantUuid, updated!.id);
    return { success: true, message: 'Employee profile image uploaded successfully', profileImageUrl, employee };
  }

  @Delete(':idOrCode/profile-image')
  async deleteProfileImage(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const merchantUuid = await this.requireMerchantId(merchantId);
    const current = await this.repository.getEmployeeDetails(merchantUuid, idOrCode);
    if (!current) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    const updated = await this.repository.updateEmployeeProfileImage(merchantUuid, idOrCode, null);
    await this.removeLocalImage(current.profileImageUrl);
    const employee = await this.repository.getEmployeeDetails(merchantUuid, updated!.id);
    return { success: true, message: 'Employee profile image removed successfully', employee };
  }

  @Delete(':idOrCode')
  async delete(@Param('merchantId') merchantId: string, @Param('idOrCode') idOrCode: string) {
    const merchantUuid = await this.requireMerchantId(merchantId);
    const deleted = await this.repository.deleteEmployee(merchantUuid, idOrCode);
    if (!deleted) throw new NotFoundException(`Employee '${idOrCode}' not found for merchant '${merchantId}'`);
    return { success: true, message: 'Employee record deactivated successfully' };
  }

  private async requireMerchantId(identifier: string): Promise<string> {
    const id = await this.repository.resolveMerchantUuid(identifier);
    if (!id) throw new NotFoundException(`Merchant '${identifier}' not found`);
    return id;
  }

  private async removeLocalImage(value: unknown): Promise<void> {
    if (typeof value !== 'string' || !value.startsWith('/uploads/employees/')) return;
    await unlink(join(employeeImageDirectory, basename(value))).catch(() => undefined);
  }
}
