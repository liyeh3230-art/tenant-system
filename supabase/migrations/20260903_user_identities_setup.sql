-- ============================================================================
-- 智慧租屋系統 - 多平台第三方登入身分關聯表 (Multi-Provider User Identities)
-- 支援 LINE、Facebook 第三方登入與手機號碼帳號主體歸戶
-- ============================================================================

-- 1. 建立第三方身分關聯表 (User Identities)
CREATE TABLE IF NOT EXISTS public.user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('line', 'facebook', 'google', 'apple')),
  provider_user_id VARCHAR(128) NOT NULL,
  display_name VARCHAR(100),
  avatar_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_provider_provider_user_id UNIQUE (provider, provider_user_id)
);

-- 2. 建立索引加速多平台查詢
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON public.user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_lookup ON public.user_identities(provider, provider_user_id);

-- 3. 啟用 Row Level Security (RLS)
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;

-- 4. 讀取與寫入策略 (安全保護)
DROP POLICY IF EXISTS "Public user_identities select policy" ON public.user_identities;
CREATE POLICY "Public user_identities select policy" ON public.user_identities FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public user_identities insert policy" ON public.user_identities;
CREATE POLICY "Public user_identities insert policy" ON public.user_identities FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public user_identities update policy" ON public.user_identities;
CREATE POLICY "Public user_identities update policy" ON public.user_identities FOR UPDATE USING (true);

COMMENT ON TABLE public.user_identities IS '儲存 LINE、Facebook 等第三方 OAuth 授權與手機帳號之歸戶關聯';
