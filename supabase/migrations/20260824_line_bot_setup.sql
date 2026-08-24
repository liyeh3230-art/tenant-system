-- ============================================================================
-- 智慧租屋系統 - LINE Bot 帳號綁定與即時推播資料表及 RPC 函式 (完整從頭建置)
-- ============================================================================

-- 1. LINE 綁定資料表 (紀錄哪位房客對應哪個 LINE User ID)
CREATE TABLE IF NOT EXISTS public.line_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  line_user_id TEXT UNIQUE NOT NULL,
  line_display_name TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 10 分鐘一次性短效驗證碼資料表
CREATE TABLE IF NOT EXISTS public.line_binding_tokens (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_line_bindings_tenant_id ON public.line_bindings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_line_bindings_line_user_id ON public.line_bindings(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_binding_tokens_token ON public.line_binding_tokens(token);

-- 4. 啟用 RLS
ALTER TABLE public.line_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_binding_tokens ENABLE ROW LEVEL SECURITY;

-- 允許已認證使用者與匿名使用者操作
DROP POLICY IF EXISTS "Public line_bindings select policy" ON public.line_bindings;
CREATE POLICY "Public line_bindings select policy" ON public.line_bindings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public line_binding_tokens select policy" ON public.line_binding_tokens;
CREATE POLICY "Public line_binding_tokens select policy" ON public.line_binding_tokens FOR SELECT USING (true);

-- 5. RPC 函式：產生 10 分鐘一次性短效驗證碼
CREATE OR REPLACE FUNCTION public.generate_line_binding_token(p_tenant_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- 隨機產生 6 碼大寫英數字
  v_token := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  v_expires_at := now() + interval '10 minutes';

  -- 寫入 Token 表
  INSERT INTO public.line_binding_tokens (token, tenant_id, expires_at, is_used)
  VALUES (v_token, p_tenant_id, v_expires_at, false)
  ON CONFLICT (token) DO UPDATE 
    SET tenant_id = EXCLUDED.tenant_id,
        expires_at = EXCLUDED.expires_at,
        is_used = false;

  RETURN jsonb_build_object(
    'token', v_token,
    'expiresAt', v_expires_at,
    'expiresInSeconds', 600
  );
END;
$$;

-- 6. RPC 函式：驗證並綁定 LINE 帳號
CREATE OR REPLACE FUNCTION public.verify_and_bind_line(
  p_token TEXT,
  p_line_user_id TEXT,
  p_line_display_name TEXT DEFAULT 'LINE User'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- 查詢 Token 是否有效且未過期
  SELECT * INTO v_rec
  FROM public.line_binding_tokens
  WHERE token = upper(trim(p_token))
    AND is_used = false
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION '驗證碼無效或已過期，請重新由租客系統產生新代碼。';
  END IF;

  -- 標記 Token 為已使用
  UPDATE public.line_binding_tokens
  SET is_used = true
  WHERE token = v_rec.token;

  -- 寫入或更新綁定關係
  INSERT INTO public.line_bindings (tenant_id, line_user_id, line_display_name, status, updated_at)
  VALUES (v_rec.tenant_id, p_line_user_id, p_line_display_name, 'active', now())
  ON CONFLICT (line_user_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        line_display_name = EXCLUDED.line_display_name,
        status = 'active',
        updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'tenantId', v_rec.tenant_id,
    'lineUserId', p_line_user_id
  );
END;
$$;
