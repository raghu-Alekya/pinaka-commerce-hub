import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const deviceTypes = [
  "POS Terminal",
  "Kitchen Display",
  "Barcode Scanner",
  "Receipt Printer",
  "Customer Display",
];

export class CreateDeviceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  deviceCode?: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  deviceName!: string;

  @IsIn(deviceTypes)
  deviceType!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  serialNumber!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  merchantId!: string;

  @IsOptional()
  @IsIn(["Active", "Inactive"])
  status?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  deviceCode?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  deviceName?: string;

  @IsOptional()
  @IsIn(deviceTypes)
  deviceType?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  serialNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  merchantId?: string;

  @IsOptional()
  @IsIn(["Active", "Inactive"])
  status?: string;
}
