-- ============================================================================
-- 063 — AI summary-function family + summary cache (additive, read-only)
--
-- T117 (AI Business Intelligence). Thin aggregating WRAPPERS over existing
-- canonical surfaces ONLY — no financial math recomputed beyond grouping,
-- date-filtering and top-N truncation:
--   sales/purchase       -> live-doc windows over sales_invoices /
--                           purchase_bills (+ *_items for top products),
--                           status sets identical to v_dashboard_kpis
--   profit_loss          -> rows of get_profit_and_loss (020), regrouped
--   cashflow             -> v_cashflow_daily (020)
--   receivables/payables -> get_receivables_aging / get_payables_aging (021)
--   inventory            -> get_stock_valuation (033) + products low-stock +
--                           stock_movements (001) movers
--   customer/supplier    -> aging bases + payments + windowed doc trends;
--                           party membership verified against business
-- House pattern (identical to 045): SECURITY DEFINER, auth.uid() +
-- is_business_member gate, search_path pinned, free-text truncated at the DB
-- boundary, aggregates + TOP-N only (never raw row dumps to any model),
-- numbers emitted as double precision for compact JSON. Strictly read-only.
--
-- Cache: ai_summary_cache keyed (business_id, fingerprint) with short TTL.
-- get_ai_summary() is the ONE dispatcher RPC the edge function calls:
-- whitelist-enforced names, deterministic SQL only — the LLM is never
-- involved in summary modes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_summary_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (business_id, fingerprint)
);

ALTER TABLE ai_summary_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_summary_cache_select" ON ai_summary_cache;
CREATE POLICY "ai_summary_cache_select" ON ai_summary_cache FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "ai_summary_cache_insert" ON ai_summary_cache;
CREATE POLICY "ai_summary_cache_insert" ON ai_summary_cache FOR INSERT
  TO authenticated WITH CHECK (is_business_member(business_id));

DROP POLICY IF EXISTS "ai_summary_cache_delete" ON ai_summary_cache;
CREATE POLICY "ai_summary_cache_delete" ON ai_summary_cache FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_ai_summary_cache_expiry
  ON ai_summary_cache(business_id, expires_at);

-- ============================================================================
-- SALES SUMMARY (windowed totals, monthly buckets, top customers/products)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_sales_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_tot   jsonb;
  v_month jsonb;
  v_cust  jsonb;
  v_prod  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);

  SELECT jsonb_build_object(
           'total_grand',
             COALESCE(sum(si.grand_total), 0)::double precision,
           'total_taxable',
             COALESCE(sum(si.taxable_amount), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(si.paid_amount), 0)::double precision,
           'outstanding_total',
             COALESCE(sum(GREATEST(si.grand_total - si.paid_amount, 0)), 0)::double precision
         )
    INTO v_tot
    FROM sales_invoices si
   WHERE si.business_id = p_business_id
     AND si.status IN ('issued', 'partially_paid', 'paid')
     AND si.invoice_date >= p_from_date
     AND si.invoice_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', si.invoice_date), 'YYYY-MM') AS month,
             sum(si.grand_total)::double precision                    AS total,
             count(*)                                                 AS invoices
        FROM sales_invoices si
       WHERE si.business_id = p_business_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    INTO v_cust
    FROM (
      SELECT left(cu.name, 80)                     AS customer_name,
             sum(si.grand_total)::double precision AS billed,
             count(*)                              AS invoices
        FROM sales_invoices si
        JOIN customers cu ON cu.id = si.customer_id
       WHERE si.business_id = p_business_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY cu.id, cu.name
       ORDER BY billed DESC
       LIMIT v_limit
    ) c;

  SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb)
    INTO v_prod
    FROM (
      SELECT left(it.product_name, 80)              AS product_name,
             sum(it.quantity)::double precision     AS qty_sold,
             sum(it.total_amount)::double precision AS revenue
        FROM sales_invoice_items it
        JOIN sales_invoices si ON si.id = it.invoice_id
       WHERE it.business_id = p_business_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY left(it.product_name, 80)
       ORDER BY revenue DESC
       LIMIT v_limit
    ) pr;

  RETURN jsonb_build_object(
    'kind', 'sales_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'totals',        v_tot,
    'monthly',       v_month,
    'top_customers', v_cust,
    'top_products',  v_prod
  );
END;
$$;

-- ============================================================================
-- PURCHASE SUMMARY (same shape as sales)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_purchase_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_tot   jsonb;
  v_month jsonb;
  v_supp  jsonb;
  v_prod  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);

  SELECT jsonb_build_object(
           'total_grand',
             COALESCE(sum(pb.grand_total), 0)::double precision,
           'total_taxable',
             COALESCE(sum(pb.taxable_amount), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(pb.paid_amount), 0)::double precision,
           'outstanding_total',
             COALESCE(sum(GREATEST(pb.grand_total - pb.paid_amount, 0)), 0)::double precision
         )
    INTO v_tot
    FROM purchase_bills pb
   WHERE pb.business_id = p_business_id
     AND pb.status IN ('confirmed', 'partially_paid', 'paid')
     AND pb.bill_date >= p_from_date
     AND pb.bill_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', pb.bill_date), 'YYYY-MM') AS month,
             sum(pb.grand_total)::double precision                 AS total,
             count(*)                                              AS bills
        FROM purchase_bills pb
       WHERE pb.business_id = p_business_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(sp)), '[]'::jsonb)
    INTO v_supp
    FROM (
      SELECT left(sp.name, 80)                      AS supplier_name,
             sum(pb.grand_total)::double precision  AS billed,
             count(*)                               AS bills
        FROM purchase_bills pb
        JOIN suppliers sp ON sp.id = pb.supplier_id
       WHERE pb.business_id = p_business_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY sp.id, sp.name
       ORDER BY billed DESC
       LIMIT v_limit
    ) s2;

  SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb)
    INTO v_prod
    FROM (
      SELECT left(it.product_name, 80)              AS product_name,
             sum(it.quantity)::double precision     AS qty_bought,
             sum(it.total_amount)::double precision AS spend
        FROM purchase_bill_items it
        JOIN purchase_bills pb ON pb.id = it.bill_id
       WHERE it.business_id = p_business_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY left(it.product_name, 80)
       ORDER BY spend DESC
       LIMIT v_limit
    ) pr;

  RETURN jsonb_build_object(
    'kind', 'purchase_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'totals',        v_tot,
    'monthly',       v_month,
    'top_suppliers', v_supp,
    'top_products',  v_prod
  );
END;
$$;

-- ============================================================================
-- PROFIT & LOSS SUMMARY (wrapper over get_profit_and_loss 020 — no recompute)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_profit_loss_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_limit    int;
  v_income   double precision := 0;
  v_direct   double precision := 0;
  v_indirect double precision := 0;
  v_net      double precision := 0;
  v_topexp   jsonb;
  r          RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);

  FOR r IN
    SELECT section, amount
      FROM get_profit_and_loss(p_business_id, p_from_date, p_to_date)
  LOOP
    IF r.section = 'Income' THEN
      v_income := v_income + r.amount::double precision;
    ELSIF r.section = 'Direct Expense' THEN
      v_direct := v_direct + r.amount::double precision;
    ELSIF r.section = 'Indirect Expense' THEN
      v_indirect := v_indirect + r.amount::double precision;
    ELSIF r.section = 'Summary' THEN
      v_net := r.amount::double precision;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.amount DESC), '[]'::jsonb)
    INTO v_topexp
    FROM (
      SELECT left(pl.account_name, 60)  AS category,
             pl.amount::double precision AS amount,
             pl.group_name               AS group_name
        FROM get_profit_and_loss(p_business_id, p_from_date, p_to_date) pl
       WHERE pl.section IN ('Direct Expense', 'Indirect Expense')
       ORDER BY pl.amount DESC
       LIMIT v_limit
    ) e;

  RETURN jsonb_build_object(
    'kind', 'profit_loss_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',            p_business_id,
    'from_date',              p_from_date,
    'to_date',                p_to_date,
    'income_total',           round(v_income::numeric, 2)::double precision,
    'direct_expense_total',   round(v_direct::numeric, 2)::double precision,
    'indirect_expense_total', round(v_indirect::numeric, 2)::double precision,
    'net_profit',             round(v_net::numeric, 2)::double precision,
    'top_expense_categories', v_topexp
  );
END;
$$;

-- ============================================================================
-- CASHFLOW SUMMARY (wrapper over v_cashflow_daily; peaks via scalar subqs)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cashflow_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_in    double precision;
  v_out   double precision;
  v_month jsonb;
  v_peak  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT COALESCE(sum(cf.inflow), 0)::double precision,
         COALESCE(sum(cf.outflow), 0)::double precision
    INTO v_in, v_out
    FROM v_cashflow_daily cf
   WHERE cf.business_id = p_business_id
     AND cf.flow_date >= p_from_date
     AND cf.flow_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', cf.flow_date), 'YYYY-MM') AS month,
             sum(cf.inflow)::double precision                      AS inflow,
             sum(cf.outflow)::double precision                     AS outflow
        FROM v_cashflow_daily cf
       WHERE cf.business_id = p_business_id
         AND cf.flow_date >= p_from_date
         AND cf.flow_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT jsonb_build_object(
           'peak_inflow_day',
             (SELECT jsonb_build_object('day', cf.flow_date,
                                        'amount', cf.inflow::double precision)
                FROM v_cashflow_daily cf
               WHERE cf.business_id = p_business_id
                 AND cf.flow_date >= p_from_date
                 AND cf.flow_date <= p_to_date
               ORDER BY cf.inflow DESC, cf.flow_date ASC
               LIMIT 1),
           'peak_outflow_day',
             (SELECT jsonb_build_object('day', cf2.flow_date,
                                        'amount', cf2.outflow::double precision)
                FROM v_cashflow_daily cf2
               WHERE cf2.business_id = p_business_id
                 AND cf2.flow_date >= p_from_date
                 AND cf2.flow_date <= p_to_date
               ORDER BY cf2.outflow DESC, cf2.flow_date ASC
               LIMIT 1)
         )
    INTO v_peak;

  RETURN jsonb_build_object(
    'kind', 'cashflow_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'inflow_total',  round(v_in::numeric, 2)::double precision,
    'outflow_total', round(v_out::numeric, 2)::double precision,
    'net',           round((v_in - v_out)::numeric, 2)::double precision,
    'monthly',       v_month,
    'peaks',         COALESCE(v_peak, '{}'::jsonb)
  );
END;
$$;

-- ============================================================================
-- RECEIVABLES SUMMARY (rollup over get_receivables_aging 021)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_receivables_summary(
  p_business_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_roll  jsonb;
  v_top   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);

  SELECT jsonb_build_object(
           'outstanding_total',
             COALESCE(sum(a.outstanding), 0)::double precision,
           'current',
             COALESCE(sum(a."current"), 0)::double precision,
           'days_1_30',
             COALESCE(sum(a.days_1_30), 0)::double precision,
           'days_31_60',
             COALESCE(sum(a.days_31_60), 0)::double precision,
           'days_61_90',
             COALESCE(sum(a.days_61_90), 0)::double precision,
           'days_90_plus',
             COALESCE(sum(a.days_90_plus), 0)::double precision,
           'open_documents', count(DISTINCT a.doc_id),
           'parties',        count(DISTINCT a.party_id)
         )
    INTO v_roll
    FROM get_receivables_aging(p_business_id) a;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.outstanding DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT left(a2.party_name, 80)                AS party_name,
             sum(a2.outstanding)::double precision  AS outstanding,
             sum(a2.days_90_plus)::double precision AS overdue_90_plus,
             count(*)                               AS open_docs
        FROM get_receivables_aging(p_business_id) a2
       GROUP BY a2.party_id, a2.party_name
       ORDER BY outstanding DESC
       LIMIT v_limit
    ) t;

  RETURN jsonb_build_object(
    'kind', 'receivables_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id', p_business_id,
    'as_of',       CURRENT_DATE,
    'rollup',      v_roll,
    'top_parties', v_top
  );
END;
$$;

-- ============================================================================
-- PAYABLES SUMMARY (rollup over get_payables_aging 021)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_payables_summary(
  p_business_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_roll  jsonb;
  v_top   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);

  SELECT jsonb_build_object(
           'outstanding_total',
             COALESCE(sum(a.outstanding), 0)::double precision,
           'current',
             COALESCE(sum(a."current"), 0)::double precision,
           'days_1_30',
             COALESCE(sum(a.days_1_30), 0)::double precision,
           'days_31_60',
             COALESCE(sum(a.days_31_60), 0)::double precision,
           'days_61_90',
             COALESCE(sum(a.days_61_90), 0)::double precision,
           'days_90_plus',
             COALESCE(sum(a.days_90_plus), 0)::double precision,
           'open_documents', count(DISTINCT a.doc_id),
           'parties',        count(DISTINCT a.party_id)
         )
    INTO v_roll
    FROM get_payables_aging(p_business_id) a;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.outstanding DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT left(a2.party_name, 80)                AS party_name,
             sum(a2.outstanding)::double precision  AS outstanding,
             sum(a2.days_90_plus)::double precision AS overdue_90_plus,
             count(*)                               AS open_docs
        FROM get_payables_aging(p_business_id) a2
       GROUP BY a2.party_id, a2.party_name
       ORDER BY outstanding DESC
       LIMIT v_limit
    ) t;

  RETURN jsonb_build_object(
    'kind', 'payables_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id', p_business_id,
    'as_of',       CURRENT_DATE,
    'rollup',      v_roll,
    'top_parties', v_top
  );
END;
$$;

-- ============================================================================
-- INVENTORY SUMMARY (get_stock_valuation 033 + low-stock + movement movers)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_inventory_summary(
  p_business_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_val   double precision := 0;
  v_qty   double precision := 0;
  v_cnt   int := 0;
  r       RECORD;
  v_low   jsonb;
  v_fast  jsonb;
  v_slow  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);

  FOR r IN
    SELECT * FROM get_stock_valuation(p_business_id)
  LOOP
    IF COALESCE(r.quantity, 0) > 0 THEN
      v_cnt   := v_cnt + 1;
      v_qty   := v_qty + r.quantity::double precision;
      v_val   := v_val + COALESCE(r.total_value, 0)::double precision;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    INTO v_low
    FROM (
      SELECT left(name, 80)                  AS product_name,
             current_stock::double precision AS stock,
             minimum_stock::double precision AS min_stock
        FROM products
       WHERE business_id = p_business_id
         AND type = 'product'
         AND is_active
         AND minimum_stock > 0
         AND current_stock <= minimum_stock
       ORDER BY (minimum_stock - current_stock) DESC
       LIMIT v_limit
    ) p;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.qty_out DESC), '[]'::jsonb)
    INTO v_fast
    FROM (
      SELECT left(pr.name, 80)                        AS product_name,
             sum(-mv.quantity)::double precision      AS qty_out,
             count(*)                                 AS movements
        FROM stock_movements mv
        JOIN products pr ON pr.id = mv.product_id
       WHERE mv.business_id = p_business_id
         AND mv.quantity < 0
         AND mv.created_at >= (CURRENT_DATE - INTERVAL '90 days')
       GROUP BY pr.id, pr.name
       ORDER BY qty_out DESC
       LIMIT v_limit
    ) f;

  SELECT COALESCE(jsonb_agg(to_jsonb(sl)), '[]'::jsonb)
    INTO v_slow
    FROM (
      SELECT left(pr2.name, 80)               AS product_name,
             pr2.current_stock::double precision AS stock
        FROM products pr2
       WHERE pr2.business_id = p_business_id
         AND pr2.type = 'product'
         AND pr2.is_active
         AND NOT EXISTS (
               SELECT 1 FROM stock_movements mv2
                WHERE mv2.product_id = pr2.id
                  AND mv2.quantity < 0
                  AND mv2.created_at >= (CURRENT_DATE - INTERVAL '90 days'))
       ORDER BY pr2.name
       LIMIT v_limit
    ) sl;

  RETURN jsonb_build_object(
    'kind', 'inventory_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',     p_business_id,
    'valuation_total', round(v_val::numeric, 2)::double precision,
    'stocked_products', v_cnt,
    'total_quantity',  round(v_qty::numeric, 3)::double precision,
    'low_stock',       v_low,
    'fast_movers_90d', v_fast,
    'slow_movers_90d', v_slow
  );
END;
$$;

-- ============================================================================
-- CUSTOMER / SUPPLIER SUMMARIES (per-party; membership verified)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_customer_summary(
  p_business_id uuid,
  p_customer_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_name  text;
  v_tot   jsonb;
  v_month jsonb;
  v_out   jsonb;
  v_pay   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT left(c.name, 80) INTO v_name
    FROM customers c
   WHERE c.id = p_customer_id
     AND c.business_id = p_business_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Customer not found in this business';
  END IF;

  SELECT jsonb_build_object(
           'billed_total',
             COALESCE(sum(si.grand_total), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(si.paid_amount), 0)::double precision
         )
    INTO v_tot
    FROM sales_invoices si
   WHERE si.business_id = p_business_id
     AND si.customer_id = p_customer_id
     AND si.status IN ('issued', 'partially_paid', 'paid')
     AND si.invoice_date >= p_from_date
     AND si.invoice_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', si.invoice_date), 'YYYY-MM') AS month,
             sum(si.grand_total)::double precision                    AS total,
             count(*)                                                 AS invoices
        FROM sales_invoices si
       WHERE si.business_id = p_business_id
         AND si.customer_id = p_customer_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT jsonb_build_object(
           'outstanding_now',
             COALESCE(sum(b.outstanding), 0)::double precision,
           'overdue_docs',
             count(*) FILTER (WHERE b.days_overdue > 0),
           'oldest_days_overdue',
             COALESCE(max(b.days_overdue), 0)
         )
    INTO v_out
    FROM v_receivables_aging_base b
   WHERE b.business_id = p_business_id
     AND b.party_id = p_customer_id
     AND b.outstanding > 0;

  SELECT jsonb_build_object(
           'received_in_window',
             COALESCE(sum(pm.amount), 0)::double precision,
           'payments_count', count(*),
           'last_payment_date', max(pm.date)
         )
    INTO v_pay
    FROM payments pm
   WHERE pm.business_id = p_business_id
     AND pm.party_type = 'customer'
     AND pm.party_id = p_customer_id
     AND pm.type = 'received'
     AND pm.date >= p_from_date
     AND pm.date <= p_to_date;

  RETURN jsonb_build_object(
    'kind', 'customer_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',  p_business_id,
    'customer_id',  p_customer_id,
    'customer_name', v_name,
    'from_date',    p_from_date,
    'to_date',      p_to_date,
    'window_totals', v_tot,
    'monthly',      v_month,
    'outstanding',  v_out,
    'payments',     v_pay
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_supplier_summary(
  p_business_id uuid,
  p_supplier_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_name  text;
  v_tot   jsonb;
  v_month jsonb;
  v_out   jsonb;
  v_pay   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT left(s.name, 80) INTO v_name
    FROM suppliers s
   WHERE s.id = p_supplier_id
     AND s.business_id = p_business_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Supplier not found in this business';
  END IF;

  SELECT jsonb_build_object(
           'billed_total',
             COALESCE(sum(pb.grand_total), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(pb.paid_amount), 0)::double precision
         )
    INTO v_tot
    FROM purchase_bills pb
   WHERE pb.business_id = p_business_id
     AND pb.supplier_id = p_supplier_id
     AND pb.status IN ('confirmed', 'partially_paid', 'paid')
     AND pb.bill_date >= p_from_date
     AND pb.bill_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', pb.bill_date), 'YYYY-MM') AS month,
             sum(pb.grand_total)::double precision                 AS total,
             count(*)                                              AS bills
        FROM purchase_bills pb
       WHERE pb.business_id = p_business_id
         AND pb.supplier_id = p_supplier_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT jsonb_build_object(
           'outstanding_now',
             COALESCE(sum(b.outstanding), 0)::double precision,
           'overdue_docs',
             count(*) FILTER (WHERE b.days_overdue > 0),
           'oldest_days_overdue',
             COALESCE(max(b.days_overdue), 0)
         )
    INTO v_out
    FROM v_payables_aging_base b
   WHERE b.business_id = p_business_id
     AND b.party_id = p_supplier_id
     AND b.outstanding > 0;

  SELECT jsonb_build_object(
           'paid_in_window',
             COALESCE(sum(pm.amount), 0)::double precision,
           'payments_count', count(*),
           'last_payment_date', max(pm.date)
         )
    INTO v_pay
    FROM payments pm
   WHERE pm.business_id = p_business_id
     AND pm.party_type = 'supplier'
     AND pm.party_id = p_supplier_id
     AND pm.type = 'made'
     AND pm.date >= p_from_date
     AND pm.date <= p_to_date;

  RETURN jsonb_build_object(
    'kind', 'supplier_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'supplier_id',   p_supplier_id,
    'supplier_name', v_name,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'window_totals', v_tot,
    'monthly',       v_month,
    'outstanding',   v_out,
    'payments',      v_pay
  );
END;
$$;

-- ============================================================================
-- DISPATCHER + CACHE (the ONE RPC the edge function calls for summaries)
-- Whitelist-enforced; deterministic SQL only; LLM never involved here.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_ai_summary(
  p_business_id uuid,
  p_name text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_from   date;
  v_to     date;
  v_limit  int;
  v_fp     text;
  v_cached jsonb;
  v_data   jsonb;
  v_cid    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_name IS NULL THEN
    RAISE EXCEPTION 'Summary name required';
  END IF;

  v_from := COALESCE(nullif(p_params->>'from', '')::date,
                     (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')::date);
  v_to   := COALESCE(nullif(p_params->>'to', '')::date, CURRENT_DATE);
  v_limit := LEAST(GREATEST(COALESCE((p_params->>'limit')::int, 5), 1), 20);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  -- party summaries require the party id and use a fixed window
  IF p_name IN ('get_customer_summary', 'get_supplier_summary') THEN
    v_cid := nullif(p_params->>'party_id', '')::uuid;
    IF v_cid IS NULL THEN
      RAISE EXCEPTION 'party_id required for %', p_name;
    END IF;
  END IF;

  v_fp := md5(p_name || ':' || COALESCE(p_params::text, '{}'));

  SELECT payload INTO v_cached
    FROM ai_summary_cache
   WHERE business_id = p_business_id
     AND fingerprint = v_fp
     AND expires_at > now()
   LIMIT 1;
  IF v_cached IS NOT NULL THEN
    RETURN jsonb_build_object('source', 'cache', 'data', v_cached);
  END IF;

  CASE p_name
    WHEN 'get_sales_summary' THEN
      v_data := get_sales_summary(p_business_id, v_from, v_to, v_limit);
    WHEN 'get_purchase_summary' THEN
      v_data := get_purchase_summary(p_business_id, v_from, v_to, v_limit);
    WHEN 'get_profit_loss_summary' THEN
      v_data := get_profit_loss_summary(p_business_id, v_from, v_to, v_limit);
    WHEN 'get_cashflow_summary' THEN
      v_data := get_cashflow_summary(p_business_id, v_from, v_to);
    WHEN 'get_receivables_summary' THEN
      v_data := get_receivables_summary(p_business_id, v_limit);
    WHEN 'get_payables_summary' THEN
      v_data := get_payables_summary(p_business_id, v_limit);
    WHEN 'get_inventory_summary' THEN
      v_data := get_inventory_summary(p_business_id, v_limit);
    WHEN 'get_customer_summary' THEN
      v_data := get_customer_summary(p_business_id, v_cid, v_from, v_to);
    WHEN 'get_supplier_summary' THEN
      v_data := get_supplier_summary(p_business_id, v_cid, v_from, v_to);
    ELSE
      RAISE EXCEPTION 'Unknown summary name %', p_name;
  END CASE;

  INSERT INTO ai_summary_cache
    (business_id, fingerprint, payload, expires_at)
  VALUES
    (p_business_id, v_fp, v_data, now() + INTERVAL '15 minutes')
  ON CONFLICT (business_id, fingerprint)
  DO UPDATE SET payload   = EXCLUDED.payload,
                created_at = now(),
                expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object('source', 'computed', 'data', v_data);
END;
$$;

-- ============================================================================
-- GRANTS (house triple for every new function)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION get_sales_summary(uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_sales_summary(uuid, date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_sales_summary(uuid, date, date, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_purchase_summary(uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_purchase_summary(uuid, date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_purchase_summary(uuid, date, date, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_profit_loss_summary(uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_profit_loss_summary(uuid, date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_profit_loss_summary(uuid, date, date, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_cashflow_summary(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_cashflow_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_cashflow_summary(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_receivables_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_receivables_summary(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_receivables_summary(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_payables_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_payables_summary(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_payables_summary(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_inventory_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_inventory_summary(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_inventory_summary(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_customer_summary(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_customer_summary(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_customer_summary(uuid, uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_supplier_summary(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_supplier_summary(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_supplier_summary(uuid, uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_ai_summary(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ai_summary(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION get_ai_summary(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION get_ai_summary(uuid, text, jsonb) IS
  'Whitelist dispatcher for AI summary functions with 15-minute cache. Definer-gated via is_business_member(); deterministic SQL only.';
