import { Controller, Get, Post, Put, Body, Param, Query, Headers, BadRequestException } from '@nestjs/common';
import { DeliveryConnectorRepository } from './delivery-connector.repository';
import { WooCommerceConnectorService } from './services/woocommerce-connector.service';
import { DeliveryOrderStatus } from './entities/delivery-order-log.entity';

@Controller(['api/v1/connectors', 'connector/api/v1', 'api/v1', 'connectors', 'connector'])
export class AppController {
  constructor(
    private readonly deliveryRepository: DeliveryConnectorRepository,
    private readonly wcService: WooCommerceConnectorService,
  ) {}
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'connector-service (Delivery Aggregator & WooCommerce REST Sync)',
      version: '2.0.0 (PCH Module 2 & 6)',
      timestamp: new Date().toISOString(),
    };
  }

  // ==========================================
  // MODULE 2: WOOCOMMERCE SYNC ENDPOINTS
  // ==========================================

  @Get('woocommerce/connection')
  async getWooCommerceConnection(@Query('storeId') storeId: string) {
    const conn = await this.wcService.getConnection(storeId || 'STR-50069');
    return {
      success: true,
      connection: conn,
    };
  }

  @Post('woocommerce/webhook')
  async handleWooCommerceWebhook(
    @Headers('x-wc-webhook-topic') topic: string,
    @Headers('x-wc-webhook-signature') signature: string,
    @Body() body: any
  ) {
    const eventTopic = topic || body.topic || 'product.updated';
    const log = await this.wcService.ingestWooCommerceWebhook(eventTopic, body);
    return {
      success: true,
      message: `WooCommerce event '${eventTopic}' processed and synchronized with PCH catalog!`,
      log,
    };
  }

  @Put(['stores/:storeId/connector', 'woocommerce/stores/:storeId/connector', 'stores/:storeId'])
  @Post(['stores/:storeId/connector', 'woocommerce/stores/:storeId/connector'])
  async updateStoreConnector(@Param('storeId') storeId: string, @Body() body: any) {
    const targetStore = storeId || body.storeId || body.storeCode || 'STR-50069';
    const targetMerchant = body.merchantId || body.merchantCode || 'MER-976045';
    const storeUrl = body.wordpressUrl || body.storeUrl || body.url || 'https://aascorner.alektasolutions.com';
    const jwtToken = body.wordpressJwt || body.jwtToken || body.token || '';

    const result = await this.wcService.triggerFullCatalogSync(targetStore, targetMerchant, storeUrl, jwtToken);
    return {
      success: true,
      message: `WordPress site '${storeUrl}' connector saved and catalog synchronized successfully!`,
      merchantId: targetMerchant,
      storeId: targetStore,
      syncedProductsCount: result.syncedItemsCount,
      connector: {
        provider: 'WORDPRESS',
        wordpressUrl: storeUrl,
        wordpressJwtConfigured: true,
      },
      timestamp: result.timestamp,
    };
  }

  @Post('woocommerce/test-connection')
  async testConnectionAndSync(@Body() body: any) {
    const targetStore = body.storeId || body.storeCode || 'STR-50069';
    const targetMerchant = body.merchantId || body.merchantCode || 'MER-976045';
    const storeUrl = body.storeUrl || body.url || 'https://aascorner.alektasolutions.com';
    const jwtToken = body.jwtToken || body.token || '';

    const result = await this.wcService.triggerFullCatalogSync(targetStore, targetMerchant, storeUrl, jwtToken);
    return {
      success: true,
      message: `WordPress site '${storeUrl}' connected and catalog synchronized successfully!`,
      merchantId: targetMerchant,
      storeId: targetStore,
      syncedProductsCount: result.syncedItemsCount,
      timestamp: result.timestamp,
    };
  }

  @Post('woocommerce/sync')
  async triggerFullCatalogSync(@Body() body: any) {
    const targetStore = typeof body === 'string' ? body : (body.storeId || body.storeCode || 'STR-50069');
    const targetMerchant = typeof body === 'object' ? (body.merchantId || body.merchantCode || 'MER-976045') : 'MER-976045';
    const result = await this.wcService.triggerFullCatalogSync(targetStore, targetMerchant);
    return {
      success: true,
      message: `WooCommerce store catalog synchronized successfully with PCH!`,
      syncedProductsCount: result.syncedItemsCount,
      timestamp: result.timestamp,
    };
  }

  // ==========================================
  // MODULE 6: DELIVERY AGGREGATOR ENDPOINTS
  // ==========================================

  @Get('delivery/channels')
  async getChannels(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-50069';
    const channels = await this.deliveryRepository.getChannelsByStore(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: channels.length,
      channels,
    };
  }

  @Post('delivery/webhook/:channel')
  async ingestWebhook(@Param('channel') channel: string, @Body() body: any) {
    if (!channel) {
      throw new BadRequestException('Delivery channel name is required');
    }
    const order = await this.deliveryRepository.ingestDeliveryWebhook(channel, body);
    return {
      success: true,
      message: `New ${channel.toUpperCase()} delivery order received and broadcast to Sunmi POS!`,
      orderId: order.id,
      channel: order.channel,
      status: order.status,
      order,
    };
  }

  @Get('delivery/orders')
  async getDeliveryOrders(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-50069';
    const orders = await this.deliveryRepository.getDeliveryOrders(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: orders.length,
      orders,
    };
  }

  @Post('delivery/orders/accept')
  async acceptOrder(@Body() body: { orderId: string; prepTimeMinutes?: number }) {
    const updated = await this.deliveryRepository.updateOrderStatus(body.orderId, DeliveryOrderStatus.ACCEPTED, body.prepTimeMinutes || 20);
    return {
      success: true,
      message: `Delivery Order #${body.orderId} accepted! Prep time set to ${updated?.prepTimeMinutes || 20} mins.`,
      order: updated,
    };
  }
}
