-- ============================================================================
-- # 057 — GST additive schema + Tally export/mapping backend
--         (GST/TALLY SHARED BACKEND, T101) [oscar]
--
-- A. ADDITIVE COLUMNS (no rewrites, defaults keep every existing row valid):
--   purchase_bills.place_of_supply text   -- bills were the only GSTR surface
--                                         -- missing POS (041 honest omission)
--   sales_invoices.is_reverse_charge bool DEFAULT false
--   sales_invoices.is_export bool DEFAULT false
--   purchase_bills.is_export bool DEFAULT false
--   businesses.state_code text            -- optional owner-maintained code
--
-- B. TALLY EXPORT HISTORY — audit of what left the building:
--   tally_export_history(business_id, created_by, created_at, date_from,
--     date_to, export_types text[], record/success/warning/error counts,
--     status, metadata jsonb). RLS: members read; writes ONLY through the
--     definer RPC (audit discipline - no direct INSERT/UPDATE/DELETE).
--
-- C. TALLY LEDGER MAPPINGS — per-business AccountX->Tally chart mapping.
--   UNIQUE(business_id, accountx_ledger). A NULL row for an account means
--   "canonical default" (identity name) at export time - absence is the
--   default, nothing is seeded. CRUD via definer RPCs (upsert/list);
--   direct delete allowed for cleanup.
--
-- All RPCs SECURITY DEFINER with explicit auth.uid() + membership/write
-- gates (house pattern 024/050), SET search_path = public.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Additive columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.purchase_bills ADD COLUMN IF NOT EXISTS place_of_supply text;
ALTER TABLE public.sales_invoices  ADD COLUMN IF NOT EXISTS is_reverse_charge boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales_invoices  ADD COLUMN IF NOT EXISTS is_export boolean NOT NULL DEFAULT false;
ALTER TABLE public.purchase_bills  ADD COLUMN IF NOT EXISTS is_export boolean NOT NULL DEFAULT false;
ALTER TABLE public.businesses      ADD COLUMN IF NOT EXISTS state_code text;

-- ----------------------------------------------------------------------------
-- B. Tally export history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tally_export_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  date_from date NOT NULL,
  date_to date NOT NULL,
  export_types text[] NOT NULL DEFAULT '{}',
  record_count bigint NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','partial','failed')),
  metadata jsonb
);

ALTER TABLE public.tally_export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tally_export_history_select" ON public.tally_export_history FOR SELECT
  TO authenticated USING (is_business_member(business_id));
-- writes flow through record_export only (definer bypasses RLS)

CREATE INDEX IF NOT EXISTS idx_tally_export_history_business_created
  ON public.tally_export_history(business_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- C. Tally ledger mappings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tally_ledger_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  accountx_ledger text NOT NULL,
  tally_ledger text NOT NULL,
  tally_parent text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, accountx_ledger)
);

ALTER TABLE public.tally_ledger_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tally_mappings_select" ON public.tally_ledger_mappings FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "tally_mappings_insert" ON public.tally_ledger_mappings FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "tally_mappings_update" ON public.tally_ledger_mappings FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "tally_mappings_delete" ON public.tally_ledger_mappings FOR DELETE
  TO authenticated USING (can_write_business(business_id));

-- ----------------------------------------------------------------------------
-- D. RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_tally_export(
  p_business_id uuid,
  p_date_from date,
  p_date_to date,
  p_export_types text[],
  p_record_count bigint DEFAULT 0,
  p_success_count integer DEFAULT 0,
  p_warning_count integer DEFAULT 0,
  p_error_count integer DEFAULT 0,
  p_status text DEFAULT 'completed',
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF p_status NOT IN ('completed','partial','failed') THEN
    RAISE EXCEPTION 'Invalid export status %', p_status;
  END IF;
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from must not exceed date_to';
  END IF;

  INSERT INTO tally_export_history (
    business_id, created_by, date_from, date_to, export_types,
    record_count, success_count, warning_count, error_count, status, metadata
  ) VALUES (
    p_business_id, v_uid, p_date_from, p_date_to, COALESCE(p_export_types, '{}'),
    p_record_count, p_success_count, p_warning_count, p_error_count, p_status, p_metadata
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_tally_exports(
  p_business_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  created_by uuid,
  created_at timestamptz,
  date_from date,
  date_to date,
  export_types text[],
  record_count bigint,
  success_count integer,
  warning_count integer,
  error_count integer,
  status text,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.created_by, t.created_at, t.date_from, t.date_to,
         t.export_types, t.record_count, t.success_count, t.warning_count,
         t.error_count, t.status, t.metadata
  FROM tally_export_history t
  WHERE t.business_id = p_business_id
    AND auth.uid() IS NOT NULL
    AND is_business_member(p_business_id)
  ORDER BY t.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
$$;

CREATE OR REPLACE FUNCTION public.upsert_tally_ledger_mapping(
  p_business_id uuid,
  p_accountx_ledger text,
  p_tally_ledger text,
  p_tally_parent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_clean text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  v_clean := btrim(COALESCE(p_accountx_ledger, ''));
  IF v_clean IS NULL OR v_clean = '' THEN
    RAISE EXCEPTION 'accountx_ledger is required';
  END IF;
  IF btrim(COALESCE(p_tally_ledger, '')) IS NULL OR btrim(COALESCE(p_tally_ledger, '')) = '' THEN
    RAISE EXCEPTION 'tally_ledger is required';
  END IF;

  INSERT INTO tally_ledger_mappings (
    business_id, accountx_ledger, tally_ledger, tally_parent, created_by
  ) VALUES (
    p_business_id, v_clean, btrim(p_tally_ledger),
    NULLIF(btrim(COALESCE(p_tally_parent, '')), ''), v_uid
  )
  ON CONFLICT (business_id, accountx_ledger) DO UPDATE SET
    tally_ledger = EXCLUDED.tally_ledger,
    tally_parent = EXCLUDED.tally_parent,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_tally_ledger_mapping(
  p_business_id uuid,
  p_accountx_ledger text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  DELETE FROM tally_ledger_mappings
  WHERE business_id = p_business_id
    AND accountx_ledger = btrim(COALESCE(p_accountx_ledger, ''));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_tally_export(uuid, date, date, text[], bigint, integer, integer, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_tally_exports(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_tally_ledger_mapping(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_tally_ledger_mapping(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_tally_export(uuid, date, date, text[], bigint, integer, integer, integer, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tally_exports(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tally_ledger_mapping(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tally_ledger_mapping(uuid, text) TO authenticated;
