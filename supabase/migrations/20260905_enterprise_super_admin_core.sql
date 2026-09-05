-- ============================================================================
-- Enterprise Super Admin Core — AccountX Control Suite
-- Idempotent migration: safe to re-run. All objects use IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS guards.
--
-- Contents:
--   1. Platform Announcements Engine (table + strict RLS)
--   2. Subscription Tiers & Strict Usage Quotas (businesses columns)
--   3. Enterprise Telemetry & Audit Log (table + helper + triggers)
--   4. Administrative Stored Procedures (SECURITY DEFINER, super-admin gated)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Prerequisites
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Shared super-admin gate, matching the 064 convention (JWT app_metadata with
-- auth.users fallback). SECURITY DEFINER so RLS on auth.users never blocks it.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super boolean := false;
BEGIN
  BEGIN
    SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false)
    INTO v_is_super;
  EXCEPTION WHEN OTHERS THEN
    v_is_super := false;
  END;

  IF v_is_super IS NOT TRUE THEN
    SELECT coalesce((raw_app_meta_data ->> 'is_super_admin')::boolean, false)
    INTO v_is_super
    FROM auth.users
    WHERE id = auth.uid();
  END IF;

  RETURN coalesce(v_is_super, false);
END
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ============================================================================
-- 1. PLATFORM ANNOUNCEMENTS ENGINE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical', 'maintenance')),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  target_tier text NOT NULL DEFAULT 'all',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_active
  ON public.platform_announcements (is_active, expires_at)
  WHERE is_active = true;

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_announcements_super_admin_all" ON public.platform_announcements;
CREATE POLICY "platform_announcements_super_admin_all"
  ON public.platform_announcements
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "platform_announcements_tenant_select" ON public.platform_announcements;
CREATE POLICY "platform_announcements_tenant_select"
  ON public.platform_announcements
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );

-- ============================================================================
-- 2. SUBSCRIPTION TIERS & STRICT USAGE QUOTAS (extends public.businesses)
-- ============================================================================
-- 2a. Guarantee prerequisite columns that older/newer schemas may lack.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2b. Reconcile legacy display-name tiers ('Free Tier' etc., from 065) to the
-- canonical lowercase tier set. Drop ANY pre-existing check constraint on
-- subscription_tier first (its auto-generated name is unknown), then normalize.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subscription_tier text;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.businesses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%subscription_tier%'
  LOOP
    EXECUTE format('ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END
$$;

UPDATE public.businesses
SET subscription_tier = CASE subscription_tier
  WHEN 'Free Tier' THEN 'free'
  WHEN 'Professional Plan' THEN 'pro'
  WHEN 'Enterprise GST' THEN 'enterprise'
  ELSE 'free'
END
WHERE subscription_tier IS NULL
   OR subscription_tier NOT IN ('free', 'starter', 'pro', 'enterprise');

ALTER TABLE public.businesses
  ALTER COLUMN subscription_tier SET DEFAULT 'free',
  ALTER COLUMN subscription_tier SET NOT NULL;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'starter', 'pro', 'enterprise')) NOT VALID;
-- Validate without a full table rewrite lock where supported; safe no-op otherwise.
DO $$
BEGIN
  ALTER TABLE public.businesses VALIDATE CONSTRAINT businesses_subscription_tier_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

-- 2c. Quota + lifecycle columns.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS max_invoices_per_month integer NOT NULL DEFAULT 50;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS max_staff_members integer NOT NULL DEFAULT 2;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS storage_limit_mb integer NOT NULL DEFAULT 250;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'active';
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS subscription_renewed_at timestamptz NOT NULL DEFAULT now();

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.businesses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%subscription_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END
$$;

UPDATE public.businesses
SET subscription_status = 'active'
WHERE subscription_status IS NULL
   OR subscription_status NOT IN ('active', 'past_due', 'canceled', 'trial');

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_subscription_status_check
  CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trial')) NOT VALID;

DO $$
BEGIN
  ALTER TABLE public.businesses VALIDATE CONSTRAINT businesses_subscription_status_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

ALTER TABLE public.businesses
  ALTER COLUMN subscription_expires_at SET DEFAULT (now() + interval '30 days');

UPDATE public.businesses
SET subscription_expires_at = now() + interval '30 days'
WHERE subscription_expires_at IS NULL;

-- ============================================================================
-- 3. ENTERPRISE TELEMETRY & REAL-TIME AUDIT LOG
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  action text NOT NULL,
  target_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target
  ON public.admin_audit_logs (target_business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action
  ON public.admin_audit_logs (action, created_at DESC);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_logs_super_admin_all" ON public.admin_audit_logs;
CREATE POLICY "admin_audit_logs_super_admin_all"
  ON public.admin_audit_logs
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
-- NOTE: no tenant policy — audit telemetry is super-admin eyes only.

-- 3a. Internal helper: record one audit row (SECURITY DEFINER so the
-- businesses/announcements triggers can write despite RLS).
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_actor_email text,
  p_action text,
  p_target_business_id uuid DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.admin_audit_logs (actor_email, action, target_business_id, ip_address, metadata)
  VALUES (
    coalesce(nullif(p_actor_email, ''), 'system'),
    p_action,
    p_target_business_id,
    p_ip_address,
    coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, inet, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, inet, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, inet, jsonb) TO authenticated;

-- 3b. Resolve the acting admin's email + best-effort client IP for triggers.
CREATE OR REPLACE FUNCTION public._admin_actor_context()
RETURNS TABLE (actor_email text, ip_address inet)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_ip inet := NULL;
BEGIN
  BEGIN
    v_email := auth.jwt() ->> 'email';
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;
  IF v_email IS NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  END IF;

  BEGIN
    v_ip := nullif(
      (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for'),
      ''
    )::inet;
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  actor_email := coalesce(v_email, 'system');
  ip_address := v_ip;
  RETURN NEXT;
END
$$;

-- 3c. Auto-audit tenant mutations (block/activate, plan + quota changes).
CREATE OR REPLACE FUNCTION public.trg_audit_business_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ctx record;
  v_action text := 'TENANT_UPDATED';
  v_meta jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO ctx FROM public._admin_actor_context();

  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_action := CASE WHEN NEW.is_active THEN 'TENANT_ACTIVATED' ELSE 'TENANT_BLOCKED' END;
    v_meta := v_meta || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
  END IF;

  IF OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier
     OR OLD.subscription_status IS DISTINCT FROM NEW.subscription_status THEN
    IF v_action = 'TENANT_UPDATED' THEN v_action := 'PLAN_UPGRADED'; END IF;
    v_meta := v_meta || jsonb_build_object(
      'subscription_tier', jsonb_build_object('old', OLD.subscription_tier, 'new', NEW.subscription_tier),
      'subscription_status', jsonb_build_object('old', OLD.subscription_status, 'new', NEW.subscription_status)
    );
  END IF;

  IF OLD.max_invoices_per_month IS DISTINCT FROM NEW.max_invoices_per_month
     OR OLD.max_staff_members IS DISTINCT FROM NEW.max_staff_members
     OR OLD.storage_limit_mb IS DISTINCT FROM NEW.storage_limit_mb THEN
    IF v_action = 'TENANT_UPDATED' THEN v_action := 'QUOTA_INCREASED'; END IF;
    v_meta := v_meta || jsonb_build_object(
      'max_invoices_per_month', jsonb_build_object('old', OLD.max_invoices_per_month, 'new', NEW.max_invoices_per_month),
      'max_staff_members', jsonb_build_object('old', OLD.max_staff_members, 'new', NEW.max_staff_members),
      'storage_limit_mb', jsonb_build_object('old', OLD.storage_limit_mb, 'new', NEW.storage_limit_mb)
    );
  END IF;

  PERFORM public.log_admin_action(ctx.actor_email, v_action, NEW.id, ctx.ip_address, v_meta);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_businesses_admin_audit ON public.businesses;
CREATE TRIGGER trg_businesses_admin_audit
  AFTER UPDATE OF is_active, subscription_tier, subscription_status,
    max_invoices_per_month, max_staff_members, storage_limit_mb
  ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_business_change();

-- 3d. Auto-audit broadcasts.
CREATE OR REPLACE FUNCTION public.trg_audit_announcement()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ctx record;
BEGIN
  SELECT * INTO ctx FROM public._admin_actor_context();
  PERFORM public.log_admin_action(
    ctx.actor_email,
    'BROADCAST_SENT',
    NULL,
    ctx.ip_address,
    jsonb_build_object(
      'announcement_id', NEW.id,
      'title', NEW.title,
      'severity', NEW.severity,
      'target_tier', NEW.target_tier
    )
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_announcements_audit ON public.platform_announcements;
CREATE TRIGGER trg_announcements_audit
  AFTER INSERT
  ON public.platform_announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_audit_announcement();

-- ============================================================================
-- 4. ADMINISTRATIVE STORED PROCEDURES (SECURITY DEFINER, super-admin gated)
-- ============================================================================

-- 4a. Onboard a tenant atomically: business + owner assignment + audit row.
CREATE OR REPLACE FUNCTION public.admin_onboard_tenant(
  p_legal_name text,
  p_trade_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_gstin text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_tier text DEFAULT 'free',
  p_owner_id uuid DEFAULT NULL,
  p_owner_email text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_owner_id uuid := p_owner_id;
  v_tier text := coalesce(nullif(lower(p_tier), ''), 'free');
  v_has_is_active boolean := false;
  ctx record;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  IF v_tier NOT IN ('free', 'starter', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid subscription tier: %', p_tier;
  END IF;

  IF v_owner_id IS NULL AND p_owner_email IS NOT NULL THEN
    SELECT u.id INTO v_owner_id FROM auth.users u WHERE u.email = p_owner_email;
  END IF;

  INSERT INTO public.businesses (
    name, legal_name, email, gstin, address, city, state,
    subscription_tier, subscription_status,
    subscription_renewed_at, subscription_expires_at,
    owner_id
  )
  VALUES (
    coalesce(p_trade_name, p_legal_name),
    p_legal_name,
    p_email, p_gstin, p_address, p_city, p_state,
    v_tier, 'active',
    now(), now() + interval '30 days',
    coalesce(v_owner_id, auth.uid())
  )
  RETURNING id INTO v_business_id;

  IF v_owner_id IS NOT NULL THEN
    -- Core membership columns always exist; is_active is schema-version dependent.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'business_members' AND column_name = 'is_active'
    ) INTO v_has_is_active;

    IF v_has_is_active THEN
      EXECUTE 'INSERT INTO public.business_members (business_id, user_id, role, is_active)
               VALUES ($1, $2, ''owner'', true)
               ON CONFLICT (business_id, user_id) DO UPDATE SET role = ''owner'', is_active = true'
        USING v_business_id, v_owner_id;
    ELSE
      INSERT INTO public.business_members (business_id, user_id, role)
      VALUES (v_business_id, v_owner_id, 'owner')
      ON CONFLICT (business_id, user_id) DO UPDATE SET role = 'owner';
    END IF;
  END IF;

  SELECT * INTO ctx FROM public._admin_actor_context();
  PERFORM public.log_admin_action(
    ctx.actor_email, 'TENANT_ONBOARDED', v_business_id, ctx.ip_address,
    jsonb_build_object('legal_name', p_legal_name, 'tier', v_tier, 'owner_id', v_owner_id)
  );

  RETURN v_business_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_onboard_tenant(text, text, text, text, text, text, text, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_onboard_tenant(text, text, text, text, text, text, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_onboard_tenant(text, text, text, text, text, text, text, text, uuid, text) TO authenticated;

-- 4b. Deep platform metrics as a single JSON payload.
CREATE OR REPLACE FUNCTION public.admin_get_platform_deep_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_total_invoices bigint := 0;
  v_gmv numeric := 0;
  v_extra_invoices bigint := 0;
  v_extra_gmv numeric := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  SELECT count(*), coalesce(sum(grand_total), 0)
  INTO v_total_invoices, v_gmv
  FROM public.sales_invoices;

  -- Optional sibling table/view named `invoices` (older dumps); include if
  -- present. Best-effort: any failure here must never abort the metrics call.
  IF to_regclass('public.invoices') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT count(*), coalesce(sum(nullif(to_jsonb(t) ->> ''grand_total'', '''')::numeric), 0) FROM public.invoices t'
      INTO v_extra_invoices, v_extra_gmv;
      v_total_invoices := v_total_invoices + coalesce(v_extra_invoices, 0);
      v_gmv := v_gmv + coalesce(v_extra_gmv, 0);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  SELECT jsonb_build_object(
    'total_businesses', (SELECT count(*) FROM public.businesses),
    'active_businesses', (SELECT count(*) FROM public.businesses WHERE coalesce(is_active, true) = true),
    'blocked_businesses', (SELECT count(*) FROM public.businesses WHERE coalesce(is_active, true) = false),
    'by_tier', coalesce((
      SELECT jsonb_object_agg(subscription_tier, cnt)
      FROM (SELECT subscription_tier, count(*) AS cnt FROM public.businesses GROUP BY 1) s
    ), '{}'::jsonb),
    'by_status', coalesce((
      SELECT jsonb_object_agg(subscription_status, cnt)
      FROM (SELECT subscription_status, count(*) AS cnt FROM public.businesses GROUP BY 1) s
    ), '{}'::jsonb),
    'total_lifetime_invoices', v_total_invoices,
    'total_gmv_inr', v_gmv,
    'system_health', jsonb_build_object(
      'status', 'operational',
      'db_size_bytes', pg_database_size(current_database()),
      'checked_at', now()
    )
  ) INTO v_result;

  RETURN v_result;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_platform_deep_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_platform_deep_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_platform_deep_metrics() TO authenticated;

-- 4c. Bulk block / activate tenants in one call.
CREATE OR REPLACE FUNCTION public.admin_bulk_toggle_status(
  p_ids uuid[],
  p_status boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
  ctx record;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('updated', 0, 'requested', 0, 'status', p_status);
  END IF;

  UPDATE public.businesses
  SET is_active = p_status,
      updated_at = now()
  WHERE id = ANY (p_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT * INTO ctx FROM public._admin_actor_context();
  PERFORM public.log_admin_action(
    ctx.actor_email,
    CASE WHEN p_status THEN 'TENANT_ACTIVATED' ELSE 'TENANT_BLOCKED' END,
    NULL,
    ctx.ip_address,
    jsonb_build_object('bulk', true, 'requested', array_length(p_ids, 1), 'updated', v_updated, 'status', p_status, 'ids', p_ids)
  );

  RETURN jsonb_build_object('updated', v_updated, 'requested', array_length(p_ids, 1), 'status', p_status);
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_bulk_toggle_status(uuid[], boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_toggle_status(uuid[], boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_toggle_status(uuid[], boolean) TO authenticated;
