import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class SignUpDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^.{8,}$/, {
    message: 'password must contain at least 8 characters',
  })
  password!: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  credential!: string;
}

export class RequestPasswordResetDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class CompletePasswordActionDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MaxLength(128)
  @Matches(/^.{8,}$/, {
    message: 'password must contain at least 8 characters',
  })
  password!: string;
}

export class CreateAccountDto {
  @IsString() @IsNotEmpty() @MaxLength(255) account_name!: string;
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  account_manager_email!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) account_manager_firstname!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) account_manager_lastname!: string;
  @IsString() @IsNotEmpty() @MaxLength(30) account_manager_phone!: string;
}
