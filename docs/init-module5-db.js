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
        register_id UUID,
        device_id VARCHAR(100) NOT NULL,
        opening_device_id UUID,
        opened_by_employee_id UUID,
        closed_by_employee_id UUID,
        shift_number VARCHAR(100),
        cashier_name VARCHAR(150) NOT NULL,
        opening_cash DECIMAL(10,2) DEFAULT 200.00,
        total_cash_sales DECIMAL(10,2) DEFAULT 0.00,
        total_card_sales DECIMAL(10,2) DEFAULT 0.00,
        total_safe_drops DECIMAL(10,2) DEFAULT 0.00,
        total_paid_outs DECIMAL(10,2) DEFAULT 0.00,
        drawer_denominations JSONB,
        drawer_total_amount DECIMAL(12,2),
        tube_denominations JSONB,
        tube_total_amount DECIMAL(12,2),
        total_amount DECIMAL(12,2),
        closing_cash_actual DECIMAL(10,2),
        expected_cash_in_drawer DECIMAL(10,2),
        declared_cash DECIMAL(10,2),
        cash_difference DECIMAL(10,2),
        discrepancy DECIMAL(10,2),
        opening_note TEXT,
        closing_note TEXT,
        status VARCHAR(50) DEFAULT 'OPEN',
        opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE pos_shifts
      ADD COLUMN IF NOT EXISTS register_id UUID;
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
        id, merchant_id, store_id, register_id, device_id,
        opening_device_id, opened_by_employee_id, closed_by_employee_id,
        shift_number, cashier_name, opening_cash, total_cash_sales,
        total_card_sales, total_safe_drops, total_paid_outs,
        expected_cash_in_drawer, declared_cash, closing_cash_actual,
        cash_difference, discrepancy, opening_note, closing_note,
        status, opened_at, closed_at, created_at, updated_at
      )
      VALUES
        (
          'SHIFT-8001', 'MCH-1001', 'STR-5001',
          '80000000-0000-4000-8000-000000000001',
          'SUNMI-D3-PRO-01', '81000000-0000-4000-8000-000000000001',
          '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001',
          'SHF001', 'Sarah Jenkins', 200.00, 1000.00, 250.00, 500.00, 0.00,
          700.00, 695.00, 695.00, -5.00, -5.00,
          'Opening float counted: $200.00', 'Cash short by $5.00 at close',
          'CLOSED', CURRENT_TIMESTAMP - INTERVAL '8 hours', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          'SHIFT-8002', 'MCH-1001', 'STR-5001',
          '80000000-0000-4000-8000-000000000002',
          'SUNMI-D3-PRO-02', '81000000-0000-4000-8000-000000000002',
          '82000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002',
          'SHF002', 'Alex Morgan', 300.00, 500.00, 100.00, 100.00, 20.00,
          680.00, 680.00, 680.00, 0.00, 0.00,
          'Opening float counted: $300.00', 'Drawer counted and balanced',
          'CLOSED', CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      ON CONFLICT (id) DO UPDATE SET
        merchant_id = EXCLUDED.merchant_id,
        store_id = EXCLUDED.store_id,
        register_id = EXCLUDED.register_id,
        device_id = EXCLUDED.device_id,
        opening_device_id = EXCLUDED.opening_device_id,
        opened_by_employee_id = EXCLUDED.opened_by_employee_id,
        closed_by_employee_id = EXCLUDED.closed_by_employee_id,
        shift_number = EXCLUDED.shift_number,
        cashier_name = EXCLUDED.cashier_name,
        opening_cash = EXCLUDED.opening_cash,
        total_cash_sales = EXCLUDED.total_cash_sales,
        total_card_sales = EXCLUDED.total_card_sales,
        total_safe_drops = EXCLUDED.total_safe_drops,
        total_paid_outs = EXCLUDED.total_paid_outs,
        expected_cash_in_drawer = EXCLUDED.expected_cash_in_drawer,
        declared_cash = EXCLUDED.declared_cash,
        closing_cash_actual = EXCLUDED.closing_cash_actual,
        cash_difference = EXCLUDED.cash_difference,
        discrepancy = EXCLUDED.discrepancy,
        opening_note = EXCLUDED.opening_note,
        closing_note = EXCLUDED.closing_note,
        status = EXCLUDED.status,
        opened_at = EXCLUDED.opened_at,
        closed_at = EXCLUDED.closed_at,
        updated_at = EXCLUDED.updated_at;

      INSERT INTO cash_movements (id, "shiftId", "storeId", "movementType", amount, "performedBy", reason)
      VALUES ('CSH-9001', 'SHIFT-8001', 'STR-5001', 'SAFE_DROP', 500.00, 'Manager Alex', 'Drawer Exceeded Limit ($1,000)')
      ON CONFLICT (id) DO NOTHING;
    `);
    const { rows: seededShifts } = await client.query(`
      SELECT id, merchant_id, store_id, cashier_name
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
