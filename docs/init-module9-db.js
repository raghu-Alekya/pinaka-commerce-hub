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

    // 1. Create analytics_daily_snapshots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_daily_snapshots (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "dateString" VARCHAR(50) NOT NULL,
        "totalGrossSales" DECIMAL(10,2) DEFAULT 0.00,
        "totalNetSales" DECIMAL(10,2) DEFAULT 0.00,
        "totalOrdersCount" INT DEFAULT 0,
        "averageOrderValue" DECIMAL(10,2) DEFAULT 0.00,
        "totalTaxCollected" DECIMAL(10,2) DEFAULT 0.00,
        "totalDiscountsGiven" DECIMAL(10,2) DEFAULT 0.00,
        "channelBreakdown" JSONB NOT NULL,
        "topProducts" JSONB NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Seed Demo Analytics Snapshot
    await client.query(`
      INSERT INTO analytics_daily_snapshots (id, "merchantId", "storeId", "dateString", "totalGrossSales", "totalNetSales", "totalOrdersCount", "averageOrderValue", "totalTaxCollected", "totalDiscountsGiven", "channelBreakdown", "topProducts")
      VALUES ('SNAP-2026-09-03-STR-5001', 'MCH-1001', 'STR-5001', '2026-09-03', 2450.80, 2263.20, 48, 51.05, 187.60, 45.00, '{"IN_STORE_POS": 1450.00, "WOOCOMMERCE": 680.00, "DOORDASH": 220.80, "UBER_EATS": 100.00}', '[{"productId":"MILK-ORG-1G","productName":"Organic Whole Milk 1 Gal","unitsSold":34,"totalRevenue":186.66},{"productId":"ITEM-101","productName":"Cheeseburger Deluxe","unitsSold":28,"totalRevenue":419.72}]')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Module 9 analytics tables & snapshot rows seeded in ${dbName}!`);

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
