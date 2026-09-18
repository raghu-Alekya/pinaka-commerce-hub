import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TendorStatus } from './entities/tendor.entity';

const blankToUndefined = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class CreateTendorDto {
  @Transform(blankToUndefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  tendorName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsIn([TendorStatus.ACTIVE, TendorStatus.INACTIVE])
  status?: TendorStatus;
}

export class UpdateTendorDto {
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(150)
  tendorName?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  @IsIn([TendorStatus.ACTIVE, TendorStatus.INACTIVE])
  status?: TendorStatus;
}
