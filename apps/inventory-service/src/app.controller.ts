import { Controller, Get, Post, Body, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { InventoryRepository } from './inventory.repository';
import { AdjustmentType } from './entities/inventory-adjustment.entity';

const inventoryRepository = new InventoryRepository();
inventoryRepository.onModuleInit();

@Controller('api/v1/inventory')
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'inventory-service',
      version: '2.0.0 (PCH Module 4)',
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async getInventory(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const items = await inventoryRepository.getInventoryByStore(targetStore);
    return {
      success: true,
      storeId: targetStore,
      count: items.length,
      inventory: items,
    };
  }

  @Get('alerts/low-stock')
  async getLowStockAlerts(@Query('storeId') storeId: string) {
    const targetStore = storeId || 'STR-5001';
    const alerts = await inventoryRepository.getLowStockAlerts(targetStore);
    return {
      success: true,
      storeId: targetStore,
      lowStockCount: alerts.length,
      alerts,
    };
  }

  @Post('decrement')
  async decrementStock(@Body() body: { storeId: string; productId: string; quantity: number; performedBy?: string; reason?: string }) {
    if (!body.storeId || !body.productId || !body.quantity) {
      throw new BadRequestException('storeId, productId, and quantity are required');
    }
    const result = await inventoryRepository.decrementStock(body.storeId, body.productId, Number(body.quantity), body.performedBy || 'POS Terminal', body.reason);
    if (!result.success) {
      throw new NotFoundException(result.message);
    }
    return {
      success: true,
      message: 'Stock decremented successfully',
      item: result.item,
    };
  }

  @Post('adjust')
  async adjustStock(@Body() body: { storeId: string; productId: string; adjustmentType: AdjustmentType; quantityChange: number; performedBy?: string; reason?: string }) {
    if (!body.storeId || !body.productId || !body.quantityChange) {
      throw new BadRequestException('storeId, productId, and quantityChange are required');
    }
    const result = await inventoryRepository.adjustStock(body.storeId, body.productId, body.adjustmentType || AdjustmentType.REPLENISHMENT, Number(body.quantityChange), body.performedBy || 'Manager', body.reason);
    if (!result.success) {
      throw new NotFoundException(result.message);
    }
    return {
      success: true,
      message: 'Stock adjusted successfully',
      item: result.item,
    };
  }
}
