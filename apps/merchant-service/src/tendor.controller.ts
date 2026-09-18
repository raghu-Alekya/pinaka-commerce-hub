import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { TendorRepository } from './tendor.repository';
import { CreateTendorDto, UpdateTendorDto } from './tendor.dto';
import { TendorFormValidationPipe } from './vendor-tendor.form.pipe';
import { TendorStatus } from './entities/tendor.entity';

const createValidation = new TendorFormValidationPipe({
  expectedType: CreateTendorDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const patchValidation = new TendorFormValidationPipe({
  expectedType: UpdateTendorDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  skipUndefinedProperties: true,
});

@Controller(['api/v1/tendors', 'api/v1/tenders'])
export class TendorController {
  constructor(@Inject(TendorRepository) private readonly repository: TendorRepository) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const status = query.status?.trim().toUpperCase();
    if (status && status !== 'ALL' && status !== TendorStatus.ACTIVE && status !== TendorStatus.INACTIVE) {
      throw new BadRequestException('Invalid status');
    }
    const tendors = await this.repository.list({
      status: status && status !== 'ALL' ? status : undefined,
      search: query.search,
    });
    return { success: true, count: tendors.length, tendors };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return { success: true, tendor: await this.repository.getById(id) };
  }

  @Post()
  async create(@Body(createValidation) body: Record<string, unknown>) {
    return { success: true, message: 'Tendor created', tendor: await this.repository.create(body as CreateTendorDto) };
  }

  @Put(':id')
  async replace(@Param('id', new ParseUUIDPipe()) id: string, @Body(createValidation) body: Record<string, unknown>) {
    return { success: true, message: 'Tendor updated', tendor: await this.repository.update(id, body as CreateTendorDto) };
  }

  @Patch(':id')
  async patch(@Param('id', new ParseUUIDPipe()) id: string, @Body(patchValidation) body: Record<string, unknown>) {
    return { success: true, message: 'Tendor updated', tendor: await this.repository.update(id, body as UpdateTendorDto) };
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.repository.softDelete(id);
    return { success: true, message: 'Tendor deleted' };
  }
}
