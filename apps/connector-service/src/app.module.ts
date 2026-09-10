import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DeliveryConnectorRepository } from './delivery-connector.repository';
import { AggregatorWebhookRepository } from './aggregator-webhook.repository';
import { WooCommerceConnectorService } from './services/woocommerce-connector.service';
import { IdempotencyGuard } from './guards/idempotency.guard';

@Module({
  controllers: [AppController],
  providers: [
    DeliveryConnectorRepository,
    AggregatorWebhookRepository,
    WooCommerceConnectorService,
    IdempotencyGuard,
  ],
})
export class AppModule {}
