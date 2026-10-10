const { Client } = require('pg');

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://pdh_user:pdh_password@127.0.0.1:5432/pinaka_commerce_hub_new',
  });

  await client.connect();
  console.log('Connected to PostgreSQL database...');

  // 1. Store Type
  const existingType = await client.query(`SELECT id FROM public.store_types WHERE store_type_code = 'RESTAURANT' LIMIT 1`);
  let storeTypeId;
  if (existingType.rows.length > 0) {
    storeTypeId = existingType.rows[0].id;
  } else {
    const res = await client.query(`
      INSERT INTO public.store_types (id, store_type_code, name, description, status)
      VALUES ('44444444-4444-4444-4444-444444444444', 'RESTAURANT', 'Restaurant POS', 'Standard Restaurant POS Store Type', 'ACTIVE')
      RETURNING id;
    `);
    storeTypeId = res.rows[0].id;
  }

  // 2. Merchant
  const existingMerchant = await client.query(`SELECT id FROM public.merchants WHERE email = 'admin@merchant.com' LIMIT 1`);
  let merchantId;
  if (existingMerchant.rows.length > 0) {
    merchantId = existingMerchant.rows[0].id;
  } else {
    const res = await client.query(`
      INSERT INTO public.merchants (
        id, "merchantCode", "merchantId", "business_display_name", "first_name", "last_name", email, phone, status
      ) VALUES (
        '11111111-1111-1111-1111-111111111111', 'MCH-ADMIN-01', 'M001', 'Admin Merchant Store', 'Admin', 'User', 'admin@merchant.com', '+1234567890', 'ACTIVE'
      ) RETURNING id;
    `);
    merchantId = res.rows[0].id;
  }

  // 3. Store
  const existingStore = await client.query(`SELECT id FROM public.stores WHERE store_code = 'STORE-NORTH-01' LIMIT 1`);
  let storeId;
  if (existingStore.rows.length > 0) {
    storeId = existingStore.rows[0].id;
  } else {
    const res = await client.query(`
      INSERT INTO public.stores (
        id, merchant_id, store_type_id, "store_code", "store_name", "store_website_url", "address_line1", city, state, country, "operational_status", status, activation_pin
      ) VALUES (
        '22222222-2222-2222-2222-222222222222', $1, $2, 'STORE-NORTH-01', 'North Branch Store', 'https://north.adminmerchant.pch.com', '123 Main Street', 'New York', 'NY', 'USA', 'OPEN', 'ACTIVE', '123456'
      ) RETURNING id;
    `, [merchantId, storeTypeId]);
    storeId = res.rows[0].id;
  }

  // 4. Employee (Set 6-digit PIN to '123456')
  const pin6Hash = '123456';
  const existingEmployee = await client.query(`SELECT id FROM public.employees WHERE employee_code = 'EMP101' OR login_pin_hash = '123456' LIMIT 1`);
  if (existingEmployee.rows.length > 0) {
    await client.query(`UPDATE public.employees SET login_pin_hash = $1, status = 'ACTIVE' WHERE id = $2`, [pin6Hash, existingEmployee.rows[0].id]);
  } else {
    await client.query(`
      INSERT INTO public.employees (
        id, merchant_id, "employee_code", "first_name", "last_name", status, "login_pin_hash"
      ) VALUES (
        '33333333-3333-3333-3333-333333333333', $1, 'EMP101', 'John', 'Doe', 'ACTIVE', $2
      );
    `, [merchantId, pin6Hash]);
  }
  console.log('Employee seeded with 6-digit PIN 123456 successfully!');

  // 5. Device
  const existingDevice = await client.query(`SELECT id FROM public.devices WHERE device_code = 'DEV-POS-01' LIMIT 1`);
  if (existingDevice.rows.length === 0) {
    await client.query(`
      INSERT INTO public.devices (
        id, merchant_id, merchant_name, serial_number, device_code, device_name, device_type, status, is_deleted
      ) VALUES (
        '55555555-5555-5555-5555-555555555555', $1, 'Admin Merchant Store', 'SN-POS-01', 'DEV-POS-01', 'Front Counter POS Terminal', 'COUNTER_POS', 'ACTIVE', false
      )
    `, [merchantId]);
  }
  console.log('Device seeded successfully!');

  await client.end();
  console.log('Seeding finished successfully!');
}

seed().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
