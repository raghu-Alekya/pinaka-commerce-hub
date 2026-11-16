import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class SavePosCardPaymentDto {
  @IsIn(['Kickback', 'Payroc'])
  provider!: string;

  @IsString()
  @MaxLength(100)
  deviceId!: string;

  @IsString()
  @MaxLength(100)
  processorMerchantId!: string;

  @ValidateIf((value: SavePosCardPaymentDto) => value.provider === 'Payroc')
  @IsString()
  @MaxLength(100)
  terminalId?: string;

  @IsString()
  @MaxLength(500)
  secretKey!: string;

  @IsString()
  @MaxLength(2048)
  webhookUrl!: string;

  /** WordPress pinaka_payment_gateway_provider. Omitted values leave the saved selection unchanged. */
  @IsOptional()
  @IsIn(['kickback', 'payroc', 'payrock', 'default', 'offline'])
  payment_gateway_provider?: string;
}
