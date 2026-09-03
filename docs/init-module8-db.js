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

    // 1. Create customers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "fullName" VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(150),
        "loyaltyTier" VARCHAR(50) DEFAULT 'BRONZE',
        "rewardPointsBalance" INT DEFAULT 0,
        "totalSpent" DECIMAL(10,2) DEFAULT 0.00,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create promotions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS promotions (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "promoCode" VARCHAR(50) UNIQUE NOT NULL,
        "discountType" VARCHAR(50) DEFAULT 'PERCENTAGE',
        "discountValue" DECIMAL(10,2) NOT NULL,
        "minOrderAmount" DECIMAL(10,2) DEFAULT 0.00,
        "maxDiscountAmount" DECIMAL(10,2),
        "usageLimit" INT DEFAULT 1000,
        "usedCount" INT DEFAULT 0,
        "isActive" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Create loyalty_point_transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
        id VARCHAR(100) PRIMARY KEY,
        "customerId" VARCHAR(100) NOT NULL,
        "orderId" VARCHAR(100),
        "transactionType" VARCHAR(50) DEFAULT 'EARNED',
        points INT NOT NULL,
        "newBalance" INT NOT NULL,
        description VARCHAR(255),
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Seed Demo Customer & Promotion
    await client.query(`
      INSERT INTO customers (id, "merchantId", "fullName", phone, email, "loyaltyTier", "rewardPointsBalance", "totalSpent")
      VALUES ('CUST-5001', 'MCH-1001', 'David Miller', '+1 (555) 019-2831', 'david.miller@gmail.com', 'GOLD', 392, 522.50)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO promotions (id, "merchantId", "storeId", "promoCode", "discountType", "discountValue", "minOrderAmount", "usageLimit", "usedCount", "isActive")
      VALUES ('PROMO-9001', 'MCH-1001', 'STR-5001', 'WELCOME10', 'PERCENTAGE', 10.00, 20.00, 500, 12, true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO loyalty_point_transactions (id, "customerId", "orderId", "transactionType", points, "newBalance", description)
      VALUES ('TXN-LOY-9001', 'CUST-5001', 'ORD-89227', 'EARNED', 42, 392, 'Earned 42 points on Order #ORD-89227')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Module 8 tables & demo loyalty rows seeded in ${dbName}!`);

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
