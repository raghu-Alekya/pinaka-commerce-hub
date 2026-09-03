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

    // 1. Create inventory_items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "productId" VARCHAR(100) NOT NULL,
        "productName" VARCHAR(255) NOT NULL,
        "quantityOnHand" DECIMAL(10,2) DEFAULT 0.00,
        "quantityReserved" DECIMAL(10,2) DEFAULT 0.00,
        "quantityAvailable" DECIMAL(10,2) DEFAULT 0.00,
        "reorderPoint" DECIMAL(10,2) DEFAULT 10.00,
        "unitCost" DECIMAL(10,2) DEFAULT 0.00,
        "unitPrice" DECIMAL(10,2) DEFAULT 0.00,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log(`✅ Table created/verified: inventory_items in ${dbName}`);

    // 2. Create inventory_adjustments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id VARCHAR(100) PRIMARY KEY,
        "storeId" VARCHAR(100) NOT NULL,
        "productId" VARCHAR(100) NOT NULL,
        "adjustmentType" VARCHAR(50) DEFAULT 'POS_SALE',
        "quantityChanged" DECIMAL(10,2) NOT NULL,
        "newQuantityAvailable" DECIMAL(10,2) NOT NULL,
        "performedBy" VARCHAR(255) NOT NULL,
        reason VARCHAR(255),
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log(`✅ Table created/verified: inventory_adjustments in ${dbName}`);

    // 3. Seed Demo Stock Ledger Rows
    await client.query(`
      INSERT INTO inventory_items (id, "merchantId", "storeId", "productId", "productName", "quantityOnHand", "quantityReserved", "quantityAvailable", "reorderPoint", "unitCost", "unitPrice")
      VALUES ('INV-7001', 'MCH-1001', 'STR-5001', 'MILK-ORG-1G', 'Organic Whole Milk 1 Gal', 72.00, 0.00, 72.00, 10.00, 3.20, 5.49)
      ON CONFLICT (id) DO UPDATE SET "quantityAvailable" = 72.00;

      INSERT INTO inventory_items (id, "merchantId", "storeId", "productId", "productName", "quantityOnHand", "quantityReserved", "quantityAvailable", "reorderPoint", "unitCost", "unitPrice")
      VALUES ('INV-7002', 'MCH-1001', 'STR-5001', '4131', 'Gala Apples (Fresh Produce)', 100.00, 0.00, 100.00, 20.00, 0.85, 1.99)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO inventory_adjustments (id, "storeId", "productId", "adjustmentType", "quantityChanged", "newQuantityAvailable", "performedBy", reason)
      VALUES ('ADJ-9001', 'STR-5001', 'MILK-ORG-1G', 'POS_SALE', -2.00, 48.00, 'Sunmi POS Terminal #1', 'Customer Purchase Receipt #10088')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO inventory_adjustments (id, "storeId", "productId", "adjustmentType", "quantityChanged", "newQuantityAvailable", "performedBy", reason)
      VALUES ('ADJ-9002', 'STR-5001', 'MILK-ORG-1G', 'REPLENISHMENT', 24.00, 72.00, 'Inventory Manager Alex', 'Supplier Restock PO #4402')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Demo stock rows seeded in ${dbName}!`);

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
