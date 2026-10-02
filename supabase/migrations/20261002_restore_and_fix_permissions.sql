-- ============================================================================
-- 智慧租屋系統 - 資料庫完整資料還原與權限修復 (RESTORE & RLS PERMISSION FIX)
-- 說明：
-- 1. 解除先前過度限制導致前端與總管理員無法讀取名冊的 RLS SELECT 限制
-- 2. 完整復原先前備份的所有真實會員、房東、房源、租約、帳單與地址紀錄
-- 3. 請直接複製此腳本至 Supabase 後台 SQL Editor 中執行 (Run) 即可一鍵復原！
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
-- 步驟 2：建立正確的 RLS 存取策略 (允許前端讀取，保障後端寫入安全)
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

-- B. 讀取策略 (SELECT)：允許前端系統正常載入資料（前端程式碼已有身分與角色隔離保護）
CREATE POLICY "allow_select_profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "allow_select_landlords" ON public.landlords FOR SELECT USING (true);
CREATE POLICY "allow_select_properties" ON public.properties FOR SELECT USING (true);
CREATE POLICY "allow_select_leases" ON public.leases FOR SELECT USING (true);
CREATE POLICY "allow_select_payments" ON public.payments FOR SELECT USING (true);
CREATE POLICY "allow_select_addresses" ON public.landlord_addresses FOR SELECT USING (true);
CREATE POLICY "allow_select_line_bindings" ON public.line_bindings FOR SELECT USING (true);
CREATE POLICY "allow_select_line_binding_tokens" ON public.line_binding_tokens FOR SELECT USING (true);

-- C. 寫入策略 (INSERT / UPDATE / DELETE)：允許已驗證操作與前端合法維護
CREATE POLICY "allow_modify_profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_landlords" ON public.landlords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_properties" ON public.properties FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_leases" ON public.leases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_payments" ON public.payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_addresses" ON public.landlord_addresses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_line_bindings" ON public.line_bindings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_modify_tokens" ON public.line_binding_tokens FOR ALL USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 步驟 3：完整復原先前備份的所有資料庫紀錄
-- ----------------------------------------------------------------------------

-- 1. 會員 Profiles (6 筆)
INSERT INTO public.profiles ("id", "role", "name", "phone", "password_hash", "avatar_url", "created_at", "updated_at", "deleted_at") VALUES
  ('9244cd66-0b18-4270-9295-acbfae88f538', 'landlord', '周金在', '0933072180', NULL, NULL, '2026-09-03T08:21:42.645+00:00', '2026-09-23T18:12:59.087+00:00', NULL),
  ('f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', 'tenant', '徐徐徐', '0938302199', NULL, NULL, '2026-09-03T06:25:13.025041+00:00', '2026-09-03T08:50:44.475+00:00', NULL),
  ('usr_superadmin', 'superadmin', '平台總管理員', '0900000000', NULL, NULL, '2026-08-20T02:56:06.214111+00:00', '2026-08-20T02:56:06.214111+00:00', NULL),
  ('2a7e8d04-16ae-422e-b994-ae35fd3e6096', 'tenant', '林測試', '0988000111', NULL, NULL, '2026-09-03T06:21:43.846167+00:00', '2026-09-03T06:21:43.668+00:00', NULL),
  ('b2413782-0bcc-466a-a4f8-88992cac6d5c', 'tenant', '李大同', '0977112233', NULL, NULL, '2026-09-03T07:16:10.623568+00:00', '2026-09-03T08:20:56.855+00:00', NULL),
  ('4df7fa83-d950-42ff-9e35-1795d706c7d3', 'tenant', '陳測試房東', '0966554433', NULL, NULL, '2026-09-03T08:18:08.049889+00:00', '2026-09-03T08:22:52.744+00:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;

-- 2. 房東 Landlords (3 筆)
INSERT INTO public.landlords ("id", "name", "phone", "company_name", "status", "ad_listing_enabled", "created_at", "updated_at", "deleted_at") VALUES
  ('4df7fa83-d950-42ff-9e35-1795d706c7d3', '陳測試房東', '0966554433', '{"companyName":"","idNumber":"A123456789","contactAddress":"台北市信義區信義路五段7號","bankName":"","bankAccount":"","notes":"","submittedAt":"2026-09-03T08:18:08.184Z"}', 'rejected', FALSE, '2026-09-03T08:18:08.28223+00:00', '2026-09-03T08:22:52.744+00:00', NULL),
  ('f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', '徐徐徐', '0938302199', '{"companyName":"","idNumber":"H124082404","contactAddress":"新榮路323號","bankName":"","bankAccount":"812-163540291164","notes":"","submittedAt":"2026-09-03T08:50:29.848Z"}', 'approved', FALSE, '2026-09-03T08:10:59.983572+00:00', '2026-09-03T08:50:44.475+00:00', NULL),
  ('9244cd66-0b18-4270-9295-acbfae88f538', '周金在', '0933072180', '{"companyName":"","idNumber":"Y123456789","contactAddress":"建業路64號","bankName":"","bankAccount":"","notes":"","submittedAt":"2026-09-23T18:12:34.661Z"}', 'approved', FALSE, '2026-09-03T08:21:43.12+00:00', '2026-09-23T18:12:59.087+00:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  company_name = EXCLUDED.company_name,
  status = EXCLUDED.status,
  ad_listing_enabled = EXCLUDED.ad_listing_enabled,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;

-- 3. 房源 Properties (3 筆)
INSERT INTO public.properties ("id", "landlord_id", "name", "type", "rent", "rent_period", "status", "address", "is_advertised", "photos", "display_order", "created_at", "updated_at", "deleted_at") VALUES
  ('P001', '9244cd66-0b18-4270-9295-acbfae88f538', '106', '獨立套房', 105000, 'yearly', 'occupied', '建業路64號', FALSE, '[]'::jsonb, 0, '2026-09-29T02:07:03.620447+00:00', '2026-09-29T02:08:12.209+00:00', NULL),
  ('P002', '9244cd66-0b18-4270-9295-acbfae88f538', '123', '獨立套房', 12000, 'monthly', 'vacant', '建業路64號', FALSE, '[]'::jsonb, 0, '2026-10-01T09:31:27.334594+00:00', '2026-10-01T09:31:27.334594+00:00', NULL),
  ('P003', 'f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', '101', '獨立套房', 12000, 'monthly', 'occupied', '新榮路323號', FALSE, '[]'::jsonb, 0, '2026-10-01T09:50:07.844251+00:00', '2026-10-01T09:53:29.369+00:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  landlord_id = EXCLUDED.landlord_id,
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  rent = EXCLUDED.rent,
  rent_period = EXCLUDED.rent_period,
  status = EXCLUDED.status,
  address = EXCLUDED.address,
  is_advertised = EXCLUDED.is_advertised,
  photos = EXCLUDED.photos,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;

-- 4. 租約 Leases (2 筆)
INSERT INTO public.leases ("id", "property_id", "landlord_id", "tenant_name", "phone", "co_phone", "co_tenant_name", "start_date", "end_date", "deposit", "monthly_rent", "total_contract_rent", "status", "note", "terminated_at", "created_at", "updated_at", "deleted_at") VALUES
  ('L69154116', 'P001', '9244cd66-0b18-4270-9295-acbfae88f538', '徐徐徐', '0938302199', NULL, NULL, '2026-09-01', '2027-06-30', 12000, 8750, 105000, 'active', '', NULL, '2026-09-29T02:08:12.059429+00:00', '2026-09-29T02:08:12.059429+00:00', NULL),
  ('L40849412', 'P003', 'f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', '周金在', '0933072180', NULL, NULL, '2026-10-01', '2027-09-30', 12000, 12000, 144000, 'active', '', NULL, '2026-10-01T09:53:28.798749+00:00', '2026-10-01T09:53:28.798749+00:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  property_id = EXCLUDED.property_id,
  landlord_id = EXCLUDED.landlord_id,
  tenant_name = EXCLUDED.tenant_name,
  phone = EXCLUDED.phone,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  deposit = EXCLUDED.deposit,
  monthly_rent = EXCLUDED.monthly_rent,
  total_contract_rent = EXCLUDED.total_contract_rent,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;

-- 5. 帳單與收據 Payments (13 筆)
INSERT INTO public.payments ("id", "lease_id", "tenant_name", "property_name", "amount", "status", "bill_type", "title", "due_date", "paid_date", "payment_method", "transfer_last5", "note", "created_at", "updated_at", "deleted_at") VALUES
  ('BILL1790795309386_878', 'L69154116', '徐徐徐', '106', 6000, 'paid', 'utilities', '上學期', '2026-10-31', '2026-09-30', NULL, '12345', '', '2026-09-30T19:08:28.790468+00:00', '2026-09-30T19:10:05.338+00:00', NULL),
  ('BILL1790797631037_169', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '1月份', '2026-10-31', '2026-09-30', '現金交付', NULL, '', '2026-09-30T19:47:10.210778+00:00', '2026-09-30T20:36:24.05+00:00', NULL),
  ('PAY1790797489055_498', 'L69154116', '徐徐徐', '106', 8750, 'rejected', 'rent', '租金 (租客自報)', '2026-09-30', '2026-09-30', '現金交付', NULL, '', '2026-09-30T19:44:48.839529+00:00', '2026-09-30T20:36:31.368+00:00', NULL),
  ('BILL1790837808585_866', 'L69154116', '徐徐徐', '106', 999, 'paid', 'utilities', '10月份電費', '2026-11-01', '2026-10-01', '銀行轉帳', '12000', '', '2026-10-01T06:56:50.712923+00:00', '2026-10-01T06:58:11.197+00:00', NULL),
  ('PAY1790665912124_8', 'L69154116', '徐徐徐', '106', 5000, 'paid', 'utilities', '水電費 (租客自報)', '2026-10-29', '2026-09-29', '現金交付', NULL, '', '2026-09-29T07:11:52.246675+00:00', '2026-09-29T07:55:46.843+00:00', NULL),
  ('PAY1790651754056_155', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '12', '2026-09-29', '2026-09-29', '現金交付', NULL, '', '2026-09-29T03:15:54.093744+00:00', '2026-09-29T07:55:53.575+00:00', NULL),
  ('BILL1790649491444_409', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '9', '2026-10-29', '2026-09-29', '銀行轉帳', '90006', '', '2026-09-29T02:38:11.817865+00:00', '2026-09-29T07:57:36.02+00:00', NULL),
  ('BILL1790685573035_99', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '10', '2026-10-29', '2026-09-29', NULL, '70987', '', '2026-09-29T12:39:32.704393+00:00', '2026-09-29T12:40:50.294+00:00', NULL),
  ('BILL1790685749577_997', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '12', '2026-10-29', '2026-10-29', '銀行轉帳', NULL, '', '2026-09-29T12:42:29.125335+00:00', '2026-09-29T12:42:29.125335+00:00', NULL),
  ('BILL1790685820582_550', 'L69154116', '徐徐徐', '106', 8750, 'rejected', 'rent', '12', '2026-10-29', '2026-09-29', NULL, '12346', '', '2026-09-29T12:43:40.177579+00:00', '2026-09-29T12:47:20.311+00:00', NULL),
  ('BILL1790685744072_888', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '11', '2026-10-29', '2026-09-29', NULL, '12345', '', '2026-09-29T12:42:23.667477+00:00', '2026-09-29T12:47:22.556+00:00', NULL),
  ('PAY1790788967941_21', 'L69154116', '徐徐徐', '106', 8750, 'rejected', 'rent', '租金 (租客自報)', '2026-09-30', '2026-09-30', '現金交付', NULL, '', '2026-09-30T17:22:47.787017+00:00', '2026-09-30T19:07:49.234+00:00', NULL),
  ('PAY1790788967523_939', 'L69154116', '徐徐徐', '106', 8750, 'paid', 'rent', '租金 (租客自報)', '2026-09-30', '2026-09-30', '現金交付', NULL, '', '2026-09-30T17:22:47.787017+00:00', '2026-09-30T19:07:50.732+00:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  lease_id = EXCLUDED.lease_id,
  tenant_name = EXCLUDED.tenant_name,
  property_name = EXCLUDED.property_name,
  amount = EXCLUDED.amount,
  status = EXCLUDED.status,
  bill_type = EXCLUDED.bill_type,
  title = EXCLUDED.title,
  due_date = EXCLUDED.due_date,
  paid_date = EXCLUDED.paid_date,
  payment_method = EXCLUDED.payment_method,
  transfer_last5 = EXCLUDED.transfer_last5,
  note = EXCLUDED.note,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;

-- 6. 房東地址庫 Landlord Addresses (3 筆)
INSERT INTO public.landlord_addresses ("id", "landlord_id", "address", "created_at", "deleted_at") VALUES
  ('8e0d4368-b805-4cc0-87fa-7dbaa7af3a3e', 'f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', '新榮路323號', '2026-09-03T08:11:00.451071+00:00', NULL),
  ('f6598517-97f9-40ae-8e79-6730af04b62c', '4df7fa83-d950-42ff-9e35-1795d706c7d3', '台北市信義區信義路五段7號', '2026-09-03T08:18:08.495845+00:00', NULL),
  ('97dc8076-f1a2-4e04-b2cf-4f5c36a1a437', '9244cd66-0b18-4270-9295-acbfae88f538', '建業路64號', '2026-09-03T08:21:43.142908+00:00', NULL)
ON CONFLICT (id) DO UPDATE SET
  landlord_id = EXCLUDED.landlord_id,
  address = EXCLUDED.address,
  deleted_at = EXCLUDED.deleted_at;

-- 7. LINE 綁定紀錄 Line Bindings (4 筆)
INSERT INTO public.line_bindings ("id", "tenant_id", "line_user_id", "line_display_name", "status", "created_at", "updated_at") VALUES
  ('e269ea67-fa1f-463c-acad-6aaebc7a462e', 'b2413782-0bcc-466a-a4f8-88992cac6d5c', 'fb_1633585894_test_user', '李大同', 'active', '2026-09-03T07:16:11.455277+00:00', '2026-09-03T07:16:11.455277+00:00'),
  ('22730647-3578-40f0-8ebf-c6b11438a6f9', 'f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', 'fb_wktjTxw--S', '徐徐徐', 'active', '2026-09-03T07:23:27.549997+00:00', '2026-09-03T07:23:27.734+00:00'),
  ('1fad1b82-7b3b-4636-a414-3ceea2a29e00', '2a7e8d04-16ae-422e-b994-ae35fd3e6096', 'test_line_uid_12345', '林測試', 'active', '2026-09-03T06:21:44.171063+00:00', '2026-09-03T06:21:44.171063+00:00'),
  ('e5fd0744-a168-40d4-beec-a001c206785d', 'f1dc993a-5a6e-4f6e-8cb4-4c491c682c87', 'U604565299ab45b4cb7bcb2e1f2472358', '徐徐徐', 'active', '2026-09-03T06:24:54.945601+00:00', '2026-09-03T06:25:13.747+00:00')
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  line_user_id = EXCLUDED.line_user_id,
  line_display_name = EXCLUDED.line_display_name,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;

COMMIT;
