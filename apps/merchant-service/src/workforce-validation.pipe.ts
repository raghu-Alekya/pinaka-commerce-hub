import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

/** Explicit DTO validation also works with the Windows tsx launcher. */
export class WorkforceValidationPipe extends ValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Provide a JSON object');
    const body = Object.fromEntries(Object.entries(value).map(([key, field]) => {
      if (field === null) throw new BadRequestException(`${key} must not be null; omit it to leave it unchanged`);
      return [key, typeof field === 'string' ? field.trim() : field];
    }));
    return super.transform(body, metadata);
  }
}
