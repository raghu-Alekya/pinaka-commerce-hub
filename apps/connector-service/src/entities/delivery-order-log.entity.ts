import type { DataSource } from 'typeorm';

export enum DeliveryOrderStatus {
  RECEIVED = 'RECEIVED',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export class DeliveryOrderLogEntity {
  static async dropLegacyTable(dataSource: DataSource): Promise<void> {
    await dataSource.query('DROP TABLE IF EXISTS public.delivery_order_logs RESTRICT');
  }


  id!: string; // e.g. "DEL-10045"

  merchantId!: string;

  storeId!: string;

  channel!: string; // 'DOORDASH' | 'UBER_EATS' | 'SWIGGY'

  externalOrderId!: string;

  customerName!: string;

  customerPhone?: string;

  deliveryAddress!: Record<string, any>;

  driverName?: string;

  driverPhone?: string;

  prepTimeMinutes!: number;

  deliveryFee!: number;

  totalAmount!: number;

  orderItems!: any[];

  status!: DeliveryOrderStatus;

  createdAt!: Date;
}
