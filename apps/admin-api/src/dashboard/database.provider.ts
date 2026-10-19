import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { SessionEntity } from '@pinaka-delivery-hub/auth';

@Injectable()
export class AdminDatabase implements OnModuleInit, OnModuleDestroy {
  dataSource!: DataSource;

  async onModuleInit(): Promise<void> {
    this.dataSource = await connectPostgres(
      'Admin API DB',
      [SessionEntity],
      { synchronize: false },
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }
}
