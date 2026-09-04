-- ============================================================================
-- # 043 — Classified cash-flow: Operating / Investing / Financing (T78) [oscar]
--
-- MECHANISM CHOSEN: deterministic CASE over accounts.group_name — NOT a
-- mapping table. Reasons recorded for the hive:
--   * business-agnostic from day one: every business (and every FUTURE
--     business) is covered without seed/backfill machinery;
--   * zero drift: no join table to fall out of sync when groups are renamed;
--   * truthful fallback: any CUSTOM group an user invents defaults to
--     'operating', which is the honest prior for small-business P&L-natured
--     accounts; reclassification UI can come later as a rider if ever needed.
--
-- ## Classification rules
--   Fixed Assets                          -> investing   (asset purchases/disposals)
--   Long-term Liabilities, Capital Account -> financing   (loans, capital in/out)
--   everything else (incl. unknown groups) -> operating   [documented fallback]
--
-- ## Reconciliation guarantee with the existing surface
-- Predicate mirrors v_cashflow_daily EXACTLY (posted entries only, ledger
-- names IN ('Cash','Bank') post-013b), so SUM over classes == the existing
-- unclassified daily figures for the same range. Known shared limitation,
-- unchanged here: non-canonical cash-named ledgers outside the canonical
--   pair are invisible to BOTH views equally.
--
-- Net convention: net = debit - credit per line (positive = money in);
-- investing/financing nets will often be negative - that is real data.
-- Existing v_cashflow_daily left UNTOUCHED (additive-only migration).
-- ============================================================================

DROP VIEW IF EXISTS public.v_cashflow_classified;
CREATE VIEW public.v_cashflow_classified
WITH (security_invoker = on)
AS
SELECT
  l.business_id,
  e.date                AS flow_date,
  l.entry_id,
  a.id                  AS account_id,
  a.name                AS account_name,
  CASE
    WHEN a.group_name = 'Fixed Assets' THEN 'investing'::text
    WHEN a.group_name IN ('Long-term Liabilities', 'Capital Account') THEN 'financing'::text
    ELSE 'operating'::text
  END                   AS classification,
  COALESCE(l.debit_amount, 0)   AS inflow,
  COALESCE(l.credit_amount, 0)  AS outflow,
  (COALESCE(l.debit_amount, 0) - COALESCE(l.credit_amount, 0))::numeric AS net
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.entry_id
JOIN accounts a        ON a.id = l.account_id
WHERE e.status = 'posted'
  AND a.name IN ('Cash', 'Bank');

-- ----------------------------------------------------------------------------
-- Summary over a date range — reads ONLY the security_invoker view, so the
-- invoker's membership RLS applies end-to-end (same pattern as 041).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cashflow_classified(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  classification text,
  inflow numeric,
  outflow numeric,
  net numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.classification,
         COALESCE(SUM(f.inflow), 0),
         COALESCE(SUM(f.outflow), 0),
         COALESCE(SUM(f.net), 0)
  FROM (VALUES ('operating'::text), ('investing'::text), ('financing'::text)) AS c(classification)
  LEFT JOIN v_cashflow_classified f
    ON f.classification = c.classification
   AND f.business_id = p_business_id
   AND f.flow_date BETWEEN p_from AND p_to
  GROUP BY c.classification;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow_classified(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow_classified(uuid, date, date) TO authenticated;
