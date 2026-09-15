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
    port: Number(process.env.POSTGRES_PORT) || 5432,
    username: process.env.POSTGRES_USER || 'pdh_user',
    password: process.env.POSTGRES_PASSWORD || 'pdh_password',
    database: process.env.POSTGRES_DB || DEFAULT_POSTGRES_DB,
  };
}

function describeTarget(options: DataSourceOptions): string {
  if ('url' in options && options.url) return options.url.replace(/:[^:@/]+@/, ':****@');
  const opts = options as any;
  return `${opts.host || "localhost"}:${opts.port || 5432}/${opts.database || "pinaka_commerce_hub"}`;
}

const LEGACY_COLUMN_RENAMES: Array<{ table: string; from: string; to: string }> = [
  { table: 'stores', from: 'merchant_id', to: 'merchantId' },
  { table: 'stores', from: 'store_type_id', to: 'storeType' },
  { table: 'stores', from: 'store_code', to: 'storeCode' },
  { table: 'stores', from: 'name', to: 'storeName' },
  { table: 'stores', from: 'woocommerce_store_id', to: 'woocommerceStoreId' },
  { table: 'stores', from: 'created_at', to: 'createdAt' },
  { table: 'stores', from: 'updated_at', to: 'updatedAt' },
  { table: 'subscriptions', from: 'merchant_id', to: 'merchantId' },
  { table: 'subscriptions', from: 'subscription_code', to: 'subscriptionCode' },
  { table: 'subscriptions', from: 'plan_id', to: 'planId' },
  { table: 'subscriptions', from: 'start_date', to: 'startDate' },
  { table: 'subscriptions', from: 'renewal_date', to: 'renewalDate' },
  { table: 'subscriptions', from: 'trial_end_date', to: 'trialEndDate' },
  { table: 'subscriptions', from: 'licensed_store_count', to: 'licensedStoreCount' },
  { table: 'subscriptions', from: 'licensed_device_count', to: 'licensedDeviceCount' },
  { table: 'subscriptions', from: 'cancelled_at', to: 'cancelledAt' },
  { table: 'subscriptions', from: 'billing_cycle', to: 'billingCycle' },
  { table: 'subscriptions', from: 'created_at', to: 'createdAt' },
  { table: 'subscriptions', from: 'updated_at', to: 'updatedAt' },
  { table: 'plans', from: 'plan_code', to: 'planCode' },
  { table: 'plans', from: 'billing_model', to: 'billingModel' },
  { table: 'plans', from: 'base_price', to: 'basePrice' },
  { table: 'plans', from: 'billing_cycle', to: 'billingCycle' },
  { table: 'plans', from: 'created_at', to: 'createdAt' },
  { table: 'plans', from: 'updated_at', to: 'updatedAt' },
  { table: 'features', from: 'feature_key', to: 'featureKey' },
  { table: 'features', from: 'feature_type', to: 'featureType' },
  { table: 'features', from: 'created_at', to: 'createdAt' },
  { table: 'features', from: 'updated_at', to: 'updatedAt' },
  { table: 'store_types', from: 'store_type_code', to: 'storeTypeCode' },
  { table: 'store_types', from: 'created_at', to: 'createdAt' },
  { table: 'store_types', from: 'updated_at', to: 'updatedAt' },
];

async function columnExists(dataSource: DataSource, table: string, column: string): Promise<boolean> {
  const rows = await dataSource.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function tableExists(dataSource: DataSource, table: string): Promise<boolean> {
  const rows = await dataSource.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

/** Rename leftover snake_case columns to camelCase before TypeORM synchronize. */
async function alignLegacyCamelCaseColumns(dataSource: DataSource): Promise<void> {
  for (const { table, from, to } of LEGACY_COLUMN_RENAMES) {
    // A connector/order connection must never migrate merchant-owned tables.
    const entity = dataSource.entityMetadatas.find(metadata => metadata.tableName === table);
    if (!entity?.columns.some(column => column.databaseName === to)) continue;
    if (!(await tableExists(dataSource, table))) continue;
    const hasFrom = await columnExists(dataSource, table, from);
    const hasTo = await columnExists(dataSource, table, to);
    if (hasFrom && !hasTo) {
      await dataSource.query(`ALTER TABLE public."${table}" RENAME COLUMN "${from}" TO "${to}"`);
      continue;
    }
    if (hasFrom && hasTo) {
      await dataSource.query(
        `UPDATE public."${table}" SET "${to}" = "${from}" WHERE "${to}" IS NULL AND "${from}" IS NOT NULL`,
      );
    }
  }
}

async function backfillOptionalUniqueColumns(dataSource: DataSource): Promise<void> {
  if (!dataSource.entityMetadatas.some(metadata => metadata.tableName === 'subscriptions')) return;
  if (!(await tableExists(dataSource, 'subscriptions'))) return;
  if (await columnExists(dataSource, 'subscriptions', 'subscriptionCode')) {
    await dataSource.query(
      `UPDATE public.subscriptions SET "subscriptionCode" = id WHERE "subscriptionCode" IS NULL`,
    );
  }
}

function isRetryablePostgresError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|the database system is starting|timeout expired|Connection terminated/i.test(
    message,
  );
}

export async function connectPostgres(
  serviceName: string,
  entities: DataSourceOptions['entities'],
  settings: { synchronize?: boolean } = {},
): Promise<DataSource> {
  const options = { ...postgresConnectionOptions(entities), ...settings };
  const attempts = Number(process.env.POSTGRES_CONNECT_ATTEMPTS) || 20;
  const delayMs = Number(process.env.POSTGRES_CONNECT_RETRY_MS) || 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const dataSource = new DataSource({ ...options, synchronize: false });
    try {
      await dataSource.initialize();
      if (options.synchronize) {
        // Repositories initialize concurrently, including across service processes.
        // Keep a dedicated connection so the session lock covers every schema query.
        const schemaLock = dataSource.createQueryRunner();
        await schemaLock.connect();
        try {
          await schemaLock.query('SELECT pg_advisory_lock(724621, 1)');
          try {
            await alignLegacyCamelCaseColumns(dataSource);
            await backfillOptionalUniqueColumns(dataSource);
            await dataSource.synchronize();
          } finally {
            await schemaLock.query('SELECT pg_advisory_unlock(724621, 1)');
          }
        } finally {
          await schemaLock.release();
        }
      }
      console.log(`🐘 [${serviceName}] Connected to PostgreSQL ${describeTarget(options)}`);
      return dataSource;
    } catch (error: unknown) {
      lastError = error;
      if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
      if (attempt < attempts && isRetryablePostgresError(error)) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${serviceName} failed to initialize PostgreSQL at ${describeTarget(options)}: ${message}`,
  );
}

export interface DatabaseClient {
  connect(): Promise<void>;
}
