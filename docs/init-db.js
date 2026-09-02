const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'pdh_user',
    password: 'pdh_password',
    database: 'pinaka_delivery_hub',
  });

  await client.connect();
  console.log('✅ Connected to PostgreSQL database: pinaka_delivery_hub');

  // 1. Create stores table
  await client.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id VARCHAR(100) PRIMARY KEY,
      "merchantId" VARCHAR(100) NOT NULL,
      "storeName" VARCHAR(255) NOT NULL,
      "storeCode" VARCHAR(50) UNIQUE NOT NULL,
      "storeType" VARCHAR(50) DEFAULT 'RETAIL',
      address JSONB NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      timezone VARCHAR(100) DEFAULT 'America/Chicago',
      "taxRate" DECIMAL(5,2) DEFAULT 8.25,
      "activationPin" VARCHAR(10) NOT NULL,
      "autoAcceptOrders" BOOLEAN DEFAULT true,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      "operationalStatus" VARCHAR(50) DEFAULT 'OPEN',
      channels JSONB DEFAULT '[]',
      "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Table created: stores');

  // 2. Create subscriptions table
  await client.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(100) PRIMARY KEY,
      "merchantId" VARCHAR(100) UNIQUE NOT NULL,
      "planCode" VARCHAR(50) DEFAULT 'PRO',
      "planName" VARCHAR(100) NOT NULL,
      "maxStoresAllowed" INT DEFAULT 3,
      entitlements JSONB NOT NULL,
      "billingCycle" VARCHAR(20) DEFAULT 'MONTHLY',
      price DECIMAL(10,2) DEFAULT 99.00,
      status VARCHAR(50) DEFAULT 'ACTIVE',
      "currentPeriodStart" TIMESTAMPTZ,
      "currentPeriodEnd" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Table created: subscriptions');

  // 3. Create onboarding_audit_logs table
  await client.query(`
    CREATE TABLE IF NOT EXISTS onboarding_audit_logs (
      id VARCHAR(100) PRIMARY KEY,
      "merchantId" VARCHAR(100) NOT NULL,
      "storeId" VARCHAR(100),
      action VARCHAR(100) NOT NULL,
      "performedBy" VARCHAR(255) NOT NULL,
      details JSONB DEFAULT '{}',
      "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Table created: onboarding_audit_logs');

  // 4. Seed Demo Stores & Subscriptions
  await client.query(`
    INSERT INTO stores (id, "merchantId", "storeName", "storeCode", "storeType", address, currency, timezone, "taxRate", "activationPin", status, "operationalStatus")
    VALUES ('STR-5001', 'MCH-1001', 'Fresh Mart - Downtown Branch', 'STR-DT-01', 'GROCERY', '{"street":"123 Main St","city":"Austin","state":"TX","zipCode":"78701","country":"USA"}', 'USD', 'America/Chicago', 8.25, '849201', 'ACTIVE', 'OPEN')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO stores (id, "merchantId", "storeName", "storeCode", "storeType", address, currency, timezone, "taxRate", "activationPin", status, "operationalStatus")
    VALUES ('STR-5234', 'MCH-1136', 'Green Leaf - North Plaza', 'STR-NL-01', 'GROCERY', '{"street":"456 North Blvd","city":"Austin","state":"TX","zipCode":"78758","country":"USA"}', 'USD', 'America/Chicago', 8.25, '967130', 'ACTIVE', 'OPEN')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO subscriptions (id, "merchantId", "planCode", "planName", "maxStoresAllowed", entitlements, "billingCycle", price, status)
    VALUES ('SUB-9001', 'MCH-1001', 'PRO', 'Pro Commerce Plan', 3, '["POS", "BARCODE_SCANNING", "UBER_EATS", "DOORDASH", "PAYROLL", "LOYALTY"]', 'MONTHLY', 99.00, 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO subscriptions (id, "merchantId", "planCode", "planName", "maxStoresAllowed", entitlements, "billingCycle", price, status)
    VALUES ('SUB-9002', 'MCH-1136', 'PRO', 'Pro Commerce Plan', 3, '["POS", "BARCODE_SCANNING", "UBER_EATS", "DOORDASH", "PAYROLL", "LOYALTY"]', 'MONTHLY', 99.00, 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('✅ Demo rows seeded for stores and subscriptions!');

  await client.end();
}

main().catch((err) => {
  console.error('❌ Error initializing database:', err.message);
  process.exit(1);
});
