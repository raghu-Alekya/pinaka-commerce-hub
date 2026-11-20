const { Client } = require('pg');

async function initDb(dbName) {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'pdh_user',
    password: process.env.POSTGRES_PASSWORD || 'pdh_password',
    database: dbName,
  });

  try {
    await client.connect();
    console.log(`✅ Connected to PostgreSQL database: ${dbName}`);

    // 1. Create pos_shifts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_shifts (
        id VARCHAR(100) PRIMARY KEY,
        merchant_id VARCHAR(100) NOT NULL,
        store_id VARCHAR(100) NOT NULL,
        device_id VARCHAR(100) NOT NULL,
        opening_device_id VARCHAR(100),
        closing_device_id VARCHAR(100),
        created_by VARCHAR(100),
        updated_by VARCHAR(100),
        closed_by VARCHAR(100),
        status VARCHAR(50) DEFAULT 'OPEN',
        opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        closing_balance DECIMAL(12,2),
        over_short DECIMAL(12,2),
        declared_cash DECIMAL(12,2),
        discrepancy DECIMAL(12,2),
        opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS closing_balance DECIMAL(12,2);
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS over_short DECIMAL(12,2);
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS closed_by VARCHAR(100);
      ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS closing_device_id VARCHAR(100);
    `);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'pos_shifts'
            AND column_name = 'cashier_name' AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE pos_shifts ALTER COLUMN cashier_name DROP NOT NULL;
        END IF;
      END $$;
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

    // 3. Seed two complete demo shifts and a cash movement
    await client.query(`
      INSERT INTO pos_shifts (
        id, merchant_id, store_id, device_id, opening_device_id, closing_device_id,
        created_by, closed_by, status, opening_balance, closing_balance,
        over_short, declared_cash, discrepancy, opened_at, closed_at, created_at, updated_at
      )
      VALUES
        (
          'SHIFT-8001', 'MCH-1001', 'STR-5001', 'SUNMI-D3-PRO-01',
          '81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001',
          '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001',
          'CLOSED', 200.00, 695.00, -5.00, 695.00, -5.00,
          CURRENT_TIMESTAMP - INTERVAL '8 hours', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          'SHIFT-8002', 'MCH-1001', 'STR-5001', 'SUNMI-D3-PRO-02',
          '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002',
          '82000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002',
          'CLOSED', 300.00, 680.00, 0.00, 680.00, 0.00,
          CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      ON CONFLICT (id) DO UPDATE SET
        merchant_id = EXCLUDED.merchant_id,
        store_id = EXCLUDED.store_id,
        device_id = EXCLUDED.device_id,
        opening_device_id = EXCLUDED.opening_device_id,
        closing_device_id = EXCLUDED.closing_device_id,
        created_by = EXCLUDED.created_by,
        closed_by = EXCLUDED.closed_by,
        opening_balance = EXCLUDED.opening_balance,
        closing_balance = EXCLUDED.closing_balance,
        over_short = EXCLUDED.over_short,
        declared_cash = EXCLUDED.declared_cash,
        discrepancy = EXCLUDED.discrepancy,
        status = EXCLUDED.status,
        opened_at = EXCLUDED.opened_at,
        closed_at = EXCLUDED.closed_at,
        updated_at = EXCLUDED.updated_at;

      INSERT INTO cash_movements (id, "shiftId", "storeId", "movementType", amount, "performedBy", reason)
      VALUES ('CSH-9001', 'SHIFT-8001', 'STR-5001', 'SAFE_DROP', 500.00, 'Manager Alex', 'Drawer Exceeded Limit ($1,000)')
      ON CONFLICT (id) DO NOTHING;
    `);
    const { rows: seededShifts } = await client.query(`
      SELECT id, merchant_id, store_id, opening_balance, status
      FROM pos_shifts
      WHERE id = ANY($1)
      ORDER BY id
    `, [['SHIFT-8001', 'SHIFT-8002']]);
    console.log(`✅ Demo shift & cash movement rows in ${dbName}:`, seededShifts);

    await client.end();
  } catch (err) {
    console.error(`Failed to initialize database ${dbName}:`, err.message);
    process.exitCode = 1;
  }
}

async function main() {
  await initDb(process.env.POSTGRES_DB || 'pinaka_commerce_hub_new');
}

main();
