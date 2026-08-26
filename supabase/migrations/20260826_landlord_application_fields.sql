-- ============================================================================
-- 房東身分審核與認證資料表欄位擴充
-- ============================================================================

ALTER TABLE public.landlords ADD COLUMN IF NOT EXISTS id_number VARCHAR(50);
ALTER TABLE public.landlords ADD COLUMN IF NOT EXISTS contact_address TEXT;
ALTER TABLE public.landlords ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
ALTER TABLE public.landlords ADD COLUMN IF NOT EXISTS bank_account VARCHAR(100);
ALTER TABLE public.landlords ADD COLUMN IF NOT EXISTS application_notes TEXT;
