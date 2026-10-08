import { IsNotEmpty, IsString, IsOptional, Length } from 'class-validator';

export class PosLoginDto {
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsString()
  @IsNotEmpty({ message: 'PIN is required' })
  @Length(4, 8, { message: 'PIN must be 6 digits' })
  pin!: string;

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
}
