-- ============================================================================
-- # 052 — GSTR-1 supplementary surfaces: CDN + nil/exempt + HSN summary
--         (GST BACKEND W1, T99) [oscar]
--
-- Companion views to 041 (outward/inward). Same house rules:
--   * DOCUMENT TRUTH ONLY — built from existing columns, zero writes.
--   * security_invoker = on  -> caller's RLS governs every read.
--   * Status families mirror 017/022 machines:
--       OUTWARD live : issued | partially_paid | paid
--       INWARD  live : confirmed | partially_paid | paid
--       NOTES   live : issued | applied      (draft never reported;
--                                             cancelled excluded;
--                                             applied = refunds flowed)
--
-- ## A. v_gstr1_cdn — credit/debit notes touching OUTPUT tax (CDNR family)
-- Doc-level granularity BY DESIGN: note items (022) carry a single blended
-- tax_amount with NO tax_rate column, so per-rate splitting would be
-- fabrication. Header tax columns are authoritative. `effect` tells the
-- consumer how the note moves output liability without magic signs:
--   credit_note -> decreases_output ; debit_note -> increases_output.
-- Parent linkage gives GSTR-1 CDNR its required original-doc reference.
--
-- ## B. v_gstr1_nil — nil-rated / exempt OUTWARD supplies (Table 8 shape)
-- A live invoice is classified nil/exempt iff the SUM of ALL item tax
-- amounts equals zero (whole-document test; mixed taxed+untaxed docs are
-- NOT nil — they stay in the normal tables). Simplification documented:
-- we cannot distinguish "nil-rated" from "exempt" from columns alone,
-- both share this bucket, exposed as classification 'nil_or_exempt'.
--
-- ## C. v_gstr1_hsn — HSN summary of OUTWARD supplies (Table 12 shape)
-- Per (hsn_sac, unit, tax_rate): item-level values preferred, product-
-- level fallback via LEFT JOIN products (017 saves item copies; older/
-- manual rows may rely on the product master). Units are free-text
-- (default 'PCS') — mapping free text -> official UQC codes is a FE/
-- presentation concern, deliberately out of DB scope.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. v_gstr1_cdn — issued-family credit & debit notes (doc granularity)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_cdn;
CREATE VIEW public.v_gstr1_cdn
WITH (security_invoker = on)
AS
SELECT
  cn.business_id,
  cn.id                        AS doc_id,
  'credit_note'::text          AS note_type,
  'decreases_output'::text     AS effect,
  cn.credit_note_number        AS doc_number,
  cn.date                      AS doc_date,
  cn.sales_invoice_id          AS parent_doc_id,
  si.invoice_number            AS parent_doc_number,
  c.name                       AS party_name,
  NULLIF(btrim(c.gstin), '')   AS party_gstin,
  CASE WHEN NULLIF(btrim(c.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  cn.reason,
  cn.taxable_amount            AS taxable_value,
  cn.cgst_amount               AS cgst,
  cn.sgst_amount               AS sgst,
  cn.igst_amount               AS igst,
  cn.cess_amount               AS cess,
  (cn.cgst_amount + cn.sgst_amount + cn.igst_amount + cn.cess_amount) AS total_tax
FROM credit_notes cn
JOIN customers c      ON c.id  = cn.customer_id
JOIN sales_invoices si ON si.id = cn.sales_invoice_id
WHERE cn.status IN ('issued', 'applied')

UNION ALL

SELECT
  dn.business_id,
  dn.id,
  'debit_note'::text,
  'increases_output'::text,
  dn.debit_note_number,
  dn.date,
  dn.purchase_bill_id,
  pb.bill_number,
  sup.name,
  NULLIF(btrim(sup.gstin), ''),
  CASE WHEN NULLIF(btrim(sup.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END,
  dn.reason,
  dn.taxable_amount,
  dn.cgst_amount,
  dn.sgst_amount,
  dn.igst_amount,
  dn.cess_amount,
  (dn.cgst_amount + dn.sgst_amount + dn.igst_amount + dn.cess_amount)
FROM debit_notes dn
JOIN suppliers sup     ON sup.id = dn.supplier_id
JOIN purchase_bills pb ON pb.id  = dn.purchase_bill_id
WHERE dn.status IN ('issued', 'applied');

-- ----------------------------------------------------------------------------
-- B. v_gstr1_nil — whole-document zero-tax live invoices
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_nil;
CREATE VIEW public.v_gstr1_nil
WITH (security_invoker = on)
AS
SELECT
  si.business_id,
  si.id                        AS invoice_id,
  si.invoice_number            AS doc_number,
  si.invoice_date              AS doc_date,
  c.name                       AS party_name,
  NULLIF(btrim(c.gstin), '')   AS party_gstin,
  CASE WHEN NULLIF(btrim(c.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  si.place_of_supply,
  'nil_or_exempt'::text        AS classification,
  COUNT(sii.id)                AS item_count,
  COALESCE(SUM(sii.quantity), 0) AS quantity,
  COALESCE(SUM(sii.taxable_amount), 0) AS taxable_value
FROM sales_invoices si
JOIN customers c             ON c.id   = si.customer_id
JOIN sales_invoice_items sii ON sii.invoice_id = si.id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
GROUP BY si.business_id, si.id, si.invoice_number, si.invoice_date,
         c.name, c.gstin, si.place_of_supply
HAVING COALESCE(SUM(sii.cgst_amount + sii.sgst_amount + sii.igst_amount + sii.cess_amount), 0) = 0;

-- ----------------------------------------------------------------------------
-- C. v_gstr1_hsn — outward HSN summary (per hsn/unit/rate)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_hsn;
CREATE VIEW public.v_gstr1_hsn
WITH (security_invoker = on)
AS
SELECT
  si.business_id,
  COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED') AS hsn_sac,
  COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS')                AS unit,
  sii.tax_rate,
  MAX(COALESCE(NULLIF(btrim(sii.product_name), ''), p.name))                             AS description,
  COUNT(sii.id)                                                                          AS item_count,
  SUM(sii.quantity)                                                                      AS quantity,
  SUM(sii.taxable_amount)                                                                AS taxable_value,
  SUM(sii.cgst_amount)                                                                   AS cgst,
  SUM(sii.sgst_amount)                                                                   AS sgst,
  SUM(sii.igst_amount)                                                                   AS igst,
  SUM(sii.cess_amount)                                                                   AS cess
FROM sales_invoice_items sii
JOIN sales_invoices si ON si.id = sii.invoice_id
LEFT JOIN products p    ON p.id  = sii.product_id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
GROUP BY si.business_id,
         COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED'),
         COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS'),
         sii.tax_rate;

-- House style: reporting surfaces are authenticated-only.
REVOKE ALL ON public.v_gstr1_cdn FROM PUBLIC, anon;
REVOKE ALL ON public.v_gstr1_nil FROM PUBLIC, anon;
REVOKE ALL ON public.v_gstr1_hsn FROM PUBLIC, anon;
