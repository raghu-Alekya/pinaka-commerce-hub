import { Injectable } from '@nestjs/common';
import {
  chargeKickback,
  chargePayroc,
  continuePayroc,
  type GatewayOutcome,
  type PayrocChargeInput,
} from './payment-gateway';

@Injectable()
export class PaymentGatewayClient {
  chargeKickback(input: { deviceId: string; secretKey: string; amount: number }): Promise<GatewayOutcome> {
    return chargeKickback(input, fetch);
  }

  chargePayroc(input: PayrocChargeInput): Promise<GatewayOutcome> {
    return chargePayroc(input, fetch);
  }

  /** Reads an instruction or payment that was already submitted. Does not create a charge. */
  continuePayroc(input: { secretKey: string; instructionId?: string; paymentId?: string }): Promise<GatewayOutcome> {
    return continuePayroc(input, fetch);
  }
}
