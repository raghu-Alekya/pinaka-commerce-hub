import { map } from 'rxjs/operators';
import { ArgumentMetadata, BadRequestException, CallHandler, ExecutionContext, NestInterceptor, ValidationPipe } from '@nestjs/common';

/** Explicit DTO validation also works with the Windows tsx launcher. */
export class WorkforceValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Provide a JSON object');
    const body = Object.fromEntries(Object.entries(value).map(([key, field]) => {
      if (field === null) throw new BadRequestException(`${key} must not be null; omit it to leave it unchanged`);
      if (typeof field === 'string' && key === 'sendCredentials') {
        if (!['true', 'false'].includes(field.trim())) throw new BadRequestException('sendCredentials must be true or false');
        return [key, field.trim() === 'true'];
      }
      if (typeof field === 'string' && key === 'storeAssignments') {
        try { return [key, JSON.parse(field)]; }
        catch { throw new BadRequestException('storeAssignments must be a JSON array'); }
      }
      return [key, typeof field === 'string' ? field.trim() : field];
    }));
    return super.transform(body, metadata);
  }
}

/** Employee HTTP names are snake_case; persistence DTOs retain their entity mappings. */
export class EmployeeValidationPipe extends WorkforceValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Provide an employee object');
    const convert = (input: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(input).map(([key, field]) => {
      if (/[A-Z]/.test(key)) throw new BadRequestException(`Use snake_case field names: ${key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}`);
      if (['created_by', 'updated_by', 'employee_code', 'is_deleted'].includes(key)) throw new BadRequestException(`${key} is server-managed`);
      const name = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      if (key === 'store_assignments') {
        if (typeof field === 'string') { try { field = JSON.parse(field); } catch { throw new BadRequestException('store_assignments must be a JSON array'); } }
        if (Array.isArray(field)) field = field.map(item => item && typeof item === 'object' && !Array.isArray(item) ? convert(item) : item);
      }
      return [name, field];
    }));
    return super.transform(convert(value as Record<string, unknown>), metadata);
  }
}

export class EmployeeResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    const convert = (value: any): any => {
      if (Array.isArray(value)) return value.map(convert);
      if (value instanceof Date) return value;
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), convert(field)]));
      return value;
    };
    return next.handle().pipe(map(convert));
  }
}
