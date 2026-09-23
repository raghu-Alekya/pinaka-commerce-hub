import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class SaveStoreRoleTemplatesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  roleTemplateIds!: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
