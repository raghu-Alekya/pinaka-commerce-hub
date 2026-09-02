import { Injectable, CanActivate, ExecutionContext, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyGuard implements CanActivate {
  private redisClient?: Redis;
  private memoryCache = new Set<string>();

  constructor() {
    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      this.redisClient.connect().catch(() => {
        // Fallback to in-memory set if Redis is offline
      });
    } catch {
      // In-memory fallback
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const headers = request.headers || {};
    
    // Extract idempotency key from headers or body
    const idempotencyKey =
      headers['x-idempotency-key'] ||
      headers['x-wc-webhook-id'] ||
      headers['x-delivery-event-id'] ||
      request.body?.eventId ||
      request.body?.id;

    if (!idempotencyKey) {
      // If no idempotency header is provided, proceed (optional verification)
      return true;
    }

    const key = `idempotency:event:${idempotencyKey}`;

    if (this.redisClient && this.redisClient.status === 'ready') {
      const exists = await this.redisClient.get(key);
      if (exists) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Duplicate Event Skipped',
          message: `Event with Idempotency Key '${idempotencyKey}' was already processed.`,
          idempotent: true,
        });
      }
      // Store event key with 24-hour TTL (86400 seconds)
      await this.redisClient.set(key, 'PROCESSED', 'EX', 86400);
    } else {
      if (this.memoryCache.has(idempotencyKey)) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Duplicate Event Skipped',
          message: `Event with Idempotency Key '${idempotencyKey}' was already processed (In-Memory).`,
          idempotent: true,
        });
      }
      this.memoryCache.add(idempotencyKey);
      // Clean memory cache size if it exceeds 10,000 entries
      if (this.memoryCache.size > 10000) {
        const firstKey = this.memoryCache.values().next().value;
        if (firstKey) this.memoryCache.delete(firstKey);
      }
    }

    return true;
  }

  public async isDuplicate(idempotencyKey: string): Promise<boolean> {
    const key = `idempotency:event:${idempotencyKey}`;
    if (this.redisClient && this.redisClient.status === 'ready') {
      const exists = await this.redisClient.get(key);
      return !!exists;
    }
    return this.memoryCache.has(idempotencyKey);
  }

  public async markProcessed(idempotencyKey: string): Promise<void> {
    const key = `idempotency:event:${idempotencyKey}`;
    if (this.redisClient && this.redisClient.status === 'ready') {
      await this.redisClient.set(key, 'PROCESSED', 'EX', 86400);
    } else {
      this.memoryCache.add(idempotencyKey);
    }
  }
}
