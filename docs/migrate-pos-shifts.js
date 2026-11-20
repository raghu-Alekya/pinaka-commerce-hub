const { Client } = require('pg');

const databasesToMigrate = [
  process.env.POSTGRES_DB || 'pinaka_commerce_hub_new',
  'pinaka_commerce_hub'
];

// Dedupe databases
const databases = Array.from(new Set(databasesToMigrate));

async function migrateDatabase(dbName) {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'pdh_user',
    password: process.env.POSTGRES_PASSWORD || 'pdh_password',
    database: dbName,
  });

  try {
    await client.connect();
    console.log(`\n🔹 Connected to ${dbName}...`);

    // 1. Ensure table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.pos_shifts (
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

    // 2. Add master columns only. Do not recreate the old totals, notes, or denomination columns.
    await client.query(`
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS merchant_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS store_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS device_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opening_device_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_device_id VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS updated_by VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closed_by VARCHAR(100);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closing_balance DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS over_short DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS declared_cash DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS discrepancy DECIMAL(12,2);
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'OPEN';
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE public.pos_shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    `);

    // 3. Migrate and Drop legacy camelCase columns from pos_shifts
    const camelColumns = [
      ['merchantId', 'merchant_id'],
      ['storeId', 'store_id'],
      ['terminalId', 'device_id'],
      ['terminal_id', 'device_id'],
      ['openingDeviceId', 'opening_device_id'],
      ['openedByEmployeeId', 'created_by'],
      ['closedByEmployeeId', 'closed_by'],
      ['openingCash', 'opening_balance'],
      ['closingCashActual', 'closing_balance'],
      ['declaredCash', 'declared_cash'],
      ['cashDifference', 'over_short'],
      ['openedAt', 'opened_at'],
      ['closedAt', 'closed_at'],
      ['createdAt', 'created_at'],
      ['updatedAt', 'updated_at']
    ];

    for (const [legacyCol, snakeCol] of camelColumns) {
      const check = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'pos_shifts' AND column_name = ANY($1)`,
        [[legacyCol, snakeCol]]
      );
      const present = new Set(check.rows.map((row) => row.column_name));
      if (present.has(legacyCol) && present.has(snakeCol)) {
        const valueSql = snakeCol === 'created_by' || snakeCol === 'closed_by'
          ? `"${legacyCol}"::text`
          : `"${legacyCol}"`;
        await client.query(`UPDATE public.pos_shifts SET "${snakeCol}" = ${valueSql} WHERE "${snakeCol}" IS NULL AND "${legacyCol}" IS NOT NULL`);
        if (legacyCol !== snakeCol) {
          await client.query(`ALTER TABLE public.pos_shifts DROP COLUMN IF EXISTS "${legacyCol}"`);
          console.log(`   Dropped legacy camelCase column: pos_shifts."${legacyCol}"`);
        }
      }
    }

    // 4. Migrate and Drop legacy camelCase columns from cash_movements
    const cashMovementsCamel = [
      ['shiftId', 'shift_id'],
      ['storeId', 'store_id'],
      ['movementType', 'movement_type'],
      ['performedBy', 'performed_by'],
      ['createdAt', 'created_at']
    ];

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.cash_movements (
        id VARCHAR(100) PRIMARY KEY,
        shift_id VARCHAR(100) NOT NULL,
        store_id VARCHAR(100) NOT NULL,
        movement_type VARCHAR(50) DEFAULT 'SAFE_DROP',
        amount DECIMAL(10,2) NOT NULL,
        performed_by VARCHAR(255) NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS shift_id VARCHAR(100);
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS store_id VARCHAR(100);
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS movement_type VARCHAR(50) DEFAULT 'SAFE_DROP';
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS performed_by VARCHAR(255);
      ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    `);

    for (const [legacyCol, snakeCol] of cashMovementsCamel) {
      const check = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cash_movements' AND column_name = $1`,
        [legacyCol]
      );
      if (check.rows.length > 0) {
        await client.query(`UPDATE public.cash_movements SET "${snakeCol}" = "${legacyCol}" WHERE "${snakeCol}" IS NULL AND "${legacyCol}" IS NOT NULL`);
        await client.query(`ALTER TABLE public.cash_movements DROP COLUMN IF EXISTS "${legacyCol}"`);
        console.log(`   Dropped legacy camelCase column: cash_movements."${legacyCol}"`);
      }
    }

    // 5. Display current columns in pos_shifts
    const columnsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'pos_shifts' 
      ORDER BY ordinal_position
    `);
    console.log(`\n✅ pos_shifts final columns in ${dbName}:`);
    columnsRes.rows.forEach(r => console.log(`   - ${r.column_name} (${r.data_type})`));

    await client.end();
  } catch (err) {
    console.log(`ℹ️ Could not migrate ${dbName} (${err.message})`);
  }
}

async function run() {
  for (const db of databases) {
    await migrateDatabase(db);
  }
  console.log('\n🎉 All database migrations complete!');
}

run();
