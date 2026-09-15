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
  { table: 'permissions', from: 'feature_id', to: 'featureId' },
  { table: 'permissions', from: 'permission_key', to: 'permissionKey' },
  { table: 'permissions', from: 'created_at', to: 'createdAt' },
  { table: 'permissions', from: 'updated_at', to: 'updatedAt' },
  { table: 'role_templates', from: 'role_code', to: 'roleCode' },
  { table: 'role_templates', from: 'scope_type', to: 'scopeType' },
  { table: 'role_templates', from: 'created_at', to: 'createdAt' },
  { table: 'role_templates', from: 'updated_at', to: 'updatedAt' },
  { table: 'roles', from: 'merchant_id', to: 'merchantId' },
  { table: 'roles', from: 'source_role_template_id', to: 'sourceRoleTemplateId' },
  { table: 'roles', from: 'role_code', to: 'roleCode' },
  { table: 'roles', from: 'scope_type', to: 'scopeType' },
  { table: 'roles', from: 'is_custom', to: 'isCustom' },
  { table: 'roles', from: 'created_at', to: 'createdAt' },
  { table: 'roles', from: 'updated_at', to: 'updatedAt' },
  { table: 'employees', from: 'merchant_id', to: 'merchantId' },
  { table: 'employees', from: 'employee_code', to: 'employeeCode' },
  { table: 'employees', from: 'first_name', to: 'firstName' },
  { table: 'employees', from: 'last_name', to: 'lastName' },
  { table: 'employees', from: 'created_at', to: 'createdAt' },
  { table: 'employees', from: 'updated_at', to: 'updatedAt' },
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
): Promise<DataSource> {
  const options = postgresConnectionOptions(entities);
  const attempts = Number(process.env.POSTGRES_CONNECT_ATTEMPTS) || 20;
  const delayMs = Number(process.env.POSTGRES_CONNECT_RETRY_MS) || 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const dataSource = new DataSource({ ...options, synchronize: false });
    try {
      await dataSource.initialize();
      await alignLegacyCamelCaseColumns(dataSource);
      await backfillOptionalUniqueColumns(dataSource);
      if (options.synchronize) {
        await dataSource.synchronize();
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
    `${serviceName} requires Docker PostgreSQL (local or VPS). Run "docker compose up -d" and open pgAdmin at http://localhost:5050. ${message}`,
  );
}

export interface DatabaseClient {
  connect(): Promise<void>;
}
