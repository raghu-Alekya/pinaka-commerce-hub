import { Controller, Get, Patch, Param, Body, Headers, Sse, MessageEvent, BadRequestException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { CanonicalOrder, OrderStatus } from '@pinaka-delivery-hub/canonical-model';

// Real-Time Event Stream Subject for Gateway Server-Sent Events (SSE)
export const gatewayOrderStream$ = new Subject<CanonicalOrder>();

@Controller('api/v1/gateway')
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'gateway',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  readiness() {
    return {
      status: 'ready',
    };
  }

  // 1. Proxy GET all orders from order-service (Port 3002)
  @Get('orders')
  async getOrders() {
    try {
      const response = await fetch('http://localhost:3002/api/v1/orders');
      const data = await response.json();
      return data;
    } catch {
      return { success: true, count: 0, orders: [] };
    }
  }

  // 2. Real-time Order Stream (Server-Sent Events) for LiveOrderMonitor.tsx
  @Sse('orders/stream')
  streamOrders(): Observable<MessageEvent> {
    return gatewayOrderStream$.asObservable().pipe(
      map((order: CanonicalOrder) => ({
        data: JSON.stringify(order),
      } as MessageEvent))
    );
  }

  // 3. Proxy PATCH order status to order-service (Port 3002) with correlation ID propagation
  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body('status') status: OrderStatus,
    @Headers('x-correlation-id') correlationId?: string
  ) {
    const activeCorrelationId = correlationId || `corr_${crypto.randomUUID()}`;

    try {
      const response = await fetch(`http://localhost:3002/api/v1/orders/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': activeCorrelationId,
        },
        body: JSON.stringify({ status }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new BadRequestException(data);
      }

      // If status updated, notify SSE stream
      if (data.order) {
        gatewayOrderStream$.next(data.order);
      }

      return data;
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException({
        statusCode: 400,
        message: err.message || 'Failed to update order status',
        error: 'Bad Request',
      });
    }
  }
}
