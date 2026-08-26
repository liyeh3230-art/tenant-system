-- ============================================================================
-- 徹底刪除會員帳號 RPC 函數 (包含 auth.users 與 profiles)
-- 避免前端刪除後在 auth.users 殘留孤立帳號導致後續「已被註冊但後台無資料」之問題
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_user_by_admin(target_user_id UUID, target_phone VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. 刪除 line_bindings
  DELETE FROM public.line_bindings 
  WHERE tenant_id = target_user_id::text 
     OR line_user_id = target_user_id::text;

  -- 2. 刪除 landlord_addresses
  DELETE FROM public.landlord_addresses 
  WHERE landlord_id = target_user_id;

  -- 3. 刪除 landlords
  DELETE FROM public.landlords 
  WHERE id = target_user_id 
     OR phone = target_phone;

  -- 4. 刪除 tenants
  DELETE FROM public.tenants 
  WHERE id = target_user_id;

  -- 5. 刪除 profiles
  DELETE FROM public.profiles 
  WHERE id = target_user_id 
     OR phone = target_phone;

  -- 6. 徹底從 auth.users 中刪除 (消除孤立身分憑證)
  DELETE FROM auth.users 
  WHERE id = target_user_id 
     OR email = (target_phone || '@rental-auth.internal');

  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'delete_user_by_admin error: %', SQLERRM;
    RETURN FALSE;
END;
$$;
