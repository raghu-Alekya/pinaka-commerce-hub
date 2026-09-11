const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { DataSource } = require('typeorm');

const root = resolve(__dirname, '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const db = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || undefined,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  username: process.env.POSTGRES_USER || 'pdh_user',
  password: process.env.POSTGRES_PASSWORD || 'pdh_password',
  database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
  synchronize: false,
});

async function main() {
  try {
    await db.initialize();
    await db.transaction(async manager => {
      for (const file of ['merchant-onboarding-postgres.sql', 'subscription-plan-master.sql', 'devices.sql']) {
        await manager.query(readFileSync(resolve(root, 'docs', file), 'utf8'));
      }
    });
    console.log('Merchant database schema is ready. Restart merchant-service to use PostgreSQL.');
  } finally {
    if (db.isInitialized) await db.destroy();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
