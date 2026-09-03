const { Client } = require('pg');

async function initDb(dbName) {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'pdh_user',
    password: 'pdh_password',
    database: dbName,
  });

  try {
    await client.connect();
    console.log(`✅ Connected to PostgreSQL database: ${dbName}`);

    // 1. Create woocommerce_connections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS woocommerce_connections (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "storeUrl" VARCHAR(255) NOT NULL,
        "consumerKey" VARCHAR(255) NOT NULL,
        "consumerSecret" VARCHAR(255) NOT NULL,
        "webhookSecret" VARCHAR(255),
        "autoSyncInventory" BOOLEAN DEFAULT true,
        "syncStatus" VARCHAR(50) DEFAULT 'ACTIVE',
        "lastSyncedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create woocommerce_sync_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS woocommerce_sync_logs (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "eventType" VARCHAR(50) NOT NULL,
        "externalId" VARCHAR(100),
        status VARCHAR(50) DEFAULT 'SUCCESS',
        details TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Seed Demo Connection & Sync Logs
    await client.query(`
      INSERT INTO woocommerce_connections (id, "merchantId", "storeId", "storeUrl", "consumerKey", "consumerSecret", "webhookSecret", "autoSyncInventory", "syncStatus", "lastSyncedAt")
      VALUES ('WC-CONN-1001', 'MCH-1001', 'STR-5001', 'https://pch.alekyatechsolutions.com', 'ck_demo_982347102934812390', 'cs_demo_981234901238491023', 'secret_wc_hmac_991823', true, 'ACTIVE', CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO woocommerce_sync_logs (id, "merchantId", "storeId", "eventType", "externalId", status, details)
      VALUES ('LOG-WC-9001', 'MCH-1001', 'STR-5001', 'PRODUCT_UPDATED', '4501', 'SUCCESS', 'Received WooCommerce webhook event product.updated for Premium Organic Whole Milk 1 Gal')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO woocommerce_sync_logs (id, "merchantId", "storeId", "eventType", "externalId", status, details)
      VALUES ('LOG-WC-9002', 'MCH-1001', 'STR-5001', 'FULL_CATALOG_SYNC', 'ALL', 'SUCCESS', 'Synchronized 18 products from WooCommerce REST API')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Module 2 tables & demo rows seeded in ${dbName}!`);

    await client.end();
  } catch (err) {
    console.log(`⚠️ Database ${dbName} notice:`, err.message);
  }
}

async function main() {
  await initDb('pinaka_commerce_hub');
  await initDb('pinaka_delivery_hub');
}

main();
