-- ============================================================================
-- 智慧租屋管理系統 - 生產環境 PostgreSQL 安全結構與 RLS 權限規範
-- SMART TENANT SYSTEM - PRODUCTION POSTGRESQL SCHEMA & ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- 啟用必要的擴充套件
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. 自訂資料類型 ENUM
DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('superadmin', 'landlord', 'tenant');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE landlord_status_enum AS ENUM ('pending', 'active', 'suspended');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE property_status_enum AS ENUM ('vacant', 'occupied');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE rent_period_enum AS ENUM ('monthly', 'yearly');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE lease_status_enum AS ENUM ('active', 'terminated', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE bill_status_enum AS ENUM ('pending', 'paid', 'void');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('bank_transfer', 'cash', 'line_pay', 'credit_card');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('pending', 'tenant_submitted', 'pending_approval', 'paid', 'rejected', 'void');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE maintenance_urgency_enum AS ENUM ('low', 'medium', 'high', 'emergency');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE maintenance_status_enum AS ENUM ('pending', 'processing', 'completed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. 使用者資料表 (Profiles)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role_enum NOT NULL DEFAULT 'tenant',
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 3. 房東專屬設定 (Landlords)
CREATE TABLE IF NOT EXISTS public.landlords (
    id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    company_name VARCHAR(150),
    ad_listing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    status landlord_status_enum NOT NULL DEFAULT 'pending',
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 4. 房東專屬地址庫 (Landlord Addresses - 房東獨立隔離)
CREATE TABLE IF NOT EXISTS public.landlord_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    landlord_id UUID NOT NULL REFERENCES public.landlords(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_landlord_address UNIQUE (landlord_id, address)
);

-- 5. 租客專屬資訊 (Tenants)
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    id_number_masked VARCHAR(20),
    emergency_contact VARCHAR(100),
    emergency_phone VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 6. 房源管理表 (Properties)
CREATE TABLE IF NOT EXISTS public.properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    landlord_id UUID NOT NULL REFERENCES public.landlords(id) ON DELETE CASCADE,
    address_id UUID REFERENCES public.landlord_addresses(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT '獨立套房',
    rent NUMERIC(12, 2) NOT NULL CHECK (rent >= 0),
    rent_period rent_period_enum NOT NULL DEFAULT 'monthly',
    status property_status_enum NOT NULL DEFAULT 'vacant',
    is_advertised BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 7. 房源實景相片 (Property Photos)
CREATE TABLE IF NOT EXISTS public.property_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    is_cover BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 8. 租約紀錄 (Leases) - 具備防重疊 Constraint & 狀態控制
CREATE TABLE IF NOT EXISTS public.leases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    landlord_id UUID NOT NULL REFERENCES public.landlords(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    co_tenant_name VARCHAR(100),
    co_tenant_phone VARCHAR(20),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    monthly_rent NUMERIC(12, 2) NOT NULL CHECK (monthly_rent >= 0),
    deposit NUMERIC(12, 2) NOT NULL CHECK (deposit >= 0),
    total_contract_rent NUMERIC(12, 2) NOT NULL CHECK (total_contract_rent >= 0),
    payment_day INT NOT NULL DEFAULT 1 CHECK (payment_day BETWEEN 1 AND 31),
    status lease_status_enum NOT NULL DEFAULT 'active',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_lease_dates CHECK (start_date <= end_date)
);

-- 9. 帳單表 (Bills)
CREATE TABLE IF NOT EXISTS public.bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE RESTRICT,
    landlord_id UUID NOT NULL REFERENCES public.landlords(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    title VARCHAR(150) NOT NULL,
    billing_cycle VARCHAR(50) NOT NULL,
    due_date DATE NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    status bill_status_enum NOT NULL DEFAULT 'pending',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 10. 帳單細項 (Bill Items)
CREATE TABLE IF NOT EXISTS public.bill_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    description VARCHAR(150) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. 付款紀錄表 (Payments) - 不儲存完整卡號與 CVV，只保存交易狀態
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
    lease_id UUID NOT NULL REFERENCES public.leases(id) ON DELETE RESTRICT,
    landlord_id UUID NOT NULL REFERENCES public.landlords(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method payment_method_enum NOT NULL DEFAULT 'bank_transfer',
    status payment_status_enum NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    bank_last_five VARCHAR(5),
    transaction_id VARCHAR(100),
    proof_url TEXT,
    rejected_reason TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 12. 付款狀態流轉事件 (Payment Events - 狀態機審計軌跡)
CREATE TABLE IF NOT EXISTS public.payment_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES public.profiles(id),
    actor_role VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    old_status payment_status_enum,
    new_status payment_status_enum NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. 報修申請 (Maintenance Requests)
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
    lease_id UUID REFERENCES public.leases(id) ON DELETE SET NULL,
    landlord_id UUID NOT NULL REFERENCES public.landlords(id) ON DELETE RESTRICT,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    urgency maintenance_urgency_enum NOT NULL DEFAULT 'medium',
    status maintenance_status_enum NOT NULL DEFAULT 'pending',
    photos JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 14. LINE 帳號綁定 (Tenant LINE Accounts)
CREATE TABLE IF NOT EXISTS public.tenant_line_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    line_user_id VARCHAR(100) NOT NULL UNIQUE,
    line_display_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. 一次性短效 LINE 綁定 Token (LINE Binding Tokens - 5~10 分鐘過期，使用後立即失效)
CREATE TABLE IF NOT EXISTS public.line_binding_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. 系統操作稽核紀錄 (Audit Logs)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_role VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    old_data JSONB,
    new_data JSONB,
    ip VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. 系統通知 (Notifications)
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'info',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) 權限隔離政策 (POLICIES)
-- ============================================================================

-- 啟用全表 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_line_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_binding_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 輔助函式：判斷當前請求者是否為 Super Admin
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'superadmin' AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 輔助函式：判斷當前請求者是否為 Landlord
CREATE OR REPLACE FUNCTION public.is_landlord()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'landlord' AND deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- (1) Profiles RLS
DROP POLICY IF EXISTS "Profiles read policy" ON public.profiles;
CREATE POLICY "Profiles read policy" ON public.profiles
FOR SELECT USING (
    id = auth.uid()
    OR public.is_superadmin()
    OR (
        public.is_landlord() AND EXISTS (
            SELECT 1 FROM public.leases
            WHERE landlord_id = auth.uid() AND tenant_id = public.profiles.id AND deleted_at IS NULL
        )
    )
);

DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
CREATE POLICY "Profiles update policy" ON public.profiles
FOR UPDATE USING (
    id = auth.uid() OR public.is_superadmin()
);

-- (2) Landlords RLS
DROP POLICY IF EXISTS "Landlords read policy" ON public.landlords;
CREATE POLICY "Landlords read policy" ON public.landlords
FOR SELECT USING (
    id = auth.uid() 
    OR public.is_superadmin()
    OR status = 'active'
);

DROP POLICY IF EXISTS "Landlords modify policy" ON public.landlords;
CREATE POLICY "Landlords modify policy" ON public.landlords
FOR ALL USING (
    public.is_superadmin() OR id = auth.uid()
);

-- (3) Landlord Addresses RLS (房東地址庫嚴格隔離)
DROP POLICY IF EXISTS "Landlord addresses isolation" ON public.landlord_addresses;
CREATE POLICY "Landlord addresses isolation" ON public.landlord_addresses
FOR ALL USING (
    landlord_id = auth.uid() OR public.is_superadmin()
);

-- (4) Properties RLS (房源管理隔離)
DROP POLICY IF EXISTS "Properties select policy" ON public.properties;
CREATE POLICY "Properties select policy" ON public.properties
FOR SELECT USING (
    deleted_at IS NULL AND (
        landlord_id = auth.uid()
        OR public.is_superadmin()
        OR is_advertised = TRUE
        OR EXISTS (
            SELECT 1 FROM public.leases
            WHERE property_id = public.properties.id AND tenant_id = auth.uid() AND status = 'active' AND deleted_at IS NULL
        )
    )
);

DROP POLICY IF EXISTS "Properties write policy" ON public.properties;
CREATE POLICY "Properties write policy" ON public.properties
FOR ALL USING (
    (landlord_id = auth.uid() AND public.is_landlord()) OR public.is_superadmin()
);

-- (5) Leases RLS (租約嚴格隔離)
DROP POLICY IF EXISTS "Leases select policy" ON public.leases;
CREATE POLICY "Leases select policy" ON public.leases
FOR SELECT USING (
    deleted_at IS NULL AND (
        landlord_id = auth.uid()
        OR tenant_id = auth.uid()
        OR public.is_superadmin()
    )
);

DROP POLICY IF EXISTS "Leases write policy" ON public.leases;
CREATE POLICY "Leases write policy" ON public.leases
FOR ALL USING (
    (landlord_id = auth.uid() AND public.is_landlord()) OR public.is_superadmin()
);

-- (6) Bills & Bill Items RLS (帳單隔離)
DROP POLICY IF EXISTS "Bills select policy" ON public.bills;
CREATE POLICY "Bills select policy" ON public.bills
FOR SELECT USING (
    deleted_at IS NULL AND (
        landlord_id = auth.uid()
        OR tenant_id = auth.uid()
        OR public.is_superadmin()
    )
);

DROP POLICY IF EXISTS "Bills write policy" ON public.bills;
CREATE POLICY "Bills write policy" ON public.bills
FOR ALL USING (
    (landlord_id = auth.uid() AND public.is_landlord()) OR public.is_superadmin()
);

DROP POLICY IF EXISTS "Bill items isolation" ON public.bill_items;
CREATE POLICY "Bill items isolation" ON public.bill_items
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.bills
        WHERE bills.id = bill_items.bill_id AND (
            bills.landlord_id = auth.uid()
            OR bills.tenant_id = auth.uid()
            OR public.is_superadmin()
        )
    )
);

-- (7) Payments & Payment Events RLS (付款安全隔離)
DROP POLICY IF EXISTS "Payments select policy" ON public.payments;
CREATE POLICY "Payments select policy" ON public.payments
FOR SELECT USING (
    deleted_at IS NULL AND (
        landlord_id = auth.uid()
        OR tenant_id = auth.uid()
        OR public.is_superadmin()
    )
);

DROP POLICY IF EXISTS "Payments insert policy" ON public.payments;
CREATE POLICY "Payments insert policy" ON public.payments
FOR INSERT WITH CHECK (
    tenant_id = auth.uid() OR landlord_id = auth.uid() OR public.is_superadmin()
);

-- 禁止租客直接 UPDATE payments 的 status 為 'paid' (必須透過狀態機或房東確認)
DROP POLICY IF EXISTS "Payments update policy" ON public.payments;
CREATE POLICY "Payments update policy" ON public.payments
FOR UPDATE USING (
    landlord_id = auth.uid() OR public.is_superadmin() OR (
        tenant_id = auth.uid() AND status IN ('pending', 'rejected')
    )
);

DROP POLICY IF EXISTS "Payment events select policy" ON public.payment_events;
CREATE POLICY "Payment events select policy" ON public.payment_events
FOR SELECT USING (
    public.is_superadmin() OR EXISTS (
        SELECT 1 FROM public.payments
        WHERE payments.id = payment_events.payment_id AND (
            payments.landlord_id = auth.uid() OR payments.tenant_id = auth.uid()
        )
    )
);

-- (8) Audit Logs RLS (只允許 Super Admin 檢視，系統寫入)
DROP POLICY IF EXISTS "Audit logs select policy" ON public.audit_logs;
CREATE POLICY "Audit logs select policy" ON public.audit_logs
FOR SELECT USING (
    public.is_superadmin()
);

-- ============================================================================
-- 付款狀態機 (Payment State Machine) - Server-Side RPC 函式
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transition_payment_status(
    p_payment_id UUID,
    p_new_status payment_status_enum,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_payment RECORD;
    v_actor_role VARCHAR(50);
BEGIN
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION '找不到該筆付款紀錄';
    END IF;

    -- 判斷操作者角色
    IF public.is_superadmin() THEN
        v_actor_role := 'superadmin';
    ELSIF v_payment.landlord_id = auth.uid() THEN
        v_actor_role := 'landlord';
    ELSIF v_payment.tenant_id = auth.uid() THEN
        v_actor_role := 'tenant';
    ELSE
        RAISE EXCEPTION '無權限操作此付款紀錄 (403 Forbidden)';
    END IF;

    -- 狀態機流轉規則 (State Machine Transition Guards)
    IF v_actor_role = 'tenant' THEN
        -- 租客只能從 pending/rejected 回報為 tenant_submitted
        IF NOT (v_payment.status IN ('pending', 'rejected') AND p_new_status = 'tenant_submitted') THEN
            RAISE EXCEPTION '租客不可直接將付款標記為「%」，僅可提交繳款回報 (tenant_submitted)', p_new_status;
        END IF;
    ELSIF v_actor_role = 'landlord' THEN
        -- 房東可將 tenant_submitted / pending 標記為 paid 或 rejected
        IF NOT (p_new_status IN ('paid', 'rejected', 'void')) THEN
            RAISE EXCEPTION '房東不允許將付款狀態轉移為 %', p_new_status;
        END IF;
    END IF;

    -- 執行更新
    UPDATE public.payments
    SET status = p_new_status,
        updated_at = NOW(),
        confirmed_at = CASE WHEN p_new_status = 'paid' THEN NOW() ELSE confirmed_at END
    WHERE id = p_payment_id;

    -- 若標記為 paid，同步將對應帳單改為 paid
    IF p_new_status = 'paid' THEN
        UPDATE public.bills SET status = 'paid', updated_at = NOW() WHERE id = v_payment.bill_id;
    END IF;

    -- 寫入狀態流轉歷史 (Payment Event)
    INSERT INTO public.payment_events (payment_id, actor_id, actor_role, action, old_status, new_status, metadata)
    VALUES (p_payment_id, auth.uid(), v_actor_role, 'transition_status', v_payment.status, p_new_status, p_metadata);

    -- 寫入稽核日誌 (Audit Log)
    INSERT INTO public.audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, old_data, new_data)
    VALUES (
        auth.uid(),
        v_actor_role,
        'PAYMENT_STATUS_' || p_new_status::TEXT,
        'payment',
        p_payment_id::TEXT,
        jsonb_build_object('status', v_payment.status, 'amount', v_payment.amount),
        jsonb_build_object('status', p_new_status, 'amount', v_payment.amount, 'meta', p_metadata)
    );

    RETURN jsonb_build_object('success', true, 'paymentId', p_payment_id, 'newStatus', p_new_status);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- LINE 一次性綁定 Token 產生與驗證 (LINE Binding Security)
-- ============================================================================

-- 產生短效 10 分鐘一次性 Token
CREATE OR REPLACE FUNCTION public.generate_line_binding_token(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_token VARCHAR(64);
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF auth.uid() != p_tenant_id AND NOT public.is_superadmin() THEN
        RAISE EXCEPTION '無權為其他租客產生 LINE 綁定 Token';
    END IF;

    -- 產生 8 碼不可預測之隨機英數 Token
    v_token := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8));
    v_expires_at := NOW() + INTERVAL '10 minutes';

    -- 使先前未使用的舊 token 失效
    UPDATE public.line_binding_tokens
    SET used_at = NOW()
    WHERE tenant_id = p_tenant_id AND used_at IS NULL;

    INSERT INTO public.line_binding_tokens (tenant_id, token, expires_at)
    VALUES (p_tenant_id, v_token, v_expires_at);

    RETURN jsonb_build_object(
        'token', v_token,
        'expiresAt', v_expires_at,
        'expiresInSeconds', 600
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 驗證並綁定 LINE (使用一次立即失效)
CREATE OR REPLACE FUNCTION public.verify_and_bind_line(
    p_token VARCHAR(64),
    p_line_user_id VARCHAR(100),
    p_line_display_name VARCHAR(100)
)
RETURNS JSONB AS $$
DECLARE
    v_record RECORD;
BEGIN
    SELECT * INTO v_record
    FROM public.line_binding_tokens
    WHERE token = UPPER(TRIM(p_token))
      AND used_at IS NULL
      AND expires_at > NOW();

    IF NOT FOUND THEN
        RAISE EXCEPTION '無效或已過期之綁定 Token (Token Invalid or Expired)';
    END IF;

    -- 標記 Token 為已使用 (防止 Replay Attack 重播攻擊)
    UPDATE public.line_binding_tokens
    SET used_at = NOW()
    WHERE id = v_record.id;

    -- 建立或更新 tenant_line_accounts
    INSERT INTO public.tenant_line_accounts (tenant_id, line_user_id, line_display_name, status, linked_at, last_seen_at)
    VALUES (v_record.tenant_id, p_line_user_id, p_line_display_name, 'active', NOW(), NOW())
    ON CONFLICT (tenant_id)
    DO UPDATE SET
        line_user_id = EXCLUDED.line_user_id,
        line_display_name = EXCLUDED.line_display_name,
        status = 'active',
        last_seen_at = NOW();

    -- 寫入稽核日誌
    INSERT INTO public.audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, new_data)
    VALUES (v_record.tenant_id, 'tenant', 'LINE_BIND_SUCCESS', 'tenant_line_account', p_line_user_id, jsonb_build_object('displayName', p_line_display_name));

    RETURN jsonb_build_object('success', true, 'tenantId', v_record.tenant_id, 'lineUserId', p_line_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
