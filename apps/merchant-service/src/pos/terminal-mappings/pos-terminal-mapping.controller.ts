import { Body, Controller, Get, Inject, Param, Post, Put, ValidationPipe } from '@nestjs/common';
import { SavePosTerminalMappingDto } from './pos-terminal-mapping.dto';
import { PosTerminalMappingService } from './pos-terminal-mapping.service';

const validate = new ValidationPipe({
  expectedType: SavePosTerminalMappingDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller([
  'api/v1/stores/:storeId/pos/terminal-mappings',
  'connector/api/v1/stores/:storeId/pos/terminal-mappings',
  'stores/:storeId/pos/terminal-mappings',
])
export class PosTerminalMappingController {
  constructor(@Inject(PosTerminalMappingService) private readonly terminalMappings: PosTerminalMappingService) {}

  @Get()
  get(@Param('storeId') storeId: string) {
    return this.terminalMappings.get(storeId);
  }

  @Post()
  create(@Param('storeId') storeId: string, @Body(validate) body: SavePosTerminalMappingDto) {
    return this.terminalMappings.create(storeId, body);
  }

  @Put()
  update(@Param('storeId') storeId: string, @Body(validate) body: SavePosTerminalMappingDto) {
    return this.terminalMappings.update(storeId, body);
  }
}
