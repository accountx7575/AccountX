-- ============================================================================
-- Enterprise Tax Analytics, MRR Engine & Backup Pipeline — AccountX
-- Idempotent migration: safe to re-run. Uses CREATE OR REPLACE + guards.
--
-- Contents:
--   PHASE 1: admin_get_comprehensive_financials() — GMV/tax aggregator,
--            6-month GMV trajectory, AOV, payment clearance ratio, MRR/ARR,
--            churn indicators. Returns {financial_summary, tax_breakdown,
--            mrr_analytics, monthly_trends}.
--   PHASE 3: admin_export_full_platform_dump() — sanitized JSON snapshot.
--            admin_purge_stale_telemetry() — lock-friendly batched audit purge.
-- All routines SECURITY DEFINER, super-admin gated, revoked from PUBLIC/anon.
-- Requires: 20260905_enterprise_super_admin_core.sql (is_super_admin(),
--   canonical subscription tiers) — referenced, not redefined.
-- ============================================================================

-- ============================================================================
-- PHASE 1+2: COMPREHENSIVE FINANCIALS + LIVE MRR (single JSON payload)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_comprehensive_financials()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_invoices bigint := 0;
  v_gmv numeric := 0;
  v_taxable numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_igst numeric := 0;
  v_cess numeric := 0;
  v_paid_count bigint := 0;
  v_pending_count bigint := 0;
  v_overdue_count bigint := 0;
  v_paid_amount numeric := 0;
  v_outstanding numeric := 0;
  v_trends jsonb := '[]'::jsonb;
  v_mrr numeric := 0;
  v_tier_mix jsonb := '{}'::jsonb;
  v_churn_past_due bigint := 0;
  v_churn_inactive bigint := 0;
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  -- ---- Lifetime transactional aggregates (all tenants) ----
  SELECT
    count(*),
    coalesce(sum(grand_total), 0),
    coalesce(sum(taxable_amount), 0),
    coalesce(sum(cgst_amount), 0),
    coalesce(sum(sgst_amount), 0),
    coalesce(sum(igst_amount), 0),
    coalesce(sum(cess_amount), 0),
    coalesce(sum(paid_amount), 0),
    coalesce(sum(GREATEST(grand_total - paid_amount, 0)), 0)
  INTO v_total_invoices, v_gmv, v_taxable, v_cgst, v_sgst, v_igst, v_cess,
       v_paid_amount, v_outstanding
  FROM public.sales_invoices;

  -- ---- Payment clearance buckets ----
  -- paid: settled in full. overdue: balance due AND past due_date.
  -- pending: balance due but not yet overdue (incl. NULL due_date).
  SELECT
    count(*) FILTER (WHERE GREATEST(grand_total - paid_amount, 0) <= 0),
    count(*) FILTER (WHERE GREATEST(grand_total - paid_amount, 0) > 0
                       AND due_date IS NOT NULL AND due_date < CURRENT_DATE),
    count(*) FILTER (WHERE GREATEST(grand_total - paid_amount, 0) > 0
                       AND (due_date IS NULL OR due_date >= CURRENT_DATE))
  INTO v_paid_count, v_overdue_count, v_pending_count
  FROM public.sales_invoices;

  -- ---- 6-month GMV trajectory: current month + previous 5 ----
  SELECT coalesce(jsonb_agg(t ORDER BY t.month), '[]'::jsonb)
  INTO v_trends
  FROM (
    SELECT
      to_char(m.mo, 'YYYY-MM') AS month,
      count(si.id) AS invoice_count,
      coalesce(sum(si.grand_total), 0) AS gmv
    FROM (
      SELECT date_trunc('month', CURRENT_DATE) - (n || ' months')::interval AS mo
      FROM generate_series(5, 0, -1) AS n
    ) m
    LEFT JOIN public.sales_invoices si
      ON date_trunc('month', si.invoice_date) = m.mo
    GROUP BY m.mo
  ) t;

  -- ---- Live MRR: active tenants only (is_active AND subscription active) ----
  -- Price map (INR/mo): free 0, starter 999, pro 2499, enterprise 4999.
  SELECT
    coalesce(sum(CASE subscription_tier
      WHEN 'starter' THEN 999
      WHEN 'pro' THEN 2499
      WHEN 'enterprise' THEN 4999
      ELSE 0 END), 0),
    coalesce(jsonb_object_agg(subscription_tier, cnt), '{}'::jsonb)
  INTO v_mrr, v_tier_mix
  FROM (
    SELECT subscription_tier, count(*) AS cnt
    FROM public.businesses
    WHERE coalesce(is_active, true) = true
      AND subscription_status = 'active'
    GROUP BY 1
  ) s;

  -- ---- Churn indicators ----
  SELECT count(*) INTO v_churn_past_due
  FROM public.businesses WHERE subscription_status = 'past_due';

  SELECT count(*) INTO v_churn_inactive
  FROM public.businesses WHERE coalesce(is_active, true) = false;

  SELECT jsonb_build_object(
    'financial_summary', jsonb_build_object(
      'lifetime_gmv_inr', v_gmv,
      'net_taxable_value_inr', v_taxable,
      'total_invoices', v_total_invoices,
      'average_order_value_inr',
        CASE WHEN v_total_invoices > 0 THEN v_gmv / v_total_invoices ELSE 0 END,
      'paid_amount_inr', v_paid_amount,
      'outstanding_amount_inr', v_outstanding,
      'clearance', jsonb_build_object(
        'paid_count', v_paid_count,
        'pending_count', v_pending_count,
        'overdue_count', v_overdue_count,
        'clearance_ratio',
          CASE WHEN v_total_invoices > 0
            THEN round((v_paid_count::numeric / v_total_invoices), 4)
            ELSE 0 END
      )
    ),
    'tax_breakdown', jsonb_build_object(
      'cgst_total_inr', v_cgst,
      'sgst_total_inr', v_sgst,
      'igst_total_inr', v_igst,
      'cess_total_inr', v_cess,
      'total_gst_inr', v_cgst + v_sgst + v_igst
    ),
    'mrr_analytics', jsonb_build_object(
      'mrr_inr', v_mrr,
      'arr_inr', v_mrr * 12,
      'paying_tier_mix', v_tier_mix,
      'churn', jsonb_build_object(
        'past_due_count', v_churn_past_due,
        'inactive_count', v_churn_inactive,
        'total_at_risk', v_churn_past_due + v_churn_inactive
      )
    ),
    'monthly_trends', v_trends
  ) INTO v_result;

  RETURN v_result;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_comprehensive_financials() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_comprehensive_financials() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_comprehensive_financials() TO authenticated;

-- ============================================================================
-- PHASE 3a: FULL PLATFORM SNAPSHOT (sanitized — explicit columns only, no
-- auth data, no customer/supplier PII; per-business invoice rollups)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_export_full_platform_dump()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'businesses', coalesce((
      SELECT jsonb_agg(b ORDER BY b.created_at DESC)
      FROM (
        SELECT
          b.id,
          b.name,
          b.legal_name,
          b.business_type,
          b.gstin,
          b.city,
          b.state,
          b.country,
          b.currency,
          b.is_active,
          b.subscription_tier,
          b.subscription_status,
          b.max_invoices_per_month,
          b.max_staff_members,
          b.storage_limit_mb,
          b.subscription_renewed_at,
          b.subscription_expires_at,
          b.created_at,
          coalesce(inv.invoice_count, 0) AS lifetime_invoices,
          coalesce(inv.lifetime_gmv, 0) AS lifetime_gmv_inr,
          coalesce(inv.outstanding, 0) AS outstanding_inr
        FROM public.businesses b
        LEFT JOIN (
          SELECT business_id,
                 count(*) AS invoice_count,
                 sum(grand_total) AS lifetime_gmv,
                 sum(GREATEST(grand_total - paid_amount, 0)) AS outstanding
          FROM public.sales_invoices
          GROUP BY 1
        ) inv ON inv.business_id = b.id
      ) b
    ), '[]'::jsonb),
    'active_announcements', coalesce((
      SELECT jsonb_agg(a ORDER BY a.created_at DESC)
      FROM (
        SELECT id, title, message, severity, target_tier, expires_at, created_at
        FROM public.platform_announcements
        WHERE is_active = true AND (expires_at IS NULL OR expires_at > now())
      ) a
    ), '[]'::jsonb),
    'totals', (SELECT public.admin_get_platform_deep_metrics())
  ) INTO v_result;

  RETURN v_result;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_export_full_platform_dump() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_export_full_platform_dump() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_export_full_platform_dump() TO authenticated;

-- ============================================================================
-- PHASE 3b: STALE TELEMETRY PURGE — batched, lock-friendly
-- Plain DELETE takes only ROW EXCLUSIVE locks (never blocks reads/writes),
-- and batching via ctid keeps each statement short and timeout-friendly on
-- large audit tables. Returns {deleted, cutoff, batch_size}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_purge_stale_telemetry(
  p_days_older_than integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_batch integer := 5000;
  v_deleted bigint := 0;
  v_round bigint;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  IF p_days_older_than IS NULL OR p_days_older_than < 1 THEN
    RAISE EXCEPTION 'p_days_older_than must be a positive integer (got %)', p_days_older_than;
  END IF;

  v_cutoff := now() - (p_days_older_than || ' days')::interval;

  LOOP
    DELETE FROM public.admin_audit_logs a
    USING (SELECT ctid FROM public.admin_audit_logs
           WHERE created_at < v_cutoff LIMIT v_batch) old
    WHERE a.ctid = old.ctid;
    GET DIAGNOSTICS v_round = ROW_COUNT;
    v_deleted := v_deleted + v_round;
    EXIT WHEN v_round < v_batch;
  END LOOP;

  PERFORM public.log_admin_action(
    coalesce((auth.jwt() ->> 'email'), 'system'),
    'TELEMETRY_PURGED',
    NULL,
    NULL,
    jsonb_build_object('deleted_rows', v_deleted, 'older_than_days', p_days_older_than, 'cutoff', v_cutoff)
  );

  RETURN jsonb_build_object('deleted', v_deleted, 'cutoff', v_cutoff, 'batch_size', v_batch);
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_purge_stale_telemetry(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_purge_stale_telemetry(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_purge_stale_telemetry(integer) TO authenticated;
