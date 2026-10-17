import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { postgresConnectionOptions } from '@pinaka-delivery-hub/database';

@Injectable()
export class DashboardDatabase implements OnApplicationShutdown {
  private readonly dataSource = new DataSource({
    ...postgresConnectionOptions([]),
    synchronize: false,
  });
  private initialization?: Promise<DataSource>;

  getConnection(): Promise<DataSource> {
    if (this.dataSource.isInitialized) return Promise.resolve(this.dataSource);
    if (!this.initialization) {
      this.initialization = this.dataSource.initialize().catch(error => {
        this.initialization = undefined;
        throw new ServiceUnavailableException(
          'Dashboard database is unavailable. Check the local PostgreSQL service and database settings.',
          { cause: error },
        );
      });
    }
    return this.initialization;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
