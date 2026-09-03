import { Controller, Get, Post, Body, Param, Query, Headers, BadRequestException } from '@nestjs/common';
import { DeliveryConnectorRepository } from './delivery-connector.repository';
import { WooCommerceConnectorService } from './services/woocommerce-connector.service';
import { DeliveryOrderStatus } from './entities/delivery-order-log.entity';

const deliveryRepository = new DeliveryConnectorRepository();
deliveryRepository.onModuleInit();

const wcService = new WooCommerceConnectorService();
wcService.onModuleInit();

@Controller('api/v1/connectors')
export class AppController {
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
    const conn = await wcService.getConnection(storeId || 'STR-5001');
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
    const log = await wcService.ingestWooCommerceWebhook(eventTopic, body);
    return {
      success: true,
      message: `WooCommerce event '${eventTopic}' processed and synchronized with PCH catalog!`,
      log,
    };
  }

  @Post('woocommerce/sync')
  async triggerFullCatalogSync(@Body('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const result = await wcService.triggerFullCatalogSync(targetStore);
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
    const targetStore = storeId || 'STR-5001';
    const channels = await deliveryRepository.getChannelsByStore(targetStore);
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
    const order = await deliveryRepository.ingestDeliveryWebhook(channel, body);
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
    const targetStore = storeId || 'STR-5001';
    const orders = await deliveryRepository.getDeliveryOrders(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: orders.length,
      orders,
    };
  }

  @Post('delivery/orders/accept')
  async acceptOrder(@Body() body: { orderId: string; prepTimeMinutes?: number }) {
    const updated = await deliveryRepository.updateOrderStatus(body.orderId, DeliveryOrderStatus.ACCEPTED, body.prepTimeMinutes || 20);
    return {
      success: true,
      message: `Delivery Order #${body.orderId} accepted! Prep time set to ${updated?.prepTimeMinutes || 20} mins.`,
      order: updated,
    };
  }
}
