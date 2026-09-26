import { DataSource } from 'typeorm';

/** One card-payment configuration per store and provider. */
export async function ensurePosCardPaymentSchema(db: DataSource): Promise<void> {
  await db.transaction(async manager => {
    await manager.query('SELECT pg_advisory_xact_lock(724621, 52)');
    await manager.query(`
      CREATE TABLE IF NOT EXISTS public.pos_card_payment_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "storeId" varchar(100) NOT NULL,
        "merchantId" varchar(100) NOT NULL,
        provider varchar(20) NOT NULL,
        "deviceId" varchar(100) NOT NULL,
        "processorMerchantId" varchar(100) NOT NULL,
        "terminalId" varchar(100) NOT NULL DEFAULT '',
        "secretKey" varchar(500) NOT NULL,
        "webhookUrl" varchar(2048) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT pos_card_payment_settings_provider_chk CHECK (provider IN ('Kickback', 'Payroc')),
        CONSTRAINT pos_card_payment_settings_device_chk CHECK (BTRIM("deviceId") <> ''),
        CONSTRAINT pos_card_payment_settings_processor_chk CHECK (BTRIM("processorMerchantId") <> ''),
        CONSTRAINT pos_card_payment_settings_secret_chk CHECK (BTRIM("secretKey") <> ''),
        CONSTRAINT pos_card_payment_settings_webhook_chk CHECK (BTRIM("webhookUrl") <> '')
      )
    `);
    await manager.query(`
      ALTER TABLE public.pos_card_payment_settings
      DROP CONSTRAINT IF EXISTS pos_card_payment_settings_store_uq
    `);
    await manager.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pos_card_payment_settings_store_provider_uq
      ON public.pos_card_payment_settings ("storeId", provider)
    `);
  });
}
