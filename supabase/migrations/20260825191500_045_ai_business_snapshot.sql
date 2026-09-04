-- ============================================================================
-- 045 — AI assistant business snapshot (additive, read-only)
--
-- Bundles ONE compact JSON payload per business for the ai-assistant edge
-- function. Reuses ONLY existing canonical surfaces (019/020/021/025/033
-- lineage); computes nothing new beyond grouping/truncation:
--
--   kpis              -> v_dashboard_kpis (one row per business)
--   receivables_top   -> v_receivables_aging_base, top 10 by outstanding>0
--   payables_top      -> v_payables_aging_base, top 10 by outstanding>0
--   low_stock         -> products (current_stock <= minimum_stock), top 10
--   sales_monthly     -> sales_invoices live docs, last 6 month buckets
--   purchases_monthly -> purchase_bills live docs, last 6 month buckets
--   cash_position     -> accounts.group_name='Cash & Bank' (current_balance
--                        is CANONICAL since 037 trigger recompute)
--
-- Prompt-injection blunting: free-text columns are hard-truncated here at
-- the DB boundary and notes/terms/descriptions are NEVER included. The edge
-- function additionally frames this block as untrusted data.
--
-- Access: SECURITY DEFINER but gated on is_business_member() exactly like
-- get_gst_summary (025) / get_stock_valuation (033). No PII beyond party
-- names; no credentials; strictly read-only.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ai_business_snapshot(
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_kpis jsonb;
  v_ar   jsonb;
  v_ap   jsonb;
  v_low  jsonb;
  v_sm   jsonb;
  v_pm   jsonb;
  v_cash jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  SELECT to_jsonb(k)
    INTO v_kpis
    FROM v_dashboard_kpis k
   WHERE k.business_id = p_business_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO v_ar
    FROM (
      SELECT left(doc_number, 40)          AS doc_number,
             left(party_name, 80)          AS party_name,
             doc_date,
             due_date,
             outstanding::double precision AS outstanding,
             days_overdue
        FROM v_receivables_aging_base
       WHERE business_id = p_business_id
         AND outstanding > 0
       ORDER BY outstanding DESC
       LIMIT 10
    ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO v_ap
    FROM (
      SELECT left(doc_number, 40)          AS doc_number,
             left(party_name, 80)          AS party_name,
             doc_date,
             due_date,
             outstanding::double precision AS outstanding,
             days_overdue
        FROM v_payables_aging_base
       WHERE business_id = p_business_id
         AND outstanding > 0
       ORDER BY outstanding DESC
       LIMIT 10
    ) r2;

  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    INTO v_low
    FROM (
      SELECT left(name, 80)                 AS name,
             current_stock::double precision AS stock,
             minimum_stock::double precision AS min_stock
        FROM products
       WHERE business_id = p_business_id
         AND type = 'product'
         AND is_active
         AND minimum_stock > 0
         AND current_stock <= minimum_stock
       ORDER BY (minimum_stock - current_stock) DESC
       LIMIT 10
    ) p;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_sm
    FROM (
      SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
             sum(grand_total)::double precision                     AS total,
             count(*)                                               AS invoices
        FROM sales_invoices
       WHERE business_id = p_business_id
         AND status IN ('issued', 'partially_paid', 'paid')
         AND invoice_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')
       GROUP BY 1
    ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(m2) ORDER BY m2.month), '[]'::jsonb)
    INTO v_pm
    FROM (
      SELECT to_char(date_trunc('month', bill_date), 'YYYY-MM') AS month,
             sum(grand_total)::double precision                 AS total,
             count(*)                                           AS bills
        FROM purchase_bills
       WHERE business_id = p_business_id
         AND status IN ('confirmed', 'partially_paid', 'paid')
         AND bill_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')
       GROUP BY 1
    ) m2;

  SELECT jsonb_build_object(
           'total',
           COALESCE(sum(c.current_balance), 0)::double precision,
           'accounts',
           COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         )
    INTO v_cash
    FROM (
      SELECT left(name, 60)                       AS name,
             current_balance::double precision     AS balance
        FROM accounts
       WHERE business_id = p_business_id
         AND group_name = 'Cash & Bank'
       ORDER BY name
       LIMIT 8
    ) c;

  RETURN jsonb_build_object(
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',       p_business_id,
    'kpis',              v_kpis,
    'receivables_top',   v_ar,
    'payables_top',      v_ap,
    'low_stock',         v_low,
    'sales_monthly',     v_sm,
    'purchases_monthly', v_pm,
    'cash_position',     v_cash
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_ai_business_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ai_business_snapshot(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_ai_business_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION get_ai_business_snapshot(uuid) IS
  'Compact trusted-surface JSON snapshot for the ai-assistant edge function. Definer-gated via is_business_member(); free-text truncated; never includes notes/terms.';
