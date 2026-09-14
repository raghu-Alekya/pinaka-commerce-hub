-- ==========================================================
-- 01: PCH Master Reference Table - store_types & stores alignment
-- Database: pinaka_commerce_hub
-- ==========================================================

-- 1. Create Master Reference Table: store_types
CREATE TABLE IF NOT EXISTS public.store_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_type_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT store_types_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- 2. Seed Initial Standard Verticals
INSERT INTO public.store_types (id, store_type_code, name, description, status)
VALUES 
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000001', 'RETAIL', 'General Retail', 'Specialty retail, apparel, electronics and merchandise stores', 'ACTIVE'),
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000002', 'GROCERY', 'Grocery & Supermarket', 'Supermarkets, organic food markets, and grocery chains', 'ACTIVE'),
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000003', 'RESTAURANT', 'Restaurant & Cafe', 'Full service dining, quick-service (QSR), bakeries, and cafes', 'ACTIVE'),
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000004', 'LIQUOR', 'Liquor & Beverages', 'Wine, beer, spirits, and beverage specialty shops', 'ACTIVE'),
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000005', 'CONVENIENCE', 'Convenience Store', 'Corner markets, mini-marts, and 24/7 convenience retailers', 'ACTIVE'),
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000006', 'FUEL', 'Gas Station & Forecourt', 'Fuel stations with integrated retail convenience shops', 'ACTIVE'),
  ('a1b2c3d4-e5f6-4a1b-8c2d-000000000007', 'KIOSK', 'Kiosk & Pop-Up', 'Self-service kiosks, food trucks, and seasonal pop-ups', 'ACTIVE')
ON CONFLICT (store_type_code) DO UPDATE 
SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, updated_at = NOW();

-- 3. Create or Align stores Table
CREATE TABLE IF NOT EXISTS public.stores (
    id VARCHAR(100) PRIMARY KEY,
    merchant_id VARCHAR(100) NOT NULL,
    store_type_id VARCHAR(50) DEFAULT 'RETAIL',
    store_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    timezone VARCHAR(100) DEFAULT 'UTC',
    currency VARCHAR(10) DEFAULT 'USD',
    address JSONB DEFAULT '{"street": "", "city": "", "state": "", "zipCode": "", "country": ""}'::jsonb,
    woocommerce_store_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Indexes
CREATE INDEX IF NOT EXISTS idx_store_types_code ON public.store_types(store_type_code);
CREATE INDEX IF NOT EXISTS idx_stores_merchant_id ON public.stores(merchant_id);
CREATE INDEX IF NOT EXISTS idx_stores_store_code ON public.stores(store_code);
CREATE INDEX IF NOT EXISTS idx_stores_store_type_id ON public.stores(store_type_id);
