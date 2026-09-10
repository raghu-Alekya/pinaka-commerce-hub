import { DataSource, type DataSourceOptions } from 'typeorm';

export const DEFAULT_POSTGRES_DB = 'pinaka_commerce_hub';

export function postgresConnectionOptions(
  entities: DataSourceOptions['entities'],
): DataSourceOptions {
  const synchronize = process.env.TYPEORM_SYNCHRONIZE !== 'false';
  const shared = {
    type: 'postgres' as const,
    entities,
    synchronize,
    logging: process.env.TYPEORM_LOGGING === 'true',
  };

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const useDiscrete =
    Boolean(process.env.POSTGRES_HOST || process.env.POSTGRES_DB || process.env.POSTGRES_USER);

  if (databaseUrl && !useDiscrete) {
    return { ...shared, url: databaseUrl };
  }

  return {
    ...shared,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5433,
    username: process.env.POSTGRES_USER || 'pdh_user',
    password: process.env.POSTGRES_PASSWORD || 'pdh_password',
    database: process.env.POSTGRES_DB || DEFAULT_POSTGRES_DB,
  };
}

function describeTarget(options: DataSourceOptions): string {
  if ('url' in options && options.url) return options.url.replace(/:[^:@/]+@/, ':****@');
  return `${options.host}:${options.port}/${options.database}`;
}

export async function connectPostgres(
  serviceName: string,
  entities: DataSourceOptions['entities'],
): Promise<DataSource> {
  const options = postgresConnectionOptions(entities);
  const attempts = Number(process.env.POSTGRES_CONNECT_ATTEMPTS) || 20;
  const delayMs = Number(process.env.POSTGRES_CONNECT_RETRY_MS) || 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const dataSource = new DataSource(options);
    try {
      await dataSource.initialize();
      console.log(`🐘 [${serviceName}] Connected to PostgreSQL ${describeTarget(options)}`);
      return dataSource;
    } catch (error: unknown) {
      lastError = error;
      if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${serviceName} requires Docker PostgreSQL (local or VPS). Run "docker compose up -d" and open pgAdmin at http://localhost:5050. ${message}`,
  );
}

export interface DatabaseClient {
  connect(): Promise<void>;
}
