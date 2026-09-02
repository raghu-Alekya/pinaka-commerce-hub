import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CanonicalOrder } from '@pinaka-delivery-hub/canonical-model';
import { EventEnvelope } from '@pinaka-delivery-hub/event-contracts';
import { GlobalOrderEventBus } from '@pinaka-delivery-hub/messaging';
import {
  ConnectorContext,
  ConnectorError,
  FetchConnectorHttpClient,
  WebhookRequest,
} from '@pinaka-delivery-hub/connector-sdk';
import { connectorRegistry } from './connector-registry';
import { AggregatorWebhookRepository } from './aggregator-webhook.repository';
import { AggregatorWebhookEntity } from './aggregator-webhook.entity';
import { WooCommerceConnectorService } from './services/woocommerce-connector.service';
import { IdempotencyGuard } from './guards/idempotency.guard';

@Controller('api/v1/connectors')
export class AppController {
  constructor(
    @Inject(AggregatorWebhookRepository)
    private readonly aggregatorWebhooks: AggregatorWebhookRepository,
    @Inject(WooCommerceConnectorService)
    private readonly wooService: WooCommerceConnectorService,
    @Inject(IdempotencyGuard)
    private readonly idempotencyGuard: IdempotencyGuard,
  ) {}

  private readonly posOrdersUrl =
    process.env.POS_ORDERS_URL ||
    'https://merchantrestaurant.alektasolutions.com/wp-json/pinaka-restaurant-pos/v1/orders';

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'connector-service',
      version: '2.0.0 (PCH Module 2 Data Sync)',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  readiness() {
    return {
      status: 'ready',
    };
  }

  @Get()
  connectors() {
    return connectorRegistry.list().map(({ descriptor }) => descriptor);
  }

  // --- Module 2: WooCommerce Webhook & Data Sync Endpoints ---

  @Post('webhooks/woocommerce')
  async handleWooCommerceWebhook(
    @Body() body: any,
    @Headers('x-wc-webhook-signature') signature: string,
    @Headers('x-wc-webhook-topic') topic: string,
    @Headers('x-wc-webhook-id') webhookId: string,
    @Req() request: { rawBody?: Buffer },
  ) {
    const rawBody = request.rawBody || Buffer.from(JSON.stringify(body));

    // 1. Cryptographic HMAC Signature Validation
    const isValidSignature = this.wooService.validateHmacSignature(rawBody, signature);
    if (!isValidSignature) {
      throw new BadRequestException('Invalid HMAC-SHA256 signature for WooCommerce webhook');
    }

    // 2. Idempotency Check (prevent duplicate processing)
    const eventId = webhookId || `wc_evt_${body.id}_${Date.now()}`;
    const isDuplicate = await this.idempotencyGuard.isDuplicate(eventId);
    if (isDuplicate) {
      return {
        success: true,
        message: 'Duplicate WooCommerce webhook event skipped',
        eventId,
        skipped: true,
      };
    }
    await this.idempotencyGuard.markProcessed(eventId);

    // 3. Dispatch by Topic
    const merchantId = body.merchantId || 'MCH-1001';
    let syncResult;

    if (topic === 'product.created' || topic === 'product.updated' || body.sku || body.stock_quantity !== undefined) {
      syncResult = await this.wooService.syncProduct(merchantId, body);
    } else {
      syncResult = await this.wooService.syncOrder(merchantId, body);
    }

    return {
      success: true,
      message: 'WooCommerce webhook processed successfully',
      topic: topic || 'product.updated',
      syncLog: syncResult,
    };
  }

  @Post('sync/trigger')
  async triggerManualSync(@Body() body: { merchantId?: string; scope?: 'ALL' | 'PRODUCTS' | 'ORDERS' | 'INVENTORY' }) {
    const merchantId = body.merchantId || 'MCH-1001';
    const scope = body.scope || 'ALL';
    return await this.wooService.triggerManualSync(merchantId, scope);
  }

  @Get('sync/status')
  async getSyncStatus(@Query('merchantId') merchantId?: string) {
    const logs = await this.wooService.getSyncLogs(merchantId, 10);
    return {
      status: 'HEALTHY',
      channel: 'WOOCOMMERCE',
      lastSyncedAt: logs[0]?.createdAt || new Date().toISOString(),
      activeQueues: {
        rabbitmqDlq: 0,
        redisIdempotencyKeys: 12,
      },
      recentSyncCount: logs.length,
      recentLogs: logs,
    };
  }

  @Get('sync/logs')
  async getSyncLogs(@Query('merchantId') merchantId?: string, @Query('limit') limit?: number) {
    const logs = await this.wooService.getSyncLogs(merchantId, limit ? Number(limit) : 50);
    return {
      success: true,
      count: logs.length,
      logs,
    };
  }

  @Post(':connector/webhook')
  async handleConnectorWebhook(
    @Param('connector') connectorId: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: { rawBody?: Buffer },
  ) {
    const normalizedConnectorId = connectorId.trim().toLowerCase();
    let connector;
    try {
      connector = connectorRegistry.get(normalizedConnectorId);
    } catch (error) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Connector '${connectorId}' is not registered`,
        availableConnectors: connectorRegistry
          .list()
          .map((item) => item.descriptor.id),
        error: 'Not Found',
      });
    }

    const correlationHeader = headers['x-correlation-id'];
    const activeCorrelationId =
      (Array.isArray(correlationHeader)
        ? correlationHeader[0]
        : correlationHeader) || `corr_${crypto.randomUUID()}`;
    const envPrefix = normalizedConnectorId.replace(/-/g, '_').toUpperCase();
    const context: ConnectorContext = {
      configuration: {
        connectorId: normalizedConnectorId,
        merchantId: process.env[`${envPrefix}_MERCHANT_ID`] || '',
        settings: {
          apiBaseUrl: process.env[`${envPrefix}_API_BASE_URL`] || '',
        },
        credentials: {
          apiToken: process.env[`${envPrefix}_API_TOKEN`] || '',
          apiKey: process.env[`${envPrefix}_API_KEY`] || '',
          webhookSecret: process.env[`${envPrefix}_WEBHOOK_SECRET`] || '',
        },
      },
      correlationId: activeCorrelationId,
      httpClient: new FetchConnectorHttpClient(),
      logger: {
        debug: (message, metadata) => console.debug(message, metadata || {}),
        info: (message, metadata) => console.info(message, metadata || {}),
        warn: (message, metadata) => console.warn(message, metadata || {}),
        error: (message, metadata) => console.error(message, metadata || {}),
      },
      now: () => new Date(),
    };
    const webhookRequest: WebhookRequest = {
      method: 'POST',
      path: `/api/v1/connectors/${normalizedConnectorId}/webhook`,
      headers,
      query,
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(body)),
      body,
    };

    let webhookRecord: AggregatorWebhookEntity | undefined;
    try {
      webhookRecord = await this.aggregatorWebhooks.save(body);

      if (connector.verifyWebhook) {
        const verification = await connector.verifyWebhook(
          webhookRequest,
          context,
        );
        if (!verification.valid) {
          throw new BadRequestException(
            verification.reason || 'Webhook signature is invalid',
          );
        }
      }

      const events = await connector.parseWebhook(webhookRequest, context);
      if (events.length !== 1) {
        throw new BadRequestException(
          `Expected one order event but connector returned ${events.length}`,
        );
      }
      const canonicalOrder = events[0].payload;
      console.log(
        `[${connector.descriptor.displayName} Webhook Received] CorrelationID: ${activeCorrelationId}`,
      );

      const envelope: EventEnvelope<CanonicalOrder> = {
        eventId: events[0].id,
        eventType: 'ORDER_RECEIVED',
        source: 'connector-service',
        timestamp: events[0].occurredAt,
        correlationId: activeCorrelationId,
        version: '1.0.0',
        payload: canonicalOrder,
      };

      await GlobalOrderEventBus.publish(envelope);

      // Persist the canonical event before attempting the optional synchronous
      // POS integration. A POS outage or configuration error must not prevent a
      // valid webhook from reaching RabbitMQ and the order service.
      let posOrders: Awaited<ReturnType<AppController['createPosTakeawayOrder']>> | undefined;
      let posError: string | undefined;
      try {
        posOrders = await this.createPosTakeawayOrder(canonicalOrder);
      } catch (error) {
        posError = this.formatPosError(error);
        console.warn(
          `[POS Deferred] Order #${canonicalOrder.externalOrderId} was published successfully; direct POS creation failed: ${posError}`,
        );
      }
      await this.aggregatorWebhooks.updateStatus(webhookRecord.id, 'SUCCESS');

      return {
        success: true,
        connector: connector.descriptor.id,
        orderId: canonicalOrder.id,
        posOrders,
        posError,
        envelope,
        canonicalOrder,
      };
    } catch (error) {
      if (webhookRecord) {
        const failureMessage =
          error instanceof Error ? error.message : String(error);
        try {
          await this.aggregatorWebhooks.updateStatus(
            webhookRecord.id,
            'FAILED',
            failureMessage,
          );
        } catch (statusError) {
          console.error(
            '[PostgreSQL] Failed to update webhook status',
            statusError,
          );
        }
      }

      if (error instanceof ConnectorError) {
        throw new BadRequestException({
          statusCode: error.statusCode || 400,
          message: error.message,
          code: error.code,
          error: 'Bad Request',
        });
      }
      throw error;
    }
  }

  private async createPosTakeawayOrder(order: CanonicalOrder) {
    const restaurantId = Number(process.env.POS_RESTAURANT_ID || 1);
    const captainId = Number(process.env.POS_CAPTAIN_ID || 1);
    const defaultProductId = Number(process.env.POS_DEFAULT_PRODUCT_ID || 1652);

    const parent = await this.postPosOrder({
      flag_type: 'parent_online_order',
      restaurant_id: restaurantId,
      created_via: 'online',
      order_datetime: new Date().toISOString(),
    });

    const parentOrderId = this.extractPosOrderId(parent);
    if (parentOrderId === undefined) {
      throw new BadGatewayException(
        'POS created the parent order but did not return an id or order_id',
      );
    }

    const kot = await this.postPosOrder({
      flag_type: 'kot_order',
      parent_order_id: parentOrderId,
      restaurant_id: restaurantId,
      captain_id: captainId,
      line_items: order.items.map((item) => ({
        product_id: this.resolvePosProductId(
          item.externalItemId,
          defaultProductId,
        ),
        quantity: item.quantity,
      })),
    });

    return { parentOrderId, parent, kot };
  }

  private resolvePosProductId(
    externalItemId: string,
    fallback: number,
  ): number {
    const exact = Number(externalItemId);
    if (Number.isInteger(exact) && exact > 0) return exact;
    const numericSuffix = externalItemId.match(/(\d+)$/)?.[1];
    const parsedSuffix = numericSuffix ? Number(numericSuffix) : NaN;
    return Number.isInteger(parsedSuffix) && parsedSuffix > 0
      ? parsedSuffix
      : fallback;
  }

  private async postPosOrder(payload: Record<string, unknown>): Promise<any> {
    const configuredAuthorization = process.env.POS_AUTHORIZATION?.trim();
    const configuredToken = process.env.POS_API_TOKEN?.trim().replace(
      /^Bearer\s+/i,
      '',
    );
    const authorization =
      configuredAuthorization ||
      (configuredToken ? `Bearer ${configuredToken}` : undefined);

    if (!authorization) {
      throw new BadGatewayException(
        'POS authentication is not configured. Set POS_AUTHORIZATION or POS_API_TOKEN.',
      );
    }

    if (!configuredAuthorization && configuredToken?.split('.').length !== 3) {
      throw new BadGatewayException(
        'POS_API_TOKEN is not a valid JWT. It must contain three dot-separated segments and may optionally start with Bearer.',
      );
    }

    try {
      const response = await fetch(this.posOrdersUrl, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let result: any;
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = { raw: text };
      }

      if (!response.ok) {
        const detail =
          typeof result?.message === 'string'
            ? `: ${result.message}`
            : '';
        throw new Error(`HTTP ${response.status}${detail}`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(`POS order creation failed: ${message}`);
    }
  }

  private extractPosOrderId(response: any): string | number | undefined {
    return (
      response?.id ??
      response?.order_id ??
      response?.data?.id ??
      response?.data?.order_id ??
      response?.data?.order?.id ??
      response?.data?.order?.order_id
    );
  }

  private formatPosError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1];
    if (httpStatus) return `POS endpoint returned HTTP ${httpStatus}`;
    if (message.includes('authentication is not configured')) {
      return 'POS authentication is not configured';
    }
    if (message.includes('not a valid JWT')) {
      return 'POS API token is invalid';
    }
    return 'POS order creation failed';
  }
}
