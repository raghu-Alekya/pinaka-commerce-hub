import { IsString, IsNotEmpty, IsOptional, IsEnum, IsEmail, MaxLength, MinLength, IsDateString, IsBoolean, Matches } from 'class-validator';
import { EmployeeStatus } from './entities/employee.entity';

export class CreateEmployeeDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  merchantId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  employeeCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsDateString() @IsOptional() dateOfBirth?: string;
  @IsString() @IsOptional() @MaxLength(20) gender?: string;
  @IsString() @IsOptional() @MaxLength(150) addressLine1?: string;
  @IsString() @IsOptional() @MaxLength(150) addressLine2?: string;
  @IsString() @IsOptional() @MaxLength(50) city?: string;
  @IsString() @IsOptional() @MaxLength(50) state?: string;
  @IsString() @IsOptional() @MaxLength(20) postalCode?: string;
  @IsString() @IsOptional() @MaxLength(50) country?: string;
  @IsString() @IsNotEmpty() @MaxLength(30) username!: string;
  @IsString() @IsOptional() @Matches(/^\d{6}$/) loginPin?: string;
  @IsString() @MinLength(8) @MaxLength(128) temporaryPassword!: string;
  @IsBoolean() @IsOptional() sendCredentials?: boolean;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  status?: EmployeeStatus;
}

export class UpdateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsDateString() @IsOptional() dateOfBirth?: string;
  @IsString() @IsOptional() @MaxLength(20) gender?: string;
  @IsString() @IsOptional() @MaxLength(150) addressLine1?: string;
  @IsString() @IsOptional() @MaxLength(150) addressLine2?: string;
  @IsString() @IsOptional() @MaxLength(50) city?: string;
  @IsString() @IsOptional() @MaxLength(50) state?: string;
  @IsString() @IsOptional() @MaxLength(20) postalCode?: string;
  @IsString() @IsOptional() @MaxLength(50) country?: string;
  @IsString() @IsOptional() @MaxLength(30) username?: string;
  @IsString() @IsOptional() @Matches(/^\d{6}$/) loginPin?: string;
  @IsString() @IsOptional() @MinLength(8) @MaxLength(128) temporaryPassword?: string;
  @IsBoolean() @IsOptional() sendCredentials?: boolean;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  status?: EmployeeStatus;
}
