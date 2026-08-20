-- ============================================================================
-- 智慧租屋管理系統 - 資料庫結構與多裝置全同步升級腳本 (SUPABASE RE-SYNC & FIX)
-- 請在 Supabase Dashboard ➜ SQL Editor 貼上並點擊 Run
-- ============================================================================

-- 1. 清理舊約束與舊表 (CASCADE 清除舊的 strict UUID 限制，避免型別衝突)
DROP TABLE IF EXISTS public.payment_events CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.bill_items CASCADE;
DROP TABLE IF EXISTS public.bills CASCADE;
DROP TABLE IF EXISTS public.maintenance_requests CASCADE;
DROP TABLE IF EXISTS public.leases CASCADE;
DROP TABLE IF EXISTS public.property_photos CASCADE;
DROP TABLE IF EXISTS public.properties CASCADE;
DROP TABLE IF EXISTS public.landlord_addresses CASCADE;
DROP TABLE IF EXISTS public.landlords CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.line_binding_tokens CASCADE;
DROP TABLE IF EXISTS public.tenant_line_accounts CASCADE;

-- 2. 建立 profiles 使用者表
CREATE TABLE public.profiles (
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

-- 3. 建立 landlords 房東表
CREATE TABLE public.landlords (
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

-- 4. 建立 landlord_addresses 房東地址庫表
CREATE TABLE public.landlord_addresses (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    landlord_id TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 5. 建立 properties 房源表
CREATE TABLE public.properties (
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

-- 6. 建立 leases 租約表
CREATE TABLE public.leases (
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

-- 7. 建立 payments 帳單與收付款表
CREATE TABLE public.payments (
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

-- 8. 建立 audit_logs 稽核表
CREATE TABLE public.audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_type TEXT NOT NULL,
    user_id TEXT,
    user_role TEXT,
    ip_address TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. 建立 line_binding_tokens 綁定表
CREATE TABLE public.line_binding_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    token TEXT NOT NULL UNIQUE,
    tenant_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. 設定 RLS 權限：開放前端完整讀寫權限
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_binding_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for landlords" ON public.landlords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for landlord_addresses" ON public.landlord_addresses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for properties" ON public.properties FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for leases" ON public.leases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for payments" ON public.payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for line_binding_tokens" ON public.line_binding_tokens FOR ALL USING (true) WITH CHECK (true);

-- 11. 加入 Realtime 即時廣播
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

-- 12. 建立/更新平台總管理員安全帳號 (密碼已使用 SHA-256 加鹽雜湊，完全不儲存明文)
INSERT INTO public.profiles (id, role, name, phone, password_hash)
VALUES (
    'usr_superadmin',
    'superadmin',
    '平台總管理員',
    '0900000000',
    'b854dcf489b9c5fa4303a235a5212b3a378db986592f74ea16f49fe6ee172fbf'
) ON CONFLICT (id) DO UPDATE 
SET password_hash = 'b854dcf489b9c5fa4303a235a5212b3a378db986592f74ea16f49fe6ee172fbf',
    role = 'superadmin',
    name = '平台總管理員';

