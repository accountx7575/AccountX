-- ============================================================================
-- # 053 â€” get_gstr1_sections: one-call GSTR-1 section builder
--         (GST BACKEND W1, T99) [oscar]
--
-- Assembles the filing-table sections from the security_invoker views:
--   b2b  / b2c : v_gstr1_outward split by GSTIN presence (041 rule)
--   cdnr       : v_gstr1_cdn   (issued-family CN/DN, doc granularity)
--   nil        : v_gstr1_nil   (whole-doc zero-tax outward)
--   hsn        : v_gstr1_hsn   (outward HSN summary per hsn/unit/rate)
--
-- SHAPE (jsonb, single row):
-- {
--   basis: "document-truth",
--   period: {from, to},
--   b2b:  {rows:[<outward rows>], totals:{doc_count,taxable_value,cgst,sgst,igst,cess}},
--   b2c:  {rows:[...], totals:{...}},
--   cdnr: {rows:[<cdn rows>], totals:{doc_count,credit_notes,debit_notes,
--                                     taxable_value,cgst,sgst,igst,cess}},
--   nil:  {rows:[<nil rows>], totals:{doc_count,taxable_value}},
--   hsn:  {rows:[<hsn rows>], totals:{taxable_value,cgst,sgst,igst,cess}}
-- }
--
-- Rows are raw to_jsonb() of the underlying view rows (no rounding â€” the
-- FE report layer owns presentation rounding, mirroring reportsAdapter).
-- Reads ONLY invoker views => caller RLS governs; no definer needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gstr1_sections(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_rows AS (
  SELECT * FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
cdn_rows AS (
  SELECT * FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
nil_rows AS (
  SELECT * FROM v_gstr1_nil n
  WHERE n.business_id = p_business_id
    AND n.doc_date BETWEEN p_from AND p_to
),
-- HSN cannot be date-filtered through the summary view (no doc_date on
-- grouped rows), so the section fn re-derives it date-scoped with the
-- exact same grouping expression as 052's v_gstr1_hsn.
hsn_live AS (
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
  LEFT JOIN products p     ON p.id  = sii.product_id
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND si.invoice_date BETWEEN p_from AND p_to
  GROUP BY si.business_id,
           COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED'),
           COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS'),
           sii.tax_rate
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),

  'b2b', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM out_rows r WHERE r.section = 'B2B'), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.invoice_id),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM out_rows r WHERE r.section = 'B2B')),

  'b2c', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM out_rows r WHERE r.section = 'B2C'), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.invoice_id),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM out_rows r WHERE r.section = 'B2C')),

  'cdnr', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM cdn_rows r), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.doc_id),
                 'credit_notes', COUNT(*) FILTER (WHERE r.note_type = 'credit_note'),
                 'debit_notes', COUNT(*) FILTER (WHERE r.note_type = 'debit_note'),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM cdn_rows r)),

  'nil', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM nil_rows r), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.invoice_id),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0))
               FROM nil_rows r)),

  'hsn', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.hsn_sac, r.unit, r.tax_rate)
                      FROM hsn_live r), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM hsn_live r))
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr1_sections(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr1_sections(uuid, date, date) TO authenticated;

