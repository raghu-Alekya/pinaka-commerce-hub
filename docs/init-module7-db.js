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

    // 1. Create orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY,
        "orderNumber" VARCHAR(100) NOT NULL,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "shiftId" VARCHAR(100),
        "customerName" VARCHAR(150) DEFAULT 'Walk-in Customer',
        "customerPhone" VARCHAR(50),
        "orderType" VARCHAR(50) DEFAULT 'IN_STORE_POS',
        "paymentMethod" VARCHAR(50) DEFAULT 'CASH',
        "paymentStatus" VARCHAR(50) DEFAULT 'PAID',
        subtotal DECIMAL(10,2) NOT NULL,
        "taxAmount" DECIMAL(10,2) DEFAULT 0.00,
        "discountAmount" DECIMAL(10,2) DEFAULT 0.00,
        "tipAmount" DECIMAL(10,2) DEFAULT 0.00,
        "totalAmount" DECIMAL(10,2) NOT NULL,
        "orderStatus" VARCHAR(50) DEFAULT 'CREATED',
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create order_line_items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_line_items (
        id VARCHAR(100) PRIMARY KEY,
        "orderId" VARCHAR(100) NOT NULL,
        "productId" VARCHAR(100) NOT NULL,
        "productName" VARCHAR(255) NOT NULL,
        quantity DECIMAL(10,2) NOT NULL,
        "unitPrice" DECIMAL(10,2) NOT NULL,
        "totalPrice" DECIMAL(10,2) NOT NULL,
        modifiers JSONB
      );
    `);

    // 3. Create order_status_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_status_history (
        id VARCHAR(100) PRIMARY KEY,
        "orderId" VARCHAR(100) NOT NULL,
        "fromStatus" VARCHAR(50) NOT NULL,
        "toStatus" VARCHAR(50) NOT NULL,
        "changedBy" VARCHAR(150) NOT NULL,
        reason VARCHAR(255),
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Seed Demo Orders & Line Items
    await client.query(`
      INSERT INTO orders (id, "orderNumber", "merchantId", "storeId", "shiftId", "customerName", "customerPhone", "orderType", "paymentMethod", "paymentStatus", subtotal, "taxAmount", "totalAmount", "orderStatus")
      VALUES ('ORD-89227', '#1056', 'MCH-1001', 'STR-5001', 'SHIFT-8001', 'James Wilson', '+1 (555) 444-3333', 'IN_STORE_POS', 'CASH', 'PAID', 25.97, 2.14, 28.11, 'COMPLETED')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO order_line_items (id, "orderId", "productId", "productName", quantity, "unitPrice", "totalPrice")
      VALUES ('ITEM-ORD-89227-1', 'ORD-89227', 'MILK-ORG-1G', 'Organic Whole Milk 1 Gal', 2, 5.49, 10.98)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO order_line_items (id, "orderId", "productId", "productName", quantity, "unitPrice", "totalPrice")
      VALUES ('ITEM-ORD-89227-2', 'ORD-89227', 'ITEM-101', 'Cheeseburger Deluxe', 1, 14.99, 14.99)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO order_status_history (id, "orderId", "fromStatus", "toStatus", "changedBy", reason)
      VALUES ('HST-9001', 'ORD-89227', 'NONE', 'CREATED', 'POS System', 'Initial Order Creation')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO order_status_history (id, "orderId", "fromStatus", "toStatus", "changedBy", reason)
      VALUES ('HST-9002', 'ORD-89227', 'CREATED', 'CONFIRMED', 'POS KDS System', 'Order Verified')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO order_status_history (id, "orderId", "fromStatus", "toStatus", "changedBy", reason)
      VALUES ('HST-9003', 'ORD-89227', 'CONFIRMED', 'COMPLETED', 'Cashier Sarah', 'Items Bagged & Handed')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Module 7 tables & demo order rows seeded in ${dbName}!`);

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
