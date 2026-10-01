import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { MerchantRepository } from '../../merchant.repository';
import { StorePosConfigurationEntity } from '../../entities/store-pos-configuration.entity';
import { CreateStorePosConfigurationDto } from './dto/create-store-pos-configuration.dto';
import { UpdateStorePosConfigurationDto } from './dto/update-store-pos-configuration.dto';

@Injectable()
export class StorePosConfigurationsService {
  constructor(@Inject(MerchantRepository) private readonly merchants: MerchantRepository) {}

  private repository(): Repository<StorePosConfigurationEntity> {
    return this.merchants.requireDataSource().getRepository(StorePosConfigurationEntity);
  }

  /**
   * Create a new POS configuration.
   */
  async create(
    dto: CreateStorePosConfigurationDto,
  ): Promise<StorePosConfigurationEntity> {
    const existing = await this.repository().findOne({
      where: {
        storeId: dto.storeId,
        configurationName: dto.configurationName,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Configuration "${dto.configurationName}" already exists for this store.`,
      );
    }

    const configuration = this.repository().create({
      storeId: dto.storeId,
      configurationName: dto.configurationName,
      configurationValue: dto.configurationValue,
    });

    return this.repository().save(configuration);
  }

  /**
   * Get all configurations for a store.
   */
  async findByStoreId(
    storeId: string,
  ): Promise<StorePosConfigurationEntity[]> {
    return this.repository().find({
      where: {
        storeId,
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
    const configuration = await this.repository().findOne({
      where: {
        storeId,
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
          storeId,
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

    return this.repository().save(configuration);
  }

  /**
   * Create or update configuration.
   *
   * This is useful for the frontend configuration screen.
   */
  async upsert(
    dto: CreateStorePosConfigurationDto,
  ): Promise<StorePosConfigurationEntity> {
    const existing = await this.repository().findOne({
      where: {
        storeId: dto.storeId,
        configurationName: dto.configurationName,
      },
    });

    if (existing) {
      existing.configurationValue = dto.configurationValue;

      return this.repository().save(existing);
    }

    const configuration = this.repository().create(dto);

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
