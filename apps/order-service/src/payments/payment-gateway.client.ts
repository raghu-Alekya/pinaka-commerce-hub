import { Injectable } from '@nestjs/common';
import { chargeKickback, chargePayroc, type GatewayOutcome } from './payment-gateway';

@Injectable()
export class PaymentGatewayClient {
  chargeKickback(input: { deviceId: string; secretKey: string; amount: number }): Promise<GatewayOutcome> {
    return chargeKickback(input, fetch);
  }

  chargePayroc(input: {
    deviceId: string;
    terminalId: string;
    secretKey: string;
    amount: number;
    orderId: string;
    operator: string;
  }): Promise<GatewayOutcome> {
    return chargePayroc(input, fetch);
  }
}
