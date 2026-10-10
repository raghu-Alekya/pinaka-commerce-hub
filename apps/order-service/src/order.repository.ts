import { BadRequestException, Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';
import { OrderEntity, OrderType, PaymentMethod, PaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderStatusHistoryEntity } from './entities/order-status-history.entity';

@Injectable()
export class OrderRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private orderRepo?: Repository<OrderEntity>;
  private itemRepo?: Repository<OrderItemEntity>;
  private historyRepo?: Repository<OrderStatusHistoryEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private inMemoryOrders: OrderEntity[] = [];
  private inMemoryItems: OrderItemEntity[] = [];
  private inMemoryHistory: OrderStatusHistoryEntity[] = [];

  async onModuleInit() {
    try {
      await this.migrateLegacyOrderIdsBeforeOrm();
      await this.migrateOrderColumnsToSnakeCase();
      this.dataSource = new DataSource({
        ...postgresConnectionOptions([OrderEntity, OrderItemEntity, OrderStatusHistoryEntity]),
        synchronize: false,
      });
      await this.dataSource.initialize();
      await this.ensureOrderUuidSchema();
      await this.ensurePosOrderColumns();
      this.orderRepo = this.dataSource.getRepository(OrderEntity);
      this.itemRepo = this.dataSource.getRepository(OrderItemEntity);
      this.historyRepo = this.dataSource.getRepository(OrderStatusHistoryEntity);
      this.isDbConnected = true;
    } catch (err: any) {
      console.log(`⚠️ [Order Service DB] Offline (${err.message}). Using in-memory store fallback.`);
      this.isDbConnected = false;
    }

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [Order Service Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [Order Service Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  async createOrder(orderData: any): Promise<{ order: OrderEntity; items: OrderItemEntity[]; duplicate: boolean }> {
    if (!this.isDbConnected || !this.dataSource || !this.orderRepo || !this.itemRepo) {
      throw new ServiceUnavailableException('Order database is unavailable; the order was not saved');
    }
    if (this.isDbConnected && this.dataSource) {
      const stores = await this.dataSource.query(
        `SELECT id, merchant_id
         FROM public.stores
         WHERE id = $1::uuid AND COALESCE(is_deleted, false) = false
         LIMIT 1`,
        [orderData.storeId],
      );
      if (!stores.length) {
        throw new BadRequestException(`Store '${orderData.storeId}' was not found`);
      }
      orderData.merchantId = orderData.merchantId || stores[0].merchant_id;
    }
    if (orderData.source === 'WORDPRESS_COMPATIBLE') {
      orderData = await this.prepareWordPressCompatibleOrder(orderData);
    }
    const clientOrderId = String(orderData.clientOrderId || '').trim() || undefined;
    if (clientOrderId) {
      const existing = this.isDbConnected && this.orderRepo
        ? await this.orderRepo.findOne({ where: { storeId: orderData.storeId, clientOrderId } })
        : this.inMemoryOrders.find(order =>
            order.storeId === orderData.storeId && order.clientOrderId === clientOrderId,
          );
      if (existing) {
        if (orderData.source === 'WORDPRESS_COMPATIBLE') {
          throw new BadRequestException(
            `An order with the same client order ID already exists (Order ID: ${existing.id}).`,
          );
        }
        const existingItems = this.isDbConnected && this.itemRepo
          ? await this.itemRepo.find({ where: { orderId: existing.id } })
          : this.inMemoryItems.filter(item => item.orderId === existing.id);
        return { order: existing, items: existingItems, duplicate: true };
      }
    }
    const id = randomUUID();
    const orderNumber = `#${Math.floor(1000 + Math.random() * 9000)}`;

    let subtotal = 0;
    const items: OrderItemEntity[] = (orderData.items || []).map((i: any, idx: number) => {
      const lineTotal = i.totalPrice !== undefined
        ? Number(i.totalPrice)
        : Number(i.quantity || 1) * Number(i.unitPrice || 0);
      subtotal += lineTotal;
      return {
        id: `ITEM-${id}-${idx + 1}`,
        orderId: id,
        productId: i.productId || `PROD-${idx + 1}`,
        productName: i.productName || 'Sales Item',
        quantity: Number(i.quantity || 1),
        unitPrice: Number(i.unitPrice || 0),
        totalPrice: lineTotal,
        modifiers: i.modifiers || [],
      };
    });

    subtotal = orderData.subtotal !== undefined ? Number(orderData.subtotal) : subtotal;
    const taxAmount = orderData.taxAmount !== undefined ? Number(orderData.taxAmount) : Math.round(subtotal * 0.0825 * 100) / 100;
    const discountAmount = Number(orderData.discountAmount || 0);
    const tipAmount = Number(orderData.tipAmount || 0);
    const totalAmount = orderData.totalAmount !== undefined
      ? Number(orderData.totalAmount)
      : subtotal + taxAmount - discountAmount + tipAmount;

    const order: OrderEntity = {
      id,
      orderNumber,
      merchantId: orderData.merchantId || 'MCH-1001',
      storeId: orderData.storeId || 'STR-5001',
      shiftId: orderData.shiftId || 'SHIFT-8001',
      localShiftId: orderData.localShiftId,
      clientOrderId,
      offline: Boolean(orderData.offline),
      metadata: Array.isArray(orderData.metadata) ? orderData.metadata : [],
      requestPayload: orderData.requestPayload,
      customerName: orderData.customerName || 'Walk-in Customer',
      customerPhone: orderData.customerPhone || '',
      orderType: orderData.orderType || OrderType.IN_STORE_POS,
      paymentMethod: orderData.paymentMethod || PaymentMethod.CASH,
      paymentStatus: orderData.paymentStatus || PaymentStatus.PAID,
      subtotal,
      taxAmount,
      discountAmount,
      tipAmount,
      totalAmount,
      orderStatus: orderData.orderStatus || OrderStatus.CREATED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.isDbConnected && this.orderRepo && this.itemRepo && this.dataSource) {
      let savedOrder: OrderEntity;
      try {
        savedOrder = await this.dataSource.transaction(async manager => {
          const orderRepository = manager.getRepository(OrderEntity);
          const itemRepository = manager.getRepository(OrderItemEntity);
          const historyRepository = manager.getRepository(OrderStatusHistoryEntity);
          const persistedOrder = await orderRepository.save(orderRepository.create(order));
          await itemRepository.save(items.map(item => itemRepository.create(item)));
          await historyRepository.save(historyRepository.create({
            id: `HST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            orderId: id,
            fromStatus: 'NONE',
            toStatus: order.orderStatus,
            changedBy: 'POS System',
            reason: 'Initial Order Creation',
            createdAt: new Date(),
          }));
          return persistedOrder;
        });
      } catch (error: unknown) {
        if (error instanceof QueryFailedError && (error as any).driverError?.code === '22P02') {
          throw new BadRequestException(
            'Invalid UUID identifier. Send shift_id as the UUID value returned by pos_shifts.',
          );
        }
        throw error;
      }
      await this.cacheOrder(savedOrder);
      console.log(`🛍️ [Order Created] Order ${savedOrder.orderNumber} ($${savedOrder.totalAmount}) created for Store ${savedOrder.storeId}`);
      return { order: savedOrder, items, duplicate: false };
    } else {
      this.inMemoryOrders.unshift(order);
      this.inMemoryItems.push(...items);
      await this.recordStatusChange(id, 'NONE', order.orderStatus, 'POS System', 'Initial Order Creation');
      await this.cacheOrder(order);
      console.log(`🛍️ [Order Created (InMemory)] Order ${order.orderNumber} ($${order.totalAmount}) created for Store ${order.storeId}`);
      return { order, items, duplicate: false };
    }
  }

  private async prepareWordPressCompatibleOrder(orderData: any): Promise<any> {
    const payload = JSON.parse(JSON.stringify(orderData.requestPayload || {}));
    const metadata = Array.isArray(payload.meta_data) ? payload.meta_data : [];
    const metaValue = (key: string) => metadata.find((entry: any) => entry?.key === key)?.value;
    const clientOrderId = String(metaValue('_pos_client_order_id') || orderData.clientOrderId || '');
    const merchantDiscount = Math.abs(Number(metaValue('_merchant_discount') || 0));
    const requestedItems = Array.isArray(payload.line_items) ? payload.line_items : [];
    const cashbackItem = requestedItems.find(
      (item: any) => String(item?.name || '').trim().toLowerCase() === 'cashback',
    );
    const cashbackAmount = Math.abs(Number(cashbackItem?.total || 0));
    const cashbackFee = await this.cashbackFeeForAmount(orderData.storeId, cashbackAmount);
    const productItems = requestedItems
      .filter((item: any) => String(item?.name || '').trim().toLowerCase() !== 'cashback')
      .map((item: any) => {
        if (String(item?.name || '').trim().toLowerCase() === 'payout') {
          return { ...item, subtotal: '0.00', total: '0.00' };
        }
        return { ...item };
      });
    const discountableSubtotal = productItems.reduce((sum: number, item: any) => {
      if (String(item?.name || '').trim().toLowerCase() === 'payout') return sum;
      return sum + Math.max(0, Number(item.subtotal ?? item.total ?? 0));
    }, 0);
    const netReduction = Math.max(0, merchantDiscount - cashbackFee);
    let allocatedReduction = 0;
    const lastDiscountableIndex = productItems.reduce(
      (last: number, item: any, index: number) =>
        String(item?.name || '').trim().toLowerCase() === 'payout' ? last : index,
      -1,
    );
    const preparedItems = productItems.map((item: any, index: number) => {
      if (String(item?.name || '').trim().toLowerCase() === 'payout' || !discountableSubtotal) {
        return item;
      }
      const subtotal = Math.max(0, Number(item.subtotal ?? item.total ?? 0));
      const reduction = index === lastDiscountableIndex
        ? Math.max(0, netReduction - allocatedReduction)
        : Math.round((netReduction * subtotal / discountableSubtotal) * 100) / 100;
      allocatedReduction += reduction;
      return { ...item, total: Math.max(0, subtotal - reduction).toFixed(2) };
    });
    payload.line_items = preparedItems;
    payload.fee_lines = [];
    if (merchantDiscount > 0 && clientOrderId) {
      payload.coupon_lines = [{
        id: 1,
        code: `merchant_discount_${clientOrderId}`,
        discount: String(merchantDiscount),
        discount_tax: '0',
        meta_data: [],
        discount_type: 'fixed_cart',
        nominal_amount: merchantDiscount,
        free_shipping: false,
      }];
    }
    const items = preparedItems.map((item: any) => {
      const quantity = Number(item.quantity || 1);
      const totalPrice = Number(item.total ?? item.subtotal ?? 0);
      return {
        productId: String(item.product_id ?? item.productId ?? ''),
        productName: item.name || item.productName || 'Sales Item',
        quantity,
        unitPrice: totalPrice / quantity,
        totalPrice,
        modifiers: Array.isArray(item.meta_data) ? item.meta_data : [],
      };
    });
    const totalAmount = items.reduce((sum: number, item: any) => sum + Number(item.totalPrice), 0);
    return {
      ...orderData,
      requestPayload: payload,
      items,
      subtotal: discountableSubtotal,
      taxAmount: 0,
      discountAmount: merchantDiscount,
      totalAmount: Math.round(totalAmount * 100) / 100,
    };
  }

  private async cashbackFeeForAmount(storeId: string, amount: number): Promise<number> {
    if (!this.dataSource || amount <= 0) return 0;
    try {
      const rows = await this.dataSource.query(
        `SELECT t.fee
           FROM public.pos_cashback_settings s
           JOIN public.pos_cashback_tiers t ON t."cashbackId" = s.id
          WHERE s."storeId" = $1
            AND s.enabled = true
            AND ($2::numeric <= COALESCE(NULLIF(s."maxCashback", 0), $2::numeric))
            AND $2::numeric BETWEEN t."fromAmount" AND t."toAmount"
          ORDER BY t."sortOrder" ASC
          LIMIT 1`,
        [storeId, amount],
      );
      return Number(rows[0]?.fee || 0);
    } catch {
      return 0;
    }
  }

  private async migrateLegacyOrderIdsBeforeOrm(): Promise<void> {
    const migrationDataSource = new DataSource({
      ...postgresConnectionOptions([]),
      synchronize: false,
      logging: false,
    });
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(724621, 72)');
        const table = await manager.query(
          `SELECT to_regclass('public.orders') AS orders_table`,
        );
        if (!table[0]?.orders_table) return;
        const type = await manager.query(
          `SELECT data_type
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'id'`,
        );
        if (type[0]?.data_type === 'uuid') return;
        await manager.query(`
          CREATE TEMP TABLE order_uuid_migration (
            old_id varchar PRIMARY KEY,
            new_id uuid NOT NULL DEFAULT gen_random_uuid()
          ) ON COMMIT DROP
        `);
        await manager.query(`
          INSERT INTO order_uuid_migration (old_id)
          SELECT id FROM public.orders
          ON CONFLICT DO NOTHING
        `);
        await manager.query(`
          UPDATE public.order_line_items AS item
          SET "orderId" = mapping.new_id::text
          FROM order_uuid_migration AS mapping
          WHERE item."orderId" = mapping.old_id
        `);
        await manager.query(`
          UPDATE public.order_status_history AS history
          SET "orderId" = mapping.new_id::text
          FROM order_uuid_migration AS mapping
          WHERE history."orderId" = mapping.old_id
        `);
        await manager.query(`
          UPDATE public.orders AS orders
          SET id = mapping.new_id::text
          FROM order_uuid_migration AS mapping
          WHERE orders.id = mapping.old_id
        `);
        await manager.query(`
          ALTER TABLE public.orders
            ALTER COLUMN id TYPE uuid USING id::uuid,
            ALTER COLUMN id SET DEFAULT gen_random_uuid()
        `);
        await manager.query(`
          ALTER TABLE public.order_line_items
            ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
        `);
        await manager.query(`
          ALTER TABLE public.order_status_history
            ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
        `);
      });
    } finally {
      await migrationDataSource.destroy();
    }
  }

  private async migrateOrderColumnsToSnakeCase(): Promise<void> {
    const migrationDataSource = new DataSource({
      ...postgresConnectionOptions([]),
      synchronize: false,
      logging: false,
    });
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(724621, 73)');
        const tables = await manager.query(`SELECT to_regclass('public.orders') AS orders_table`);
        if (!tables[0]?.orders_table) return;
        const renames: Array<[string, string, string]> = [
          ['orders', 'orderNumber', 'order_number'],
          ['orders', 'merchantId', 'merchant_id'],
          ['orders', 'storeId', 'store_id'],
          ['orders', 'shiftId', 'shift_id'],
          ['orders', 'localShiftId', 'local_shift_id'],
          ['orders', 'clientOrderId', 'client_order_id'],
          ['orders', 'requestPayload', 'request_payload'],
          ['orders', 'customerName', 'customer_name'],
          ['orders', 'customerPhone', 'customer_phone'],
          ['orders', 'orderType', 'order_type'],
          ['orders', 'paymentMethod', 'payment_method'],
          ['orders', 'paymentStatus', 'payment_status'],
          ['orders', 'taxAmount', 'tax_amount'],
          ['orders', 'discountAmount', 'discount_amount'],
          ['orders', 'tipAmount', 'tip_amount'],
          ['orders', 'totalAmount', 'total_amount'],
          ['orders', 'orderStatus', 'order_status'],
          ['orders', 'createdAt', 'created_at'],
          ['orders', 'updatedAt', 'updated_at'],
          ['order_line_items', 'orderId', 'order_id'],
          ['order_line_items', 'productId', 'product_id'],
          ['order_line_items', 'productName', 'product_name'],
          ['order_line_items', 'unitPrice', 'unit_price'],
          ['order_line_items', 'totalPrice', 'total_price'],
          ['order_status_history', 'orderId', 'order_id'],
          ['order_status_history', 'fromStatus', 'from_status'],
          ['order_status_history', 'toStatus', 'to_status'],
          ['order_status_history', 'changedBy', 'changed_by'],
          ['order_status_history', 'createdAt', 'created_at'],
        ];
        for (const [table, oldName, newName] of renames) {
          await manager.query(`
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${oldName}')
                 AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${newName}') THEN
                ALTER TABLE public."${table}" RENAME COLUMN "${oldName}" TO "${newName}";
              END IF;
            END $$
          `);
        }
        await manager.query(`
          DO $$ BEGIN
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='merchant_id') <> 'uuid' THEN
              ALTER TABLE public.orders ALTER COLUMN merchant_id TYPE uuid USING merchant_id::uuid;
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='store_id') <> 'uuid' THEN
              ALTER TABLE public.orders ALTER COLUMN store_id TYPE uuid USING store_id::uuid;
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='shift_id') <> 'character varying' THEN
              ALTER TABLE public.orders ALTER COLUMN shift_id DROP DEFAULT;
              ALTER TABLE public.orders ALTER COLUMN shift_id TYPE varchar(100) USING shift_id::text;
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='created_at') = 'timestamp without time zone' THEN
              ALTER TABLE public.orders ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='updated_at') = 'timestamp without time zone' THEN
              ALTER TABLE public.orders ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
            END IF;
            IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='order_status_history' AND column_name='created_at') = 'timestamp without time zone' THEN
              ALTER TABLE public.order_status_history ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
            END IF;
          END $$
        `);
      });
    } finally {
      await migrationDataSource.destroy();
    }
  }

  private async ensurePosOrderColumns(): Promise<void> {
    if (!this.dataSource) return;
    await this.dataSource.query(`
      ALTER TABLE public.orders
        ADD COLUMN IF NOT EXISTS local_shift_id varchar(100),
        ADD COLUMN IF NOT EXISTS client_order_id varchar(150),
        ADD COLUMN IF NOT EXISTS offline boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS metadata jsonb,
        ADD COLUMN IF NOT EXISTS request_payload jsonb
    `);
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS orders_store_client_order_id_uidx
      ON public.orders (store_id, client_order_id)
      WHERE client_order_id IS NOT NULL
    `);
  }

  private async ensureOrderUuidSchema(): Promise<void> {
    if (!this.dataSource) return;
    const columns = await this.dataSource.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'orders' AND column_name = 'id')
           OR (table_name IN ('order_line_items', 'order_status_history') AND column_name = 'order_id'))`,
    );
    if (columns.length && columns.every((column: { data_type: string }) => column.data_type === 'uuid')) {
      return;
    }
    await this.dataSource.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(724621, 72)');
      await manager.query(`
        CREATE TEMP TABLE order_uuid_migration (
          old_id varchar PRIMARY KEY,
          new_id uuid NOT NULL DEFAULT gen_random_uuid()
        ) ON COMMIT DROP
      `);
      await manager.query(`
        INSERT INTO order_uuid_migration (old_id)
        SELECT id FROM public.orders
        WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ON CONFLICT DO NOTHING
      `);
      await manager.query(`
        UPDATE public.order_line_items AS item
        SET "orderId" = mapping.new_id::text
        FROM order_uuid_migration AS mapping
        WHERE item."orderId" = mapping.old_id
      `);
      await manager.query(`
        UPDATE public.order_status_history AS history
        SET "orderId" = mapping.new_id::text
        FROM order_uuid_migration AS mapping
        WHERE history."orderId" = mapping.old_id
      `);
      await manager.query(`
        UPDATE public.orders AS orders
        SET id = mapping.new_id::text
        FROM order_uuid_migration AS mapping
        WHERE orders.id = mapping.old_id
      `);
      await manager.query(`
        ALTER TABLE public.orders
          ALTER COLUMN id TYPE uuid USING id::uuid,
          ALTER COLUMN id SET DEFAULT gen_random_uuid()
      `);
      await manager.query(`
        ALTER TABLE public.order_line_items
          ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
      `);
      await manager.query(`
        ALTER TABLE public.order_status_history
          ALTER COLUMN "orderId" TYPE uuid USING "orderId"::uuid
      `);
    });
  }

  async updateOrderStatus(orderId: string, toStatus: OrderStatus, changedBy: string, reason?: string): Promise<OrderEntity | null> {
    let order: OrderEntity | null = null;

    if (this.isDbConnected && this.orderRepo) {
      order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (order) {
        const fromStatus = order.orderStatus;
        order.orderStatus = toStatus;
        order = await this.orderRepo.save(order);
        await this.recordStatusChange(orderId, fromStatus, toStatus, changedBy, reason);
      }
    } else {
      order = this.inMemoryOrders.find(o => o.id === orderId) || null;
      if (order) {
        const fromStatus = order.orderStatus;
        order.orderStatus = toStatus;
        await this.recordStatusChange(orderId, fromStatus, toStatus, changedBy, reason);
      }
    }

    if (order) {
      await this.cacheOrder(order);
      console.log(`🔄 [Order State Machine] Order #${orderId} transition: ${order.orderStatus} (by ${changedBy})`);
    }

    return order;
  }

  async getOrdersByStore(storeId: string): Promise<OrderEntity[]> {
    if (this.isDbConnected && this.orderRepo) {
      return this.orderRepo.find({ where: { storeId }, order: { createdAt: 'DESC' } });
    }
    return this.inMemoryOrders.filter(o => o.storeId === storeId);
  }

  async getOrderById(orderId: string): Promise<{ order: OrderEntity; items: OrderItemEntity[]; history: OrderStatusHistoryEntity[] } | null> {
    if (this.isDbConnected && this.orderRepo && this.itemRepo && this.historyRepo) {
      const order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (!order) return null;
      const items = await this.itemRepo.find({ where: { orderId } });
      const history = await this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
      return { order, items, history };
    } else {
      const order = this.inMemoryOrders.find(o => o.id === orderId);
      if (!order) return null;
      const items = this.inMemoryItems.filter(i => i.orderId === orderId);
      const history = this.inMemoryHistory.filter(h => h.orderId === orderId);
      return { order, items, history };
    }
  }

  private async recordStatusChange(orderId: string, fromStatus: string, toStatus: string, changedBy: string, reason?: string) {
    const entry: OrderStatusHistoryEntity = {
      id: `HST-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orderId,
      fromStatus,
      toStatus,
      changedBy: changedBy || 'POS System',
      reason: reason || 'State Machine Transition',
      createdAt: new Date(),
    };
    if (this.isDbConnected && this.historyRepo) {
      await this.historyRepo.save(this.historyRepo.create(entry));
    } else {
      this.inMemoryHistory.push(entry);
    }
  }

  private async cacheOrder(order: OrderEntity) {
    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.set(`order:${order.id}`, JSON.stringify(order), 'EX', 86400);
      } catch {}
    }
  }
}
