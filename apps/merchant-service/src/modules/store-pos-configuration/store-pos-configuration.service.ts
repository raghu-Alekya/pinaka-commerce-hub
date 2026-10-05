import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { MerchantRepository } from '../merchant/merchant.repository';
import { StorePosConfigurationEntity } from '../../entities/store-pos-configuration.entity';
import { CreateStorePosConfigurationDto } from './dto/create-store-pos-configuration.dto';
import { UpdateStorePosConfigurationDto } from './dto/update-store-pos-configuration.dto';

@Injectable()
export class StorePosConfigurationsService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private repository(): Repository<StorePosConfigurationEntity> {
    return this.merchants.requireDataSource().getRepository(StorePosConfigurationEntity);
  }

  /** Accepts a store UUID or a store code such as STORE-001. */
  private async storeUuid(storeKey: string): Promise<string> {
    const store = await this.merchants.getStoreById(storeKey);
    if (!store) throw new NotFoundException(`Store "${storeKey}" not found`);
    return store.id;
  }

  /**
   * Create a new POS configuration.
   */
  async create(
    dto: CreateStorePosConfigurationDto,
    actorId?: string,
  ): Promise<StorePosConfigurationEntity> {
    const storeId = await this.storeUuid(dto.storeId);
    const existing = await this.repository().findOne({
      where: {
        storeId,
        configurationName: dto.configurationName,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Configuration "${dto.configurationName}" already exists for this store.`,
      );
    }

    const actor = dto.createdBy || actorId || null;
    const configuration = this.repository().create({
      storeId,
      configurationName: dto.configurationName,
      configurationValue: dto.configurationValue,
      createdBy: actor,
      updatedBy: actor,
    });

    return this.repository().save(configuration);
  }

  /**
   * Get all configurations for a store.
   */
  async findByStoreId(
    storeId: string,
  ): Promise<StorePosConfigurationEntity[]> {
    const resolvedStoreId = await this.storeUuid(storeId);
    return this.repository().find({
      where: {
        storeId: resolvedStoreId,
      },
      order: {
        configurationName: 'ASC',
      },
    });
  }

  /**
   * Get one configuration by store ID and configuration name.
   */
  async findOne(
    storeId: string,
    configurationName: string,
  ): Promise<StorePosConfigurationEntity> {
    const resolvedStoreId = await this.storeUuid(storeId);
    const configuration = await this.repository().findOne({
      where: {
        storeId: resolvedStoreId,
        configurationName,
      },
    });

    if (!configuration) {
      throw new NotFoundException(
        `Configuration "${configurationName}" not found for store "${storeId}".`,
      );
    }

    return configuration;
  }

  /**
   * Get only configuration JSON by store ID and name.
   */
  async getConfigurationValue(
    storeId: string,
    configurationName: string,
  ): Promise<Record<string, unknown>> {
    const configuration = await this.findOne(
      storeId,
      configurationName,
    );

    return configuration.configurationValue;
  }

  /**
   * Update an existing configuration.
   */
  async update(
    storeId: string,
    configurationName: string,
    dto: UpdateStorePosConfigurationDto,
    actorId?: string,
  ): Promise<StorePosConfigurationEntity> {
    const configuration = await this.findOne(
      storeId,
      configurationName,
    );

    if (
      dto.configurationName &&
      dto.configurationName !== configurationName
    ) {
      const duplicate = await this.repository().findOne({
        where: {
          storeId: configuration.storeId,
          configurationName: dto.configurationName,
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Configuration "${dto.configurationName}" already exists for this store.`,
        );
      }

      configuration.configurationName = dto.configurationName;
    }

    if (dto.configurationValue !== undefined) {
      configuration.configurationValue = dto.configurationValue;
    }

    const actor = dto.updatedBy || actorId;
    if (actor) configuration.updatedBy = actor;

    return this.repository().save(configuration);
  }

  /**
   * Create or update configuration.
   *
   * This is useful for the frontend configuration screen.
   */
  async upsert(
    dto: CreateStorePosConfigurationDto,
    actorId?: string,
  ): Promise<StorePosConfigurationEntity> {
    const storeId = await this.storeUuid(dto.storeId);
    const existing = await this.repository().findOne({
      where: {
        storeId,
        configurationName: dto.configurationName,
      },
    });
    const actor = dto.createdBy || actorId || null;

    if (existing) {
      existing.configurationValue = dto.configurationValue;
      if (actor) existing.updatedBy = actor;

      return this.repository().save(existing);
    }

    const configuration = this.repository().create({
      storeId,
      configurationName: dto.configurationName,
      configurationValue: dto.configurationValue,
      createdBy: actor,
      updatedBy: actor,
    });

    return this.repository().save(configuration);
  }

  /**
   * Delete configuration.
   */
  async remove(
    storeId: string,
    configurationName: string,
  ): Promise<void> {
    const configuration = await this.findOne(
      storeId,
      configurationName,
    );

    await this.repository().remove(configuration);
  }
}
