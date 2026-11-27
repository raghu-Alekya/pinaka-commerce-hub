import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from './user.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateUserDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) firstName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) lastName!: string;
  @Transform(normalizeEmail) @IsEmail() @MaxLength(255) email!: string;
  @Transform(trim) @IsPhoneNumber() @MaxLength(30) phoneNumber!: string;
  @IsEnum(UserRole) role!: UserRole;
  @IsOptional() @IsBoolean() notificationEnabled?: boolean;
}

export class CreatePchUserDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) first_name!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) last_name!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) username!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(30) phone_number!: string;
  @Transform(normalizeEmail) @IsEmail() @MaxLength(255) email!: string;
  @IsEnum([UserRole.ADMIN, UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.AGENT]) role!: UserRole;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email?: string;
  @IsOptional()
  @Transform(trim)
  @IsPhoneNumber()
  @MaxLength(30)
  phoneNumber?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() notificationEnabled?: boolean;
}
