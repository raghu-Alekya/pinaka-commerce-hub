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

    // 1. Create pos_shifts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_shifts (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "terminalId" VARCHAR(100) NOT NULL,
        "cashierName" VARCHAR(150) NOT NULL,
        "openingCash" DECIMAL(10,2) DEFAULT 200.00,
        "totalCashSales" DECIMAL(10,2) DEFAULT 0.00,
        "totalCardSales" DECIMAL(10,2) DEFAULT 0.00,
        "totalSafeDrops" DECIMAL(10,2) DEFAULT 0.00,
        "totalPaidOuts" DECIMAL(10,2) DEFAULT 0.00,
        "closingCashActual" DECIMAL(10,2),
        "expectedCashInDrawer" DECIMAL(10,2),
        discrepancy DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'OPEN',
        "openedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "closedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log(`✅ Table created/verified: pos_shifts in ${dbName}`);

    // 2. Create cash_movements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id VARCHAR(100) PRIMARY KEY,
        "shiftId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "movementType" VARCHAR(50) DEFAULT 'SAFE_DROP',
        amount DECIMAL(10,2) NOT NULL,
        "performedBy" VARCHAR(255) NOT NULL,
        reason VARCHAR(255),
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log(`✅ Table created/verified: cash_movements in ${dbName}`);

    // 3. Seed Demo Shift & Movement
    await client.query(`
      INSERT INTO pos_shifts (id, "merchantId", "storeId", "terminalId", "cashierName", "openingCash", "totalSafeDrops", status, "openedAt")
      VALUES ('SHIFT-8001', 'MCH-1001', 'STR-5001', 'SUNMI-D3-PRO-01', 'Sarah Jenkins', 200.00, 500.00, 'OPEN', CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO cash_movements (id, "shiftId", "storeId", "movementType", amount, "performedBy", reason)
      VALUES ('CSH-9001', 'SHIFT-8001', 'STR-5001', 'SAFE_DROP', 500.00, 'Manager Alex', 'Drawer Exceeded Limit ($1,000)')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Demo shift & cash movement rows seeded in ${dbName}!`);

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
