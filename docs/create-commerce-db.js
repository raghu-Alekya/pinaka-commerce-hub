const { Client } = require('pg');

async function main() {
  // 1. Connect to root postgres database to create pinaka_commerce_hub
  const rootClient = new Client({
    host: 'localhost',
    port: 5432,
    user: 'pdh_user',
    password: 'pdh_password',
    database: 'postgres',
  });

  await rootClient.connect();
  console.log('✅ Connected to root PostgreSQL server');

  // Create database pinaka_commerce_hub if not exists
  try {
    await rootClient.query('CREATE DATABASE pinaka_commerce_hub;');
    console.log('🎉 Created Database: pinaka_commerce_hub');
  } catch (err) {
    if (err.code === '42P04') {
      console.log('ℹ️ Database pinaka_commerce_hub already exists.');
    } else {
      console.log('⚠️ Notice during DB creation:', err.message);
    }
  }
  await rootClient.end();

  // 2. Connect to pinaka_commerce_hub Database and create all tables
  const dbClient = new Client({
    host: 'localhost',
    port: 5432,
    user: 'pdh_user',
    password: 'pdh_password',
    database: 'pinaka_commerce_hub',
  });

  await dbClient.connect();
  console.log('✅ Connected to database: pinaka_commerce_hub');

  // Merchants Table
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      id VARCHAR(100) PRIMARY KEY,
      "businessName" VARCHAR(255) NOT NULL,
      "businessType" VARCHAR(50) DEFAULT 'RETAIL',
      "ownerName" VARCHAR(150) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      "taxId" VARCHAR(100),
      "kycStatus" VARCHAR(50) DEFAULT 'PENDING',
      "kycDocuments" JSONB DEFAULT '[]',
      status VARCHAR(50) DEFAULT 'PENDING',
      "onboardingStep" VARCHAR(50) DEFAULT 'STEP1_BUSINESS',
      "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ Table created: merchants');

  // Stores Table
  await dbClient.query(`
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

  // Subscriptions Table
  await dbClient.query(`
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

  // Audit Logs Table
  await dbClient.query(`
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

  // Seed Initial Merchants, Stores & Subscriptions
  await dbClient.query(`
    INSERT INTO merchants (id, "businessName", "businessType", "ownerName", email, phone, "taxId", "kycStatus", status, "onboardingStep")
    VALUES ('MCH-1001', 'Fresh Mart Organics LLC', 'GROCERY', 'Alex Johnson', 'alex@freshmart.com', '+1 (555) 234-5678', '12-3456789', 'VERIFIED', 'ACTIVE', 'COMPLETED')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO merchants (id, "businessName", "businessType", "ownerName", email, phone, "taxId", "kycStatus", status, "onboardingStep")
    VALUES ('MCH-1136', 'Green Leaf Supermarket LLC', 'GROCERY', 'Sarah Jenkins', 'sarah.jenkins@greenleaf.com', '+1 (555) 789-0123', '98-7654321', 'VERIFIED', 'ACTIVE', 'COMPLETED')
    ON CONFLICT (id) DO NOTHING;

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
  console.log('✅ Demo rows seeded in pinaka_commerce_hub!');

  await dbClient.end();
}

main().catch((err) => {
  console.error('❌ Error creating pinaka_commerce_hub DB:', err.message);
  process.exit(1);
});
