import {
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import {
  AggregatorWebhookEntity,
  AggregatorWebhookStatus,
} from './aggregator-webhook.entity';

type WebhookPayload = Record<string, unknown>;

@Injectable()
export class AggregatorWebhookRepository implements OnModuleInit {
  private readonly inMemoryWebhooks: AggregatorWebhookEntity[] = [];

  async onModuleInit(): Promise<void> {
    const dataSource = await connectPostgres('Aggregator webhooks', [], { synchronize: false })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Aggregator Webhooks DB] Could not connect to drop the retired table: ${message}`);
        return undefined;
      });
    if (!dataSource) return;

    try {
      await AggregatorWebhookEntity.dropLegacyTable(dataSource);
    } finally {
      await dataSource.destroy();
    }
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
    const webhook = this.inMemoryWebhooks.find((item) => item.id === id);
    if (webhook) {
      webhook.status = status;
      webhook.errorMessage = errorMessage;
      webhook.updatedAt = new Date();
    }
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
