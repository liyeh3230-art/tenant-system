-- ============================================================================
-- 徹底刪除會員帳號 RPC 函數 (包含 auth.users 與 profiles)
-- 避免前端刪除後在 auth.users 殘留孤立帳號導致後續「已被註冊但後台無資料」之問題
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_by_admin(target_user_id TEXT, target_phone VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_phone_clean VARCHAR;
BEGIN
  v_phone_clean := regexp_replace(COALESCE(target_phone, ''), '[^0-9]', '', 'g');

  -- 0. 關鍵防禦機制：絕對禁止刪除平台最高管理員 (Superadmin)
  IF v_phone_clean = '0900000000' OR target_user_id = 'usr_superadmin' THEN
    RAISE EXCEPTION '安全保護攔截：系統總管理員帳號禁止刪除！';
  END IF;

  -- 1. 刪除 line_bindings 與 line_binding_tokens
  DELETE FROM public.line_bindings 
  WHERE tenant_id = target_user_id 
     OR line_user_id = target_user_id
     OR (v_phone_clean <> '' AND user_id IN (SELECT id FROM public.profiles WHERE phone = v_phone_clean));

  DELETE FROM public.line_binding_tokens 
  WHERE tenant_id = target_user_id;

  -- 2. 刪除 landlord_addresses
  BEGIN
    DELETE FROM public.landlord_addresses 
    WHERE landlord_id::text = target_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 3. 刪除 landlords
  BEGIN
    DELETE FROM public.landlords 
    WHERE id::text = target_user_id 
       OR (v_phone_clean <> '' AND phone = v_phone_clean);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 4. 刪除 tenants
  BEGIN
    DELETE FROM public.tenants 
    WHERE id::text = target_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 5. 刪除 profiles (主檔)
  BEGIN
    DELETE FROM public.profiles 
    WHERE id::text = target_user_id 
       OR (v_phone_clean <> '' AND phone = v_phone_clean);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 6. 徹底從 auth.users 刪除帳號密碼與憑證 (消除密碼與孤立帳號)
  BEGIN
    DELETE FROM auth.users 
    WHERE (v_phone_clean <> '' AND email = (v_phone_clean || '@rental-auth.internal'))
       OR (v_phone_clean <> '' AND email = (v_phone_clean || '@tenant.local'))
       OR (v_phone_clean <> '' AND phone = v_phone_clean)
       OR id::text = target_user_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN TRUE;
END;
$$;
