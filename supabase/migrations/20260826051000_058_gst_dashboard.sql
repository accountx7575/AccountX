-- ============================================================================
-- # 058 — get_gst_dashboard: one-call GST compliance dashboard aggregate
--         + get_gstr3b_computed re-emit consuming is_export (T101) [oscar]
--
-- A. get_gst_dashboard(business_id, from, to) -> jsonb
--   Document-truth aggregates over the security_invoker views (041/052):
--     output / input / net per cgst/sgst/igst/cess (+ taxable)
--     b2b/b2c splits of outward supplies
--     credit_note / debit_note counts + tax magnitudes
--     zero_rated (is_export live invoices - real since 057 landed)
--     open_validation_issues = live counts from get_gst_validation_issues()
--
-- B. get_gstr3b_computed RE-EMITTED unchanged except its honest placeholder:
--   zero_rated now classifies via sales_invoices.is_export (added 057),
--   exactly as the 054 header promised. All other figures byte-identical.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gst_dashboard(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id) AS doc_count,
    COALESCE(SUM(o.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(o.cgst), 0) AS cgst,
    COALESCE(SUM(o.sgst), 0) AS sgst,
    COALESCE(SUM(o.igst), 0) AS igst,
    COALESCE(SUM(o.cess), 0) AS cess
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
in_agg AS (
  SELECT
    COUNT(DISTINCT i.bill_id) AS doc_count,
    COALESCE(SUM(i.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(i.cgst), 0) AS cgst,
    COALESCE(SUM(i.sgst), 0) AS sgst,
    COALESCE(SUM(i.igst), 0) AS igst,
    COALESCE(SUM(i.cess), 0) AS cess
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to
),
b2b_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id) AS doc_count,
    COALESCE(SUM(o.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(o.cgst + o.sgst + o.igst + o.cess), 0) AS total_tax
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
    AND o.section = 'B2B'
),
b2c_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id) AS doc_count,
    COALESCE(SUM(o.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(o.cgst + o.sgst + o.igst + o.cess), 0) AS total_tax
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
    AND o.section = 'B2C'
),
cdn_agg AS (
  SELECT
    SUM(CASE WHEN d.note_type = 'credit_note' THEN 1 ELSE 0 END) AS cn_count,
    SUM(CASE WHEN d.note_type = 'debit_note' THEN 1 ELSE 0 END) AS dn_count,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.taxable_value ELSE NULL END), 0) AS cn_taxable,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.taxable_value ELSE NULL END), 0) AS dn_taxable,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.total_tax ELSE NULL END), 0) AS cn_tax,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.total_tax ELSE NULL END), 0) AS dn_tax
  FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
export_agg AS (
  SELECT
    COUNT(*) AS doc_count,
    COALESCE(SUM(si.taxable_amount), 0) AS taxable_value
  FROM sales_invoices si
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND COALESCE(si.is_export, false)
    AND si.invoice_date BETWEEN p_from AND p_to
),
issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE v.severity = 'critical') AS critical,
    COUNT(*) FILTER (WHERE v.severity = 'warning') AS warning,
    COUNT(*) FILTER (WHERE v.severity = 'info') AS info,
    COUNT(*) AS total
  FROM get_gst_validation_issues(p_business_id, p_from, p_to) v
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'output', jsonb_build_object(
    'taxable_value', o.taxable_value,
    'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst, 'cess', o.cess,
    'total_tax', o.cgst + o.sgst + o.igst + o.cess,
    'doc_count', o.doc_count),
  'input', jsonb_build_object(
    'taxable_value', i.taxable_value,
    'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst, 'cess', i.cess,
    'total_tax', i.cgst + i.sgst + i.igst + i.cess,
    'doc_count', i.doc_count),
  'net', jsonb_build_object(
    'cgst', o.cgst - i.cgst,
    'sgst', o.sgst - i.sgst,
    'igst', o.igst - i.igst,
    'cess', o.cess - i.cess,
    'total', (o.cgst + o.sgst + o.igst + o.cess) - (i.cgst + i.sgst + i.igst + i.cess)),
  'b2b', jsonb_build_object(
    'doc_count', b.doc_count, 'taxable_value', b.taxable_value, 'total_tax', b.total_tax),
  'b2c', jsonb_build_object(
    'doc_count', c2.doc_count, 'taxable_value', c2.taxable_value, 'total_tax', c2.total_tax),
  'credit_notes', jsonb_build_object(
    'count', d.cn_count, 'taxable_value', d.cn_taxable, 'total_tax', d.cn_tax,
    'effect', 'decreases_output'),
  'debit_notes', jsonb_build_object(
    'count', d.dn_count, 'taxable_value', d.dn_taxable, 'total_tax', d.dn_tax,
    'effect', 'increases_output'),
  'zero_rated_exports', jsonb_build_object(
    'doc_count', x.doc_count, 'taxable_value', x.taxable_value),
  'open_validation_issues', jsonb_build_object(
    'critical', ic.critical, 'warning', ic.warning, 'info', ic.info, 'total', ic.total)
)
FROM out_agg o, in_agg i, b2b_agg b, b2c_agg c2, cdn_agg d, export_agg x, issue_counts ic;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gst_dashboard(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_dashboard(uuid, date, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- B. get_gstr3b_computed re-emit: zero_rated now REAL via is_export (057).
--    Body identical to 054 except the export classification block.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_gstr3b_computed(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id)                        AS doc_count,
    COALESCE(SUM(o.taxable_value), 0)                   AS taxable_value,
    COALESCE(SUM(o.cgst), 0)                            AS cgst,
    COALESCE(SUM(o.sgst), 0)                            AS sgst,
    COALESCE(SUM(o.igst), 0)                            AS igst,
    COALESCE(SUM(o.cess), 0)                            AS cess
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
in_agg AS (
  SELECT
    COUNT(DISTINCT i.bill_id)                           AS bill_count,
    COALESCE(SUM(i.taxable_value), 0)                   AS taxable_value,
    COALESCE(SUM(i.cgst), 0)                            AS cgst,
    COALESCE(SUM(i.sgst), 0)                            AS sgst,
    COALESCE(SUM(i.igst), 0)                            AS igst,
    COALESCE(SUM(i.cess), 0)                            AS cess
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to
),
cdn_agg AS (
SELECT
    COUNT(*) FILTER (WHERE d.note_type = 'credit_note') AS credit_notes,
    COUNT(*) FILTER (WHERE d.note_type = 'debit_note')  AS debit_notes,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.taxable_value ELSE NULL END), 0) AS taxable_credits,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.taxable_value ELSE NULL END), 0) AS taxable_additions,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.cgst ELSE NULL END), 0) AS dn_cgst,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.sgst ELSE NULL END), 0) AS dn_sgst,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.igst ELSE NULL END), 0) AS dn_igst,
    COALESCE(SUM(CASE WHEN d.effect = 'increases_output' THEN d.cess ELSE NULL END), 0) AS dn_cess,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.cgst ELSE NULL END), 0) AS cn_cgst,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.sgst ELSE NULL END), 0) AS cn_sgst,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.igst ELSE NULL END), 0) AS cn_igst,
    COALESCE(SUM(CASE WHEN d.effect = 'decreases_output' THEN d.cess ELSE NULL END), 0) AS cn_cess
  FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
nil_agg AS (
  SELECT
    COUNT(DISTINCT n.invoice_id)                        AS doc_count,
    COALESCE(SUM(n.taxable_value), 0)                   AS taxable_value
  FROM v_gstr1_nil n
  WHERE n.business_id = p_business_id
    AND n.doc_date BETWEEN p_from AND p_to
),
export_agg AS (
  SELECT
    COUNT(*)                                            AS doc_count,
    COALESCE(SUM(si.taxable_amount), 0)                 AS taxable_value
  FROM sales_invoices si
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND COALESCE(si.is_export, false)
    AND si.invoice_date BETWEEN p_from AND p_to
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),

  'outward_3_1a', jsonb_build_object(
    'taxable_value', o.taxable_value,
    'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst, 'cess', o.cess,
    'doc_count', o.doc_count),

  'zero_rated', jsonb_build_object(
    'taxable_value', x.taxable_value,
    'cgst', 0, 'sgst', 0, 'igst', 0, 'cess', 0,
    'doc_count', x.doc_count,
    'note', 'Live invoices flagged is_export (057). Zero-rated supplies carry no GST by definition; tax columns are structurally zero.'),

  'nil_other_outward', jsonb_build_object(
    'taxable_value', n.taxable_value,
    'doc_count', n.doc_count,
    'classification', 'nil_or_exempt'),

  'cdnr_adjustment', jsonb_build_object(
    'credit_notes', c.credit_notes,
    'debit_notes', c.debit_notes,
    'taxable_credits', c.taxable_credits,
    'taxable_additions', c.taxable_additions,
    'taxable_net_effect', c.taxable_additions - c.taxable_credits,
    'cgst', c.dn_cgst - c.cn_cgst,
    'sgst', c.dn_sgst - c.cn_sgst,
    'igst', c.dn_igst - c.cn_igst,
    'cess', c.dn_cess - c.cn_cess),

  'adjusted_output', jsonb_build_object(
    'taxable_value', o.taxable_value + (c.taxable_additions - c.taxable_credits),
    'cgst', o.cgst + (c.dn_cgst - c.cn_cgst),
    'sgst', o.sgst + (c.dn_sgst - c.cn_sgst),
    'igst', o.igst + (c.dn_igst - c.cn_igst),
    'cess', o.cess + (c.dn_cess - c.cn_cess)),

  'inward_itc_4a', jsonb_build_object(
    'taxable_value', i.taxable_value,
    'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst, 'cess', i.cess,
    'bill_count', i.bill_count),

  'net_position', jsonb_build_object(
    'cgst', (o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst,
    'sgst', (o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst,
    'igst', (o.igst + (c.dn_igst - c.cn_igst)) - i.igst,
    'cess', (o.cess + (c.dn_cess - c.cn_cess)) - i.cess,
    'total_net_payable',
      ((o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst)
    + ((o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst)
    + ((o.igst + (c.dn_igst - c.cn_igst)) - i.igst)
    + ((o.cess + (c.dn_cess - c.cn_cess)) - i.cess),
    'is_credit_carried_forward',
      ((((o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst)
      + ((o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst)
      + ((o.igst + (c.dn_igst - c.cn_igst)) - i.igst)
      + ((o.cess + (c.dn_cess - c.cn_cess)) - i.cess)) < 0)),

  'traceability', jsonb_build_object(
    'invoice_docs', o.doc_count,
    'bill_docs', i.bill_count,
    'credit_note_docs', c.credit_notes,
    'debit_note_docs', c.debit_notes,
    'nil_docs', n.doc_count,
    'zero_rated_docs', x.doc_count,
    'gstr1_sections_fn', 'get_gstr1_sections')
)
FROM out_agg o, in_agg i, cdn_agg c, nil_agg n, export_agg x;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) TO authenticated;
