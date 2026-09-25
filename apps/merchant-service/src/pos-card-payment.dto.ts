import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';

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
}
