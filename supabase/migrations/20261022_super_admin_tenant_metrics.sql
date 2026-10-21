-- ============================================================================
-- Super Admin Tenant Metrics — cross-tenant roll-up for the admin console
-- Idempotent: CREATE OR REPLACE, safe to re-run.
--
-- WHAT IT IS
--   public.super_admin_tenant_metrics() returns ONE row per business:
--     business_id, business_name, total_invoices, total_orders,
--     total_billed_amount, latest_invoice_numbers, last_activity_at
--   The Super Admin console joins on business_id, so a tenant with no
--   documents must still get a row (zeros, NULL document numbers).
--
-- WHY THE GATE AND THE GRANTS ARE DELIBERATE
--   * The function is SECURITY DEFINER and reads every tenant's documents, so
--     it bypasses RLS on purpose. The ONLY thing standing between a normal
--     user and cross-tenant data is the public.is_super_admin() gate below.
--     Never remove or weaken it, and never trust user_metadata here: the
--     server-side gate reads app_metadata only.
--   * EXECUTE is revoked from PUBLIC and anon and granted to authenticated
--     only, so the function is not callable by unauthenticated callers; the
--     gate then decides per caller.
--
-- THE HUMAN APPLIES THIS
--   There is no service_role key on this floor, so run this file in the
--   Supabase SQL editor (Dashboard > SQL Editor > New query > paste > Run).
--   It is idempotent and safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.super_admin_tenant_metrics()
RETURNS TABLE (
  business_id uuid,
  business_name text,
  total_invoices bigint,
  total_orders bigint,
  total_billed_amount numeric,
  latest_invoice_numbers text,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mandatory gate: this returns cross-tenant data, platform admins only.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'super admin access required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH   inv AS (
    SELECT si.business_id,
           count(*)::bigint AS invoice_count,
           -- Money measure: a cancelled or voided invoice was never billed, so
           -- it must not add to the tenant's volume. The count above stays the
           -- plain count of EVERY invoice row (a document count, not money) -
           -- the two are allowed to disagree, and that disagreement is the truth.
           -- Drafts stay IN: a draft is a live intent to bill and its amount is
           -- real.
           coalesce(
             sum(si.grand_total) FILTER (WHERE si.status NOT IN ('cancelled','void')),
             0
           )::numeric AS billed_amount,
           max(si.created_at) AS last_invoice_at
    FROM public.sales_invoices si
    GROUP BY si.business_id
  ),
  ord AS (
    SELECT so.business_id,
           count(*)::bigint AS order_count,
           max(so.created_at) AS last_order_at
    FROM public.sales_orders so
    GROUP BY so.business_id
  ),
  recent_docs AS (
    SELECT si.business_id, si.invoice_number AS doc_number, si.created_at
    FROM public.sales_invoices si
    UNION ALL
    SELECT so.business_id, so.order_number AS doc_number, so.created_at
    FROM public.sales_orders so
  ),
  ranked AS (
    -- One window per business: only the 5 newest documents are kept per
    -- tenant, so no tenant ever string_aggregates its whole document history.
    SELECT rd.business_id,
           rd.doc_number,
           row_number() OVER (
             PARTITION BY rd.business_id
             ORDER BY rd.created_at DESC, rd.doc_number DESC
           ) AS rn
    FROM recent_docs rd
  ),
  latest AS (
    SELECT r.business_id,
           string_agg(r.doc_number, ', ' ORDER BY r.rn) AS doc_numbers
    FROM ranked r
    WHERE r.rn <= 5
    GROUP BY r.business_id
  )
  SELECT b.id,
         coalesce(b.legal_name, b.name),
         coalesce(i.invoice_count, 0)::bigint,
         coalesce(o.order_count, 0)::bigint,
         coalesce(i.billed_amount, 0)::numeric,
         l.doc_numbers,
         CASE
           WHEN i.last_invoice_at IS NULL THEN o.last_order_at
           WHEN o.last_order_at IS NULL THEN i.last_invoice_at
           ELSE greatest(i.last_invoice_at, o.last_order_at)
         END
  FROM public.businesses b
  LEFT JOIN inv i ON i.business_id = b.id
  LEFT JOIN ord o ON o.business_id = b.id
  LEFT JOIN latest l ON l.business_id = b.id
  ORDER BY b.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.super_admin_tenant_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.super_admin_tenant_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.super_admin_tenant_metrics() TO authenticated;
