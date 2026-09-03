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

    // 1. Create staff_employees table
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_employees (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "employeeCode" VARCHAR(50) NOT NULL,
        "fullName" VARCHAR(150) NOT NULL,
        role VARCHAR(50) DEFAULT 'CASHIER',
        "pinCode" VARCHAR(10) NOT NULL,
        "hourlyRate" DECIMAL(10,2) DEFAULT 18.50,
        "isActive" BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create staff_attendance table
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_attendance (
        id VARCHAR(100) PRIMARY KEY,
        "merchantId" VARCHAR(100) NOT NULL,
        "storeId" VARCHAR(100) NOT NULL,
        "employeeId" VARCHAR(100) NOT NULL,
        "employeeName" VARCHAR(150) NOT NULL,
        "clockInTime" TIMESTAMPTZ NOT NULL,
        "clockOutTime" TIMESTAMPTZ,
        "totalHoursWorked" DECIMAL(10,2) DEFAULT 0.00,
        notes VARCHAR(255),
        "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Seed Demo Employee Roster & Attendance
    await client.query(`
      INSERT INTO staff_employees (id, "merchantId", "storeId", "employeeCode", "fullName", role, "pinCode", "hourlyRate", "isActive")
      VALUES ('EMP-101', 'MCH-1001', 'STR-5001', 'EMP-101', 'Sarah Jenkins', 'CASHIER', '1234', 18.50, true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO staff_employees (id, "merchantId", "storeId", "employeeCode", "fullName", role, "pinCode", "hourlyRate", "isActive")
      VALUES ('EMP-102', 'MCH-1001', 'STR-5001', 'EMP-102', 'Alex Rodriguez', 'STORE_MANAGER', '9999', 28.00, true)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO staff_attendance (id, "merchantId", "storeId", "employeeId", "employeeName", "clockInTime", "clockOutTime", "totalHoursWorked", notes)
      VALUES ('ATT-9001', 'MCH-1001', 'STR-5001', 'EMP-101', 'Sarah Jenkins', CURRENT_TIMESTAMP - INTERVAL '8 hours', CURRENT_TIMESTAMP, 8.00, 'Shift Clock-In via Sunmi POS')
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log(`✅ Module 10 staff tables & roster rows seeded in ${dbName}!`);

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
