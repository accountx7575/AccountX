-- ============================================================================
-- # 041 — GSTR doc-level reporting surface (T73, feeds Phyllis T69) [oscar]
--
-- Document-truth GSTR-1/3B data built ONLY from existing columns of the
-- live tables (no schema redesign, no new writes).
--
-- ## Granularity
-- One row per (document, tax_rate) — canonical GSTR-1 line granularity.
-- A single-rate document yields exactly one row; multi-rate documents
-- produce one row per rate so rate-wise filing tables render directly.
--
-- ## Status families (mirror the transactional save RPCs / J2 machine)
-- OUTWARD: sales_invoices.status IN ('issued','partially_paid','paid')
--          — NEVER draft / cancelled / void.
-- INWARD:  purchase_bills.status IN ('confirmed','partially_paid','paid').
--
-- ## Semantics mirrors
-- * B2B/B2C classification identical to reportsAdapter.fetchGstr1:
--   party GSTIN present => B2B else B2C.
-- * Amounts are raw column sums (NO rounding here — the report layer owns
--   presentation rounding, mirroring how fetchGstr1 applies r2 client-side).
-- * place_of_supply exists on invoices only; bills carry none in schema,
--   so the inward view omits the column rather than faking it.
--
-- ## Intended net-liability derivation (report layer renders it)
--   output_tax  = Σ outward.cgst+sgst+igst+cess      (3B table 3.1 shape)
--   input_credit= Σ inward.cgst+sgst+igst+cess       (3B table 4A shape)
--   net_payable = output_tax − input_credit; when negative it is a CREDIT
--   CARRY-FORWARD, not a refund claim. This is DOCUMENT truth — it may
--   differ from get_gst_summary() JOURNAL truth around CN/DN/settlement
--   timing; the FE must label which basis it shows.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice
  ON public.sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_bill_items_bill
  ON public.purchase_bill_items(bill_id);

-- ----------------------------------------------------------------------------
-- A. v_gstr1_outward — per (invoice, rate) outward supply lines
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_outward;
CREATE VIEW public.v_gstr1_outward
WITH (security_invoker = on)
AS
SELECT
  si.business_id,
  si.id                          AS invoice_id,
  si.invoice_number              AS doc_number,
  si.invoice_date                AS doc_date,
  c.name                         AS party_name,
  NULLIF(btrim(c.gstin), '')     AS party_gstin,
  CASE WHEN NULLIF(btrim(c.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  si.place_of_supply,
  sii.tax_rate,
  COUNT(sii.id)                  AS item_count,
  SUM(sii.taxable_amount)        AS taxable_value,
  SUM(sii.cgst_amount)           AS cgst,
  SUM(sii.sgst_amount)           AS sgst,
  SUM(sii.igst_amount)           AS igst,
  SUM(sii.cess_amount)           AS cess,
  SUM(sii.cgst_amount + sii.sgst_amount + sii.igst_amount + sii.cess_amount) AS total_tax
FROM sales_invoices si
JOIN customers c            ON c.id = si.customer_id
JOIN sales_invoice_items sii ON sii.invoice_id = si.id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
GROUP BY si.business_id, si.id, si.invoice_number, si.invoice_date,
         c.name, c.gstin, si.place_of_supply, sii.tax_rate;

-- ----------------------------------------------------------------------------
-- B. v_gstr_inward — per (bill, rate) inward supply lines (ITC basis)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr_inward;
CREATE VIEW public.v_gstr_inward
WITH (security_invoker = on)
AS
SELECT
  pb.business_id,
  pb.id                          AS bill_id,
  pb.bill_number                 AS doc_number,
  pb.bill_date                   AS doc_date,
  sup.name                       AS party_name,
  NULLIF(btrim(sup.gstin), '')   AS party_gstin,
  CASE WHEN NULLIF(btrim(sup.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  pbi.tax_rate,
  COUNT(pbi.id)                  AS item_count,
  SUM(pbi.taxable_amount)        AS taxable_value,
  SUM(pbi.cgst_amount)           AS cgst,
  SUM(pbi.sgst_amount)           AS sgst,
  SUM(pbi.igst_amount)           AS igst,
  SUM(pbi.cess_amount)           AS cess,
  SUM(pbi.cgst_amount + pbi.sgst_amount + pbi.igst_amount + pbi.cess_amount) AS total_tax
FROM purchase_bills pb
JOIN suppliers sup          ON sup.id = pb.supplier_id
JOIN purchase_bill_items pbi ON pbi.bill_id = pb.id
WHERE pb.status IN ('confirmed', 'partially_paid', 'paid')
GROUP BY pb.business_id, pb.id, pb.bill_number, pb.bill_date,
         sup.name, sup.gstin, pbi.tax_rate;

-- ----------------------------------------------------------------------------
-- C. get_gstr_doc_summary — two-sided totals for the 3B-style net figure
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_gstr_doc_summary(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  side text,
  doc_count bigint,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'outward'::text,
         COUNT(DISTINCT o.invoice_id),
         COALESCE(SUM(o.taxable_value), 0),
         COALESCE(SUM(o.cgst), 0),
         COALESCE(SUM(o.sgst), 0),
         COALESCE(SUM(o.igst), 0),
         COALESCE(SUM(o.cess), 0)
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to

  UNION ALL

  SELECT 'inward'::text,
         COUNT(DISTINCT i.bill_id),
         COALESCE(SUM(i.taxable_value), 0),
         COALESCE(SUM(i.cgst), 0),
         COALESCE(SUM(i.sgst), 0),
         COALESCE(SUM(i.igst), 0),
         COALESCE(SUM(i.cess), 0)
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr_doc_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr_doc_summary(uuid, date, date) TO authenticated;
