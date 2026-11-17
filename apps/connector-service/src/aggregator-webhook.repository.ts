import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import {
  AggregatorWebhookEntity,
  AggregatorWebhookStatus,
} from './aggregator-webhook.entity';

type WebhookPayload = Record<string, unknown>;

@Injectable()
export class AggregatorWebhookRepository
  implements OnModuleInit, OnModuleDestroy
{
  private dataSource?: DataSource;
  private repository?: Repository<AggregatorWebhookEntity>;
  private readonly inMemoryWebhooks: AggregatorWebhookEntity[] = [];

  async onModuleInit(): Promise<void> {
    try {
      this.dataSource = await connectPostgres('Aggregator webhooks', [
        AggregatorWebhookEntity,
      ]);
      await this.ensureTableExists();
      this.repository = this.dataSource.getRepository(AggregatorWebhookEntity);
      console.log('[PostgreSQL] aggregator_webhooks persistence is ready');
    } catch (error) {
      if (this.dataSource?.isInitialized) await this.dataSource.destroy();
      this.dataSource = undefined;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Aggregator Webhooks DB] Offline (${message}). Using in-memory fallback; webhook records will not survive restart.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) await this.dataSource.destroy();
  }

  async save(payload: unknown): Promise<AggregatorWebhookEntity> {
    if (!this.isObject(payload)) {
      throw new ServiceUnavailableException(
        'Webhook payload cannot be persisted as a JSON object',
      );
    }

    const nestedPayload = this.isObject(payload.payload)
      ? payload.payload
      : undefined;
    const destination = this.isObject(payload.destination)
      ? payload.destination
      : this.isObject(nestedPayload?.destination)
        ? nestedPayload.destination
        : undefined;
    const values = {
      payload,
      storeId: this.optionalIdentifier(
        destination?.storeId ?? destination?.store_id,
      ),
      restaurantId: this.optionalIdentifier(
        destination?.restaurantId ?? destination?.restaurant_id,
      ),
      status: 'RECEIVED',
      errorMessage: null,
    } as const;

    if (this.repository) {
      return this.repository.save(this.repository.create(values));
    }

    const now = new Date();
    const entity = Object.assign(new AggregatorWebhookEntity(), values, {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    this.inMemoryWebhooks.push(entity);
    return entity;
  }

  async updateStatus(
    id: string,
    status: AggregatorWebhookStatus,
    errorMessage: string | null = null,
  ): Promise<void> {
    if (!this.repository) {
      const webhook = this.inMemoryWebhooks.find((item) => item.id === id);
      if (webhook) {
        webhook.status = status;
        webhook.errorMessage = errorMessage;
        webhook.updatedAt = new Date();
      }
      return;
    }

    await this.repository.update(id, {
      status,
      errorMessage,
      updatedAt: new Date(),
    });
  }

  private async ensureTableExists(): Promise<void> {
    if (!this.dataSource) return;

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS aggregator_webhooks (
        id uuid PRIMARY KEY,
        payload jsonb NOT NULL,
        "storeId" varchar(255),
        "restaurantId" varchar(255),
        status varchar(20) NOT NULL DEFAULT 'RECEIVED',
        "errorMessage" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.dataSource.query(`
      ALTER TABLE aggregator_webhooks
        ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'RECEIVED',
        ADD COLUMN IF NOT EXISTS "errorMessage" text,
        ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()
    `);
  }

  private isObject(value: unknown): value is WebhookPayload {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private optionalIdentifier(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    return null;
  }
}
