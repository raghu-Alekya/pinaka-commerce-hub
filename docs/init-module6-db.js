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

    // 1. Create delivery_channel_configs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_channel_configs (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        channel VARCHAR(50) NOT NULL,
        "externalStoreId" VARCHAR(100) NOT NULL,
        "webhookSecret" VARCHAR(255),
        "autoAccept" BOOLEAN DEFAULT true,
        "defaultPrepTimeMinutes" INT DEFAULT 20,
        "isEnabled" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create delivery_order_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_order_logs (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        channel VARCHAR(50) NOT NULL,
        "externalOrderId" VARCHAR(100) NOT NULL,
        "customerName" VARCHAR(150) NOT NULL,
        "customerPhone" VARCHAR(50),
        "deliveryAddress" JSONB NOT NULL,
        "driverName" VARCHAR(150),
        "driverPhone" VARCHAR(50),
        "prepTimeMinutes" INT DEFAULT 20,
        "deliveryFee" DECIMAL(10,2) DEFAULT 3.99,
        "totalAmount" DECIMAL(10,2) NOT NULL,
        "orderItems" JSONB NOT NULL,
        status VARCHAR(50) DEFAULT 'RECEIVED',
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Seed Demo Channels & Orders
    await client.query(`
      INSERT INTO delivery_channel_configs (id, "merchantId", "storeId", channel, "externalStoreId", "webhookSecret", "autoAccept", "defaultPrepTimeMinutes", "isEnabled")
      VALUES ('CHAN-6001', 'MCH-1001', 'STR-5001', 'DOORDASH', 'DD-STORE-99', 'secret_dd_key_882', true, 20, true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO delivery_channel_configs (id, "merchantId", "storeId", channel, "externalStoreId", "webhookSecret", "autoAccept", "defaultPrepTimeMinutes", "isEnabled")
      VALUES ('CHAN-6002', 'MCH-1001', 'STR-5001', 'UBER_EATS', 'UBER-STORE-44', 'secret_uber_key_551', true, 15, true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO delivery_order_logs (id, "merchantId", "storeId", channel, "externalOrderId", "customerName", "customerPhone", "deliveryAddress", "driverName", "driverPhone", "prepTimeMinutes", "deliveryFee", "totalAmount", "orderItems", status)
      VALUES ('DEL-40404', 'MCH-1001', 'STR-5001', 'DOORDASH', 'DD-ORDER-99120', 'Robert Taylor', '+1 (555) 234-5678', '{"street":"789 Oak Ave", "city":"Austin", "state":"TX"}', 'David (DoorDash)', '+1 (555) 999-1111', 25, 3.99, 42.50, '[{"name":"Organic Whole Milk","qty":1,"price":5.49},{"name":"Cheeseburger Deluxe","qty":2,"price":14.99}]', 'ACCEPTED')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Module 6 tables & demo rows seeded in ${dbName}!`);

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
