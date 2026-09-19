import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TendorStatus } from './entities/tendor.entity';


const firstText = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') continue;
      return trimmed;
    }
    return value;
  }
  return undefined;
};

const tendorCodeFrom = ({ obj, value }: { obj: Record<string, unknown>; value: unknown }) =>
  firstText(value, obj.tendorCode, obj.tendor_code, obj.tendor_Code, obj.code);

const tendorNameFrom = ({ obj, value }: { obj: Record<string, unknown>; value: unknown }) =>
  firstText(value, obj.tendorName, obj.tendor_Name, obj.tendor_name, obj.name);

export class CreateTendorDto {
  @Transform(tendorCodeFrom)
  @IsString()
  @Matches(/\S/)
  @MaxLength(50)
  tendorCode!: string;

  @Transform(tendorNameFrom)
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
  @Transform(tendorCodeFrom)
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(50)
  tendorCode?: string;

  @Transform(tendorNameFrom)
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
