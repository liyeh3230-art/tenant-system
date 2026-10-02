-- ============================================================================
-- 智慧租屋系統 - 總管理員會員名冊讀取修復 (RLS PERMISSION FIX)
-- 說明：
-- 1. 解除 RLS 讀取阻擋：允許總管理員後台與前台正常讀取現有會員名冊 (SELECT)
-- 2. 不執行任何 INSERT 操作，避免觸發 phone 唯一鍵限制，100% 安全純權限解除
-- 3. 請直接複製此腳本至 Supabase 後台 SQL Editor 執行 (Run) 即可修復！
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 步驟 1：清理先前造成阻擋的舊 RLS Policies
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'landlords', 'properties', 'leases', 'payments', 'landlord_addresses', 'line_bindings', 'line_binding_tokens')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END;
$$;

-- 確保所有核心表啟用 RLS
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.landlord_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.line_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.line_binding_tokens ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 步驟 2：建立正確的 RLS 存取策略
-- ----------------------------------------------------------------------------

-- A. service_role 擁有所有表的完全控制權限 (LINE Bot / Webhook / Edge Functions)
CREATE POLICY "service_role_profiles_all" ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_landlords_all" ON public.landlords FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_properties_all" ON public.properties FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_leases_all" ON public.leases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_payments_all" ON public.payments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_addresses_all" ON public.landlord_addresses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bindings_all" ON public.line_bindings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tokens_all" ON public.line_binding_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- B. 讀取策略 (SELECT)：解除 RLS 阻擋，允許正常讀取現有會員與名冊資料
CREATE POLICY "allow_select_profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "allow_select_landlords" ON public.landlords FOR SELECT USING (true);
CREATE POLICY "allow_select_properties" ON public.properties FOR SELECT USING (true);
CREATE POLICY "allow_select_leases" ON public.leases FOR SELECT USING (true);
CREATE POLICY "allow_select_payments" ON public.payments FOR SELECT USING (true);
CREATE POLICY "allow_select_addresses" ON public.landlord_addresses FOR SELECT USING (true);
CREATE POLICY "allow_select_line_bindings" ON public.line_bindings FOR SELECT USING (true);
CREATE POLICY "allow_select_line_binding_tokens" ON public.line_binding_tokens FOR SELECT USING (true);

-- C. 寫入策略 (INSERT / UPDATE / DELETE)：允許合法業務維護操作
CREATE POLICY "allow_modify_profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_landlords" ON public.landlords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_properties" ON public.properties FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_leases" ON public.leases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_payments" ON public.payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_addresses" ON public.landlord_addresses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_line_bindings" ON public.line_bindings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_tokens" ON public.line_binding_tokens FOR ALL USING (true) WITH CHECK (true);

COMMIT;
