import { Type } from 'class-transformer';
import { Allow, IsString, IsNotEmpty, IsOptional, IsEnum, IsEmail, MaxLength, MinLength, IsDateString, IsBoolean, Matches, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { AuditInputDto } from '../../audit.dto';
import { EmployeeStatus } from '../../entities/employee.entity';


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

export class CreateEmployeeDto extends AuditInputDto {

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EmployeeStoreAssignmentDto)
  storeAssignments?: EmployeeStoreAssignmentDto[];

  @Allow()
  merchantId!: string;

  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  employeeCode?: string;

  @Allow()
  firstName!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  profileImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  loginPinHash?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  passwordHash?: string;

  @IsOptional()
  @IsDateString()
  lastActiveAt?: string;

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
  @IsOptional() @IsString() @MaxLength(30) username?: string;
  @IsString() @IsOptional() @Matches(/^\d{6}$/) loginPin?: string;
  @Allow() temporaryPassword!: string;
  @IsBoolean() @IsOptional() sendCredentials?: boolean;

  @IsEnum(EmployeeStatus)
  @IsOptional()
  status?: EmployeeStatus;
}

export class UpdateEmployeeDto extends AuditInputDto {

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EmployeeStoreAssignmentDto)
  storeAssignments?: EmployeeStoreAssignmentDto[];

  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeCode?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  profileImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  loginPinHash?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  passwordHash?: string;

  @IsOptional()
  @IsDateString()
  lastActiveAt?: string;

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
