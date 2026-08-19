-- ============================================================================
-- 智慧租屋管理系統 - 多裝置/多瀏覽器全自動同步修復腳本 (SUPABASE FULL SYNC FIX)
-- 請在 Supabase Dashboard ➜ SQL Editor 貼上並執行本腳本
-- ============================================================================

-- 啟用必要擴充
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. 建立或更新 profiles 表 (使用者資料)
CREATE TABLE IF NOT EXISTS public.profiles (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'tenant',
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 2. 建立或更新 landlords 表 (房東資料)
CREATE TABLE IF NOT EXISTS public.landlords (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    company_name TEXT,
    status TEXT NOT NULL DEFAULT 'approved',
    ad_listing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 3. 建立或更新 landlord_addresses 表 (房東地址庫)
CREATE TABLE IF NOT EXISTS public.landlord_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    landlord_id TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 4. 建立或更新 properties 表 (房源管理)
CREATE TABLE IF NOT EXISTS public.properties (
    id TEXT PRIMARY KEY,
    landlord_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '獨立套房',
    rent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    rent_period TEXT NOT NULL DEFAULT 'monthly',
    status TEXT NOT NULL DEFAULT 'vacant',
    address TEXT,
    is_advertised BOOLEAN NOT NULL DEFAULT FALSE,
    photos JSONB NOT NULL DEFAULT '[]'::jsonb,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 5. 建立或更新 leases 表 (租約紀錄)
CREATE TABLE IF NOT EXISTS public.leases (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL,
    landlord_id TEXT,
    tenant_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    co_phone TEXT,
    co_tenant_name TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    deposit NUMERIC(12, 2) NOT NULL DEFAULT 0,
    monthly_rent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_contract_rent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    terminated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 6. 建立或更新 payments 表 (帳單與收付款紀錄)
CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY,
    lease_id TEXT,
    tenant_name TEXT,
    property_name TEXT,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    bill_type TEXT NOT NULL DEFAULT 'rent',
    title TEXT,
    due_date TEXT,
    paid_date TEXT,
    payment_method TEXT DEFAULT 'bank',
    transfer_last5 TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 7. 建立或更新 audit_logs 表 (稽核紀錄)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    user_id TEXT,
    user_role TEXT,
    ip_address TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. 建立或更新 line_binding_tokens 表 (LINE 綁定 Token)
CREATE TABLE IF NOT EXISTS public.line_binding_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    tenant_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 設定 RLS (Row Level Security) 政策：允許前端 Web 應用程式無縫同步讀寫
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_binding_tokens ENABLE ROW LEVEL SECURITY;

-- 移除舊政策避免衝突
DROP POLICY IF EXISTS "Allow all for profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all for landlords" ON public.landlords;
DROP POLICY IF EXISTS "Allow all for landlord_addresses" ON public.landlord_addresses;
DROP POLICY IF EXISTS "Allow all for properties" ON public.properties;
DROP POLICY IF EXISTS "Allow all for leases" ON public.leases;
DROP POLICY IF EXISTS "Allow all for payments" ON public.payments;
DROP POLICY IF EXISTS "Allow all for audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow all for line_binding_tokens" ON public.line_binding_tokens;

-- 建立通用讀寫政策 (支援匿名金鑰與認證使用者跨瀏覽器即時讀寫同步)
CREATE POLICY "Allow all for profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for landlords" ON public.landlords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for landlord_addresses" ON public.landlord_addresses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for properties" ON public.properties FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for leases" ON public.leases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for payments" ON public.payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for line_binding_tokens" ON public.line_binding_tokens FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 啟用 Supabase Realtime 即時廣播 (跨裝置與多瀏覽器毫秒級自動更新)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'properties'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE 
            public.profiles, 
            public.landlords, 
            public.landlord_addresses, 
            public.properties, 
            public.leases, 
            public.payments;
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;
