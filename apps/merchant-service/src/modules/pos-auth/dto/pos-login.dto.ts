import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class PosLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'PIN is required' })
  pin!: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  merchantCode?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  storeCode?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  deviceCode?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  device_serial_number?: string;

  @IsOptional()
  @IsString()
  device_serialnumber?: string;

  @IsOptional()
  @IsString()
  deviceServiceNumber?: string;

  @IsOptional()
  @IsString()
  deviceService?: string;

  @IsOptional()
  @IsString()
  registerId?: string;
}
