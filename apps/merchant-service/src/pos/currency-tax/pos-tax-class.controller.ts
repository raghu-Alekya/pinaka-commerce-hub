import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { RequireAuth } from '../../modules/shared/session-auth.guard';
import { PosTaxClassService } from './pos-tax-class.service';

@Controller(['api/v1/stores/:storeId/tax-classes', 'connector/api/v1/stores/:storeId/tax-classes'])
@RequireAuth()
export class PosTaxClassController {
  constructor(@Inject(PosTaxClassService) private readonly taxes: PosTaxClassService) {}

  @Get(['', 'settings'])
  list(@Param('storeId', new ParseUUIDPipe()) storeId: string, @Req() request: { user?: { role?: string; id?: string } }) {
    return this.taxes.execute('list', storeId, undefined, {}, request.user);
  }

  @Post()
  create(@Param('storeId', new ParseUUIDPipe()) storeId: string, @Body() body: Record<string, unknown>, @Req() request: { user?: { role?: string; id?: string } }) {
    return this.taxes.execute('create', storeId, undefined, body, request.user);
  }

  @Put('settings')
  updateSettings(@Param('storeId', new ParseUUIDPipe()) storeId: string, @Body() body: Record<string, unknown>, @Req() request: { user?: { role?: string; id?: string } }) {
    return this.taxes.execute('update-settings', storeId, undefined, body, request.user);
  }

  @Put(':slug')
  update(@Param('storeId', new ParseUUIDPipe()) storeId: string, @Param('slug') slug: string, @Body() body: Record<string, unknown>, @Req() request: { user?: { role?: string; id?: string } }) {
    return this.taxes.execute('update', storeId, slug, body, request.user);
  }

  @Delete(':slug')
  remove(@Param('storeId', new ParseUUIDPipe()) storeId: string, @Param('slug') slug: string, @Req() request: { user?: { role?: string; id?: string } }) {
    return this.taxes.execute('delete', storeId, slug, {}, request.user);
  }
}
