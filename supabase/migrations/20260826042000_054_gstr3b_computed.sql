-- ============================================================================
-- # 054 — get_gstr3b_computed: document-truth GSTR-3B computation
--         (GST BACKEND W1, T99) [oscar]
--
-- Single-call computed 3B over the security_invoker views (041 + 052).
-- READ-ONLY engine; NEVER mutates. RLS applies via invoker views.
--
-- BASIS = DOCUMENT TRUTH: figures derive from live documents in the
-- period (outward invoices / inward bills / issued-family CN+DN), NOT
-- from posted journal lines. It can diverge from get_gst_summary()
-- JOURNAL truth around CN/DN/settlement timing — consumers must label
-- which basis they display (the response carries basis explicitly).
--
-- SHAPE (jsonb):
-- {
--   basis, period:{from,to},
--   outward_3_1a: {taxable_value,cgst,sgst,igst,cess,doc_count},
--   zero_rated:   {taxable_value,cgst,sgst,igst,cess,doc_count,note},
--       -- honest placeholder: no export/zero-rated flag exists until the
--       -- additive schema lands (T101/057 is_export); zeros until then.
--   nil_other_outward: {taxable_value,doc_count,classification},
--   cdnr_adjustment:  {credit_notes,debit_notes,taxable_credits,taxable_additions,
--                      cgst,sgst,igst,cess(net effect signed: DN minus CN)},
--   adjusted_output:  {taxable_value,cgst,sgst,igst,cess},  -- after CDN
--   inward_itc_4a:    {taxable_value,cgst,sgst,igst,cess,bill_count},
--   net_position:     {cgst,sgst,igst,cess,total_net_payable,
--                      is_credit_carried_forward},
--       -- payable = adjusted_output - ITC per component; NEGATIVE total
--       -- means CREDIT CARRY-FORWARD (not a refund claim).
--   traceability: {invoice_docs,bill_docs,credit_note_docs,debit_note_docs,
--                  nil_docs,gstr1_sections_fn}
-- }
-- ============================================================================

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
    SUM(CASE WHEN d.note_type = 'credit_note' THEN 1 ELSE 0 END) AS credit_notes,
    SUM(CASE WHEN d.note_type = 'debit_note' THEN 1 ELSE 0 END) AS debit_notes,
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
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),

  'outward_3_1a', jsonb_build_object(
    'taxable_value', o.taxable_value,
    'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst, 'cess', o.cess,
    'doc_count', o.doc_count),

  'zero_rated', jsonb_build_object(
    'taxable_value', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'cess', 0,
    'doc_count', 0,
    'note', 'Zero-rated/export classification requires the additive export flags (T101 migration 057); reported honestly as empty until then.'),

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
    'gstr1_sections_fn', 'get_gstr1_sections')
)
FROM out_agg o, in_agg i, cdn_agg c, nil_agg n;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) TO authenticated;
