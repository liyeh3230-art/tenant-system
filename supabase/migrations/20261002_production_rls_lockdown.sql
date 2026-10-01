-- ============================================================================
-- 智慧租屋系統 - 全面資料庫安全性加固與 RLS 防護 (PRODUCTION RLS LOCKDOWN)
-- 徹底杜絕前台匿名 dump、禁止未授權讀取、保障房東與租客個資安全
-- ============================================================================

BEGIN;

-- 1. 啟用全表 ROW LEVEL SECURITY (RLS)
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.landlord_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.line_bindings ENABLE ROW LEVEL SECURITY;

-- 2. 清除既有寬鬆策略 (避免被舊的 allow all 覆蓋)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'landlords', 'properties', 'leases', 'payments', 'landlord_addresses', 'line_bindings')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- A. PROFILES (會員基本資料表)
-- ----------------------------------------------------------------------------
-- Service role 擁有完整權限 (LINE Bot Webhook / Push / 後端 Edge Functions)
CREATE POLICY "profiles_service_role_all" ON public.profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 任何人嚴禁匿名 Dump 全表；登入會員僅能讀取與編輯自身 Profile
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()::text
    OR id = (auth.jwt() ->> 'sub')
  );

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()::text
    OR id = (auth.jwt() ->> 'sub')
  )
  WITH CHECK (
    id = auth.uid()::text
    OR id = (auth.jwt() ->> 'sub')
  );

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()::text
    OR id = (auth.jwt() ->> 'sub')
  );

-- ----------------------------------------------------------------------------
-- B. LANDLORDS (房東資料表：身分證號、銀行帳號、通訊地址高敏個資)
-- ----------------------------------------------------------------------------
CREATE POLICY "landlords_service_role_all" ON public.landlords
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 房東僅能檢視自身紀錄；相關租客僅能在有效合約內關聯查詢（嚴禁匿名/訪客讀取）
CREATE POLICY "landlords_select_owner_or_tenant" ON public.landlords
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()::text
    OR id IN (
      SELECT l.landlord_id
      FROM public.leases l
      JOIN public.profiles p ON (p.phone = l.phone OR p.phone = l.co_phone)
      WHERE (p.id = auth.uid()::text OR p.id = (auth.jwt() ->> 'sub'))
        AND l.deleted_at IS NULL
    )
  );

CREATE POLICY "landlords_modify_own" ON public.landlords
  FOR ALL TO authenticated
  USING (id = auth.uid()::text)
  WITH CHECK (id = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- C. PROPERTIES (房源資訊表)
-- ----------------------------------------------------------------------------
CREATE POLICY "properties_service_role_all" ON public.properties
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 公開訪客僅能瀏覽已發布刊登之廣告房源 (is_advertised = true 且未刪除)
CREATE POLICY "properties_select_advertised_public" ON public.properties
  FOR SELECT TO anon, authenticated
  USING (is_advertised = true AND deleted_at IS NULL);

-- 房東可管理自己所屬的全部房源
CREATE POLICY "properties_landlord_all" ON public.properties
  FOR ALL TO authenticated
  USING (landlord_id = auth.uid()::text)
  WITH CHECK (landlord_id = auth.uid()::text);

-- 承租房客可檢視自己合約所承租的房源
CREATE POLICY "properties_tenant_select" ON public.properties
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT l.property_id
      FROM public.leases l
      JOIN public.profiles p ON (p.phone = l.phone OR p.phone = l.co_phone)
      WHERE (p.id = auth.uid()::text OR p.id = (auth.jwt() ->> 'sub'))
        AND l.deleted_at IS NULL
    )
  );

-- ----------------------------------------------------------------------------
-- D. LEASES (租賃合約表：租金、押金、承租人個資)
-- ----------------------------------------------------------------------------
CREATE POLICY "leases_service_role_all" ON public.leases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 房東僅能檢視與管理自己名下的合約
CREATE POLICY "leases_landlord_all" ON public.leases
  FOR ALL TO authenticated
  USING (landlord_id = auth.uid()::text)
  WITH CHECK (landlord_id = auth.uid()::text);

-- 租客僅能檢視自己電話號碼匹配之合約
CREATE POLICY "leases_tenant_select" ON public.leases
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE (p.id = auth.uid()::text OR p.id = (auth.jwt() ->> 'sub'))
        AND (p.phone = public.leases.phone OR p.phone = public.leases.co_phone)
    )
  );

-- ----------------------------------------------------------------------------
-- E. PAYMENTS (帳單與付款紀錄表)
-- ----------------------------------------------------------------------------
CREATE POLICY "payments_service_role_all" ON public.payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 房東可管理其房源合約下的所有帳單
CREATE POLICY "payments_landlord_all" ON public.payments
  FOR ALL TO authenticated
  USING (
    lease_id IN (
      SELECT l.id FROM public.leases l WHERE l.landlord_id = auth.uid()::text
    )
  )
  WITH CHECK (
    lease_id IN (
      SELECT l.id FROM public.leases l WHERE l.landlord_id = auth.uid()::text
    )
  );

-- 租客僅能檢視與回報自己名下合約之帳單
CREATE POLICY "payments_tenant_select_update" ON public.payments
  FOR SELECT TO authenticated
  USING (
    lease_id IN (
      SELECT l.id FROM public.leases l
      JOIN public.profiles p ON (p.phone = l.phone OR p.phone = l.co_phone)
      WHERE (p.id = auth.uid()::text OR p.id = (auth.jwt() ->> 'sub'))
    )
  );

CREATE POLICY "payments_tenant_report" ON public.payments
  FOR UPDATE TO authenticated
  USING (
    lease_id IN (
      SELECT l.id FROM public.leases l
      JOIN public.profiles p ON (p.phone = l.phone OR p.phone = l.co_phone)
      WHERE (p.id = auth.uid()::text OR p.id = (auth.jwt() ->> 'sub'))
    )
  )
  WITH CHECK (
    lease_id IN (
      SELECT l.id FROM public.leases l
      JOIN public.profiles p ON (p.phone = l.phone OR p.phone = l.co_phone)
      WHERE (p.id = auth.uid()::text OR p.id = (auth.jwt() ->> 'sub'))
    )
  );

-- ----------------------------------------------------------------------------
-- F. LANDLORD_ADDRESSES (房東地址庫) & LINE_BINDINGS (LINE 帳號綁定)
-- ----------------------------------------------------------------------------
CREATE POLICY "addresses_service_role_all" ON public.landlord_addresses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "addresses_landlord_all" ON public.landlord_addresses
  FOR ALL TO authenticated
  USING (landlord_id = auth.uid()::text)
  WITH CHECK (landlord_id = auth.uid()::text);

CREATE POLICY "line_bindings_service_role_all" ON public.line_bindings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "line_bindings_tenant_own" ON public.line_bindings
  FOR ALL TO authenticated
  USING (tenant_id = auth.uid()::text)
  WITH CHECK (tenant_id = auth.uid()::text);

COMMIT;
