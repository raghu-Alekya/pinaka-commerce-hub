import { BadRequestException } from '@nestjs/common';
import { StoreSetupDto } from './store-setup.dto';

export function storeSetup(body: StoreSetupDto, previous: Record<string, unknown> = {}) {
  if (body.hours) {
    if (body.hours.length !== 7 || new Set(body.hours.map(day => day.day)).size !== 7) {
      throw new BadRequestException('hours must contain each day of the week exactly once');
    }
    for (const day of body.hours) {
      if (day.status !== 'Open') continue;
      const open = String(day.open || '');
      const close = String(day.close || '');
      if ((open && !close) || (!open && close)) {
        throw new BadRequestException(`${day.day}: opening and closing times must both be supplied`);
      }
      if (open && close && open === close) {
        throw new BadRequestException(`${day.day}: opening and closing times must differ`);
      }
    }
  }
  if (body.devices) {
    const serials = body.devices.map(device => String(device.serial || '').trim().toLowerCase());
    if (body.devices.some(d => typeof d.name !== 'string' || !d.name.trim() || !['POS','KDS','Printer','Scanner'].includes(String(d.type))) || serials.some(s => !s)) {
      throw new BadRequestException('Devices require a name, serial and supported type');
    }
    if (new Set(serials).size !== serials.length) throw new BadRequestException('Device identifiers must be unique');
  }
  if (body.roles?.some(role => typeof role.name !== 'string' || !role.name.trim() || !['Store','Merchant'].includes(String(role.scope)))) {
    throw new BadRequestException('Roles require a name and Store or Merchant scope');
  }
  const result = { ...previous };
  for (const key of ['logo','defaultLanguage','taxRegion','licensed','hours','devices','features','roles','rolePermissions'] as const) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  return result;
}
