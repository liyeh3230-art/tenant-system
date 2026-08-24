-- Smart Tenant System: production security hardening
--
-- Prerequisite: this migration targets supabase/schema.sql (UUID-based schema).
-- Do NOT run supabase/fix_sync.sql. It was a legacy development reset that
-- removed all authorization controls and is deliberately blocked now.
--
-- Before applying in production:
--   1. Back up the database.
--   2. Ensure the administrator's auth.users app_metadata contains
--      { "role": "superadmin" }, set only by a service-role/admin process.
--   3. Configure Supabase Auth email confirmation / SMTP as appropriate.

BEGIN;

DO $$
DECLARE
  id_type text;
BEGIN
  SELECT data_type INTO id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id';

  IF id_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION
      'This migration requires the UUID schema in supabase/schema.sql. The legacy fix_sync schema must be migrated separately; do not weaken RLS to make it work.';
  END IF;
END;
$$;

-- Never allow the browser to create a superadmin. The claim is signed in the
-- JWT and can only be written through Supabase's privileged admin API.
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'superadmin', false);
$$;

-- A landlord must have an approved, active account before writing landlord data.
CREATE OR REPLACE FUNCTION public.is_landlord()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.landlords l ON l.id = p.id
    WHERE p.id = auth.uid()
      AND p.role = 'landlord'
      AND p.deleted_at IS NULL
      AND l.status = 'active'
      AND l.deleted_at IS NULL
  );
$$;

-- Profiles are created only when Supabase Auth creates a user. A user can
-- request landlord status, but receives a pending account and no write access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_role text := COALESCE(NEW.raw_user_meta_data ->> 'requested_role', 'tenant');
  profile_role public.user_role_enum;
  display_name text := LEFT(COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'name', ''), '會員'), 100);
  phone_number text := LEFT(REGEXP_REPLACE(COALESCE(NEW.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g'), 20);
BEGIN
  profile_role := CASE WHEN requested_role = 'landlord' THEN 'landlord'::public.user_role_enum ELSE 'tenant'::public.user_role_enum END;

  IF length(phone_number) < 8 THEN
    RAISE EXCEPTION 'A valid phone number is required to create a profile';
  END IF;

  INSERT INTO public.profiles (id, role, name, phone)
  VALUES (NEW.id, profile_role, display_name, phone_number)
  ON CONFLICT (id) DO NOTHING;

  IF profile_role = 'landlord' THEN
    INSERT INTO public.landlords (id, status, ad_listing_enabled)
    VALUES (NEW.id, 'pending', false)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.tenants (id, status)
    VALUES (NEW.id, 'active')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Remove the unsafe policies that may have been introduced by old scripts.
DROP POLICY IF EXISTS "Allow all for profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all for landlords" ON public.landlords;
DROP POLICY IF EXISTS "Allow all for landlord_addresses" ON public.landlord_addresses;
DROP POLICY IF EXISTS "Allow all for properties" ON public.properties;
DROP POLICY IF EXISTS "Allow all for leases" ON public.leases;
DROP POLICY IF EXISTS "Allow all for payments" ON public.payments;
DROP POLICY IF EXISTS "Allow all for audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow all for line_binding_tokens" ON public.line_binding_tokens;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_binding_tokens ENABLE ROW LEVEL SECURITY;

-- Do not let users alter profile.role even if they own the row.
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE INSERT, DELETE, UPDATE ON TABLE public.profiles FROM authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (name, phone, avatar_url) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS "Profiles read policy" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
CREATE POLICY "Profiles select own or authorized" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_superadmin()
    OR (
      public.is_landlord() AND EXISTS (
        SELECT 1 FROM public.leases l
        WHERE l.landlord_id = auth.uid() AND l.tenant_id = profiles.id AND l.deleted_at IS NULL
      )
    )
  );
CREATE POLICY "Profiles update safe columns" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Landlords read policy" ON public.landlords;
DROP POLICY IF EXISTS "Landlords modify policy" ON public.landlords;
CREATE POLICY "Landlords select own or admin" ON public.landlords
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_superadmin());

DROP POLICY IF EXISTS "Properties write policy" ON public.properties;
CREATE POLICY "Properties insert own landlord" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());
CREATE POLICY "Properties update own landlord" ON public.properties
  FOR UPDATE TO authenticated
  USING (landlord_id = auth.uid() AND public.is_landlord())
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());
CREATE POLICY "Properties delete own landlord" ON public.properties
  FOR DELETE TO authenticated
  USING (landlord_id = auth.uid() AND public.is_landlord());

DROP POLICY IF EXISTS "Leases write policy" ON public.leases;
CREATE POLICY "Leases insert own landlord" ON public.leases
  FOR INSERT TO authenticated
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());
CREATE POLICY "Leases update own landlord" ON public.leases
  FOR UPDATE TO authenticated
  USING (landlord_id = auth.uid() AND public.is_landlord())
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());
CREATE POLICY "Leases delete own landlord" ON public.leases
  FOR DELETE TO authenticated
  USING (landlord_id = auth.uid() AND public.is_landlord());

DROP POLICY IF EXISTS "Bills write policy" ON public.bills;
CREATE POLICY "Bills insert own landlord" ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());
CREATE POLICY "Bills update own landlord" ON public.bills
  FOR UPDATE TO authenticated
  USING (landlord_id = auth.uid() AND public.is_landlord())
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());
CREATE POLICY "Bills delete own landlord" ON public.bills
  FOR DELETE TO authenticated
  USING (landlord_id = auth.uid() AND public.is_landlord());

-- Payments are immutable from the client apart from a landlord creating a
-- record for their own lease. Status changes must use the RPC below.
DROP POLICY IF EXISTS "Payments insert policy" ON public.payments;
DROP POLICY IF EXISTS "Payments update policy" ON public.payments;
CREATE POLICY "Payments insert own landlord" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (landlord_id = auth.uid() AND public.is_landlord());

-- The application must never write audit history directly.
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_landlord_account(p_landlord_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'superadmin role required';
  END IF;
  UPDATE public.landlords
     SET status = 'active', approved_at = NOW(), approved_by = auth.uid(), updated_at = NOW()
   WHERE id = p_landlord_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'landlord account not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_landlord_account(p_landlord_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'superadmin role required';
  END IF;
  UPDATE public.landlords
     SET status = 'suspended', updated_at = NOW()
   WHERE id = p_landlord_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'landlord account not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_landlord_ad_listing(p_landlord_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'superadmin role required';
  END IF;
  UPDATE public.landlords
     SET ad_listing_enabled = p_enabled, updated_at = NOW()
   WHERE id = p_landlord_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'landlord account not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_payment_status(
  p_payment_id uuid,
  p_new_status public.payment_status_enum,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_actor_role text;
  v_method public.payment_method_enum;
  v_last_five text;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment not found';
  END IF;

  IF public.is_superadmin() THEN
    v_actor_role := 'superadmin';
  ELSIF v_payment.landlord_id = auth.uid() AND public.is_landlord() THEN
    v_actor_role := 'landlord';
  ELSIF v_payment.tenant_id = auth.uid() THEN
    v_actor_role := 'tenant';
  ELSE
    RAISE EXCEPTION 'payment access denied';
  END IF;

  IF v_actor_role = 'tenant' THEN
    IF v_payment.status NOT IN ('pending', 'rejected') OR p_new_status <> 'tenant_submitted' THEN
      RAISE EXCEPTION 'tenant may only submit an existing pending or rejected payment';
    END IF;
    v_method := CASE p_metadata ->> 'paymentMethod'
      WHEN 'bank_transfer' THEN 'bank_transfer'::public.payment_method_enum
      WHEN 'cash' THEN 'cash'::public.payment_method_enum
      ELSE NULL
    END;
    IF v_method IS NULL THEN
      RAISE EXCEPTION 'a supported payment method is required';
    END IF;
    v_last_five := NULLIF(REGEXP_REPLACE(COALESCE(p_metadata ->> 'transferLast5', ''), '[^0-9]', '', 'g'), '');
    IF v_method = 'bank_transfer'::public.payment_method_enum AND (v_last_five IS NULL OR length(v_last_five) <> 5) THEN
      RAISE EXCEPTION 'bank transfer requires exactly five digits';
    END IF;
    UPDATE public.payments
       SET status = 'tenant_submitted', method = v_method,
           bank_last_five = CASE WHEN v_method = 'bank_transfer'::public.payment_method_enum THEN v_last_five ELSE NULL END,
           submitted_at = NOW(), updated_at = NOW()
     WHERE id = v_payment.id;
  ELSIF v_actor_role = 'landlord' THEN
    IF p_new_status = 'paid' AND v_payment.status = 'tenant_submitted' THEN
      UPDATE public.payments SET status = 'paid', confirmed_at = NOW(), updated_at = NOW() WHERE id = v_payment.id;
      UPDATE public.bills SET status = 'paid', updated_at = NOW() WHERE id = v_payment.bill_id;
    ELSIF p_new_status = 'rejected' AND v_payment.status = 'tenant_submitted' THEN
      UPDATE public.payments SET status = 'rejected', rejected_reason = NULLIF(p_metadata ->> 'reason', ''), updated_at = NOW() WHERE id = v_payment.id;
    ELSIF p_new_status = 'void' AND v_payment.status IN ('pending', 'rejected') THEN
      UPDATE public.payments SET status = 'void', updated_at = NOW() WHERE id = v_payment.id;
      UPDATE public.bills SET status = 'void', updated_at = NOW() WHERE id = v_payment.bill_id;
    ELSE
      RAISE EXCEPTION 'invalid landlord payment transition';
    END IF;
  ELSE
    RAISE EXCEPTION 'superadmin payment changes require an audited server-side workflow';
  END IF;

  INSERT INTO public.payment_events (payment_id, actor_id, actor_role, action, old_status, new_status, metadata)
  VALUES (v_payment.id, auth.uid(), v_actor_role, 'transition_status', v_payment.status, p_new_status, p_metadata);
  INSERT INTO public.audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    auth.uid(), v_actor_role, 'PAYMENT_STATUS_' || p_new_status::text, 'payment', v_payment.id::text,
    jsonb_build_object('status', v_payment.status, 'amount', v_payment.amount),
    jsonb_build_object('status', p_new_status, 'amount', v_payment.amount)
  );

  RETURN jsonb_build_object('success', true, 'paymentId', v_payment.id, 'newStatus', p_new_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_line_binding_token(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_expires_at timestamptz := NOW() + INTERVAL '10 minutes';
BEGIN
  IF auth.uid() <> p_tenant_id AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'cannot generate a token for another tenant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'tenant account not found';
  END IF;

  v_token := UPPER(ENCODE(EXTENSIONS.GEN_RANDOM_BYTES(16), 'hex'));
  UPDATE public.line_binding_tokens SET used_at = NOW() WHERE tenant_id = p_tenant_id AND used_at IS NULL;
  INSERT INTO public.line_binding_tokens (tenant_id, token, expires_at) VALUES (p_tenant_id, v_token, v_expires_at);
  RETURN jsonb_build_object('token', v_token, 'expiresAt', v_expires_at, 'expiresInSeconds', 600);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_and_bind_line(
  p_token varchar(64),
  p_line_user_id varchar(100),
  p_line_display_name varchar(100)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_record public.line_binding_tokens%ROWTYPE;
BEGIN
  -- This function is callable by the LINE webhook's service_role only.
  SELECT * INTO v_record
  FROM public.line_binding_tokens
  WHERE token = UPPER(TRIM(p_token)) AND used_at IS NULL AND expires_at > NOW()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired line binding token';
  END IF;
  UPDATE public.line_binding_tokens SET used_at = NOW() WHERE id = v_record.id;
  INSERT INTO public.tenant_line_accounts (tenant_id, line_user_id, line_display_name, status, linked_at, last_seen_at)
  VALUES (v_record.tenant_id, p_line_user_id, p_line_display_name, 'active', NOW(), NOW())
  ON CONFLICT (tenant_id) DO UPDATE
    SET line_user_id = EXCLUDED.line_user_id, line_display_name = EXCLUDED.line_display_name,
        status = 'active', last_seen_at = NOW();
  RETURN jsonb_build_object('success', true);
END;
$$;

-- SECURITY DEFINER functions must be explicitly allow-listed.
REVOKE EXECUTE ON FUNCTION public.approve_landlord_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_landlord_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_landlord_ad_listing(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transition_payment_status(uuid, public.payment_status_enum, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_line_binding_token(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_and_bind_line(varchar, varchar, varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_landlord_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_landlord_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_landlord_ad_listing(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_payment_status(uuid, public.payment_status_enum, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_line_binding_token(uuid) TO authenticated;

COMMIT;
