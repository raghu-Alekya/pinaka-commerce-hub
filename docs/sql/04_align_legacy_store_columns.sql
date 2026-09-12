-- Preserve existing store data after the develop StoreEntity column-name changes.
-- Run with automatic TypeORM synchronization disabled. PostgreSQL 14+.
-- A rename retains values, nullability, indexes and foreign-key dependencies.
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $migration$
DECLARE
    old_name text;
    new_name text;
    old_exists boolean;
    new_exists boolean;
BEGIN
    IF to_regclass('public.stores') IS NULL THEN
        RAISE EXCEPTION 'public.stores is missing; this migration requires the existing store table';
    END IF;
    LOCK TABLE public.stores IN ACCESS EXCLUSIVE MODE;
    FOR old_name, new_name IN SELECT * FROM (VALUES
        ('merchantId', 'merchant_id'),
        ('storeName', 'name'),
        ('storeCode', 'store_code'),
        ('storeType', 'store_type_id'),
        ('createdAt', 'created_at'),
        ('updatedAt', 'updated_at')
    ) AS names(old_column, new_column) LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'stores' AND column_name = old_name) INTO old_exists;
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'stores' AND column_name = new_name) INTO new_exists;
        IF old_exists AND new_exists THEN
            RAISE EXCEPTION 'Both stores.% and stores.% exist; reconcile explicitly before migrating', old_name, new_name;
        ELSIF old_exists THEN
            EXECUTE format('ALTER TABLE public.stores RENAME COLUMN %I TO %I', old_name, new_name);
        ELSIF NOT new_exists THEN
            RAISE EXCEPTION 'Neither stores.% nor stores.% exists', old_name, new_name;
        END IF;
    END LOOP;
END
$migration$;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS woocommerce_store_id VARCHAR(100);
-- store_type_id continues to hold the current application's text vertical code.
-- This migration does not convert IDs to UUIDs or invent replacement owner values.
COMMIT;
