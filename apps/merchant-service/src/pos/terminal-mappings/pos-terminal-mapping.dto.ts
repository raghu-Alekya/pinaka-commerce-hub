import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PosTerminalMappingDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  registerId!: string;

  @IsString()
  @MaxLength(100)
  terminal!: string;

  @IsString()
  @MaxLength(100)
  printer!: string;

  @IsString()
  @MaxLength(100)
  drawer!: string;

  @IsIn(['Active', 'Inactive', 'Setup'])
  status!: string;
}

export class SavePosTerminalMappingDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PosTerminalMappingDto)
  mappings: PosTerminalMappingDto[] = [];
}
