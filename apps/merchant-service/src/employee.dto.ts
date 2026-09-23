import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsEmail, MaxLength, MinLength, IsDateString, IsBoolean, Matches, IsArray, ValidateNested } from 'class-validator';
import { EmployeeStatus } from './entities/employee.entity';


export class EmployeeStoreAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  store!: string;

  @IsArray()
  @IsOptional()
  roles?: string[];

  @IsString()
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'loginPin must be a 6-digit string' })
  loginPin?: string;
}

export class CreateEmployeeDto {

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EmployeeStoreAssignmentDto)
  storeAssignments?: EmployeeStoreAssignmentDto[];

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

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EmployeeStoreAssignmentDto)
  storeAssignments?: EmployeeStoreAssignmentDto[];

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
