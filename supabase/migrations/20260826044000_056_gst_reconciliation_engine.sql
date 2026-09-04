-- ============================================================================
-- # 056 — get_gst_reconciliation: document-truth vs posted-journal engine
--         (GST BACKEND W2, T100) [oscar]
--
-- READ-ONLY. NEVER mutates. Per live document in [from, to]:
--   doc_tax   = header tax columns (document truth)
--   je_tax    = SUM(credit - debit) over posted journal lines whose account
--               sits in the matching GST group:
--                 sales_invoice -> 'GST Payable'   (output, credit-positive)
--                 purchase_bill -> 'GST Receivable' (input, debit-positive)
--               JEs located via journal_entries.reference_type/reference_id
--               (007 linkage), status='posted'.
--
-- match_status per doc:
--   matched       |je_tax - doc_tax| <= 0.01 and exactly one JE
--   difference    beyond tolerance
--   unjournaled   no posted JE references the doc
--   multi_posted  >1 posted primary JEs reference the doc (double-count risk;
--                 reversal JEs use *_reversal types and are NOT counted)
--
-- Component split uses canonical ledger names ('Output CGST' etc., 011/013a).
-- Cess ledger naming drifted historically (m011 vs 022 homing), so anything
-- not matching a canonical component lands in unmapped_residual instead of
-- being silently dropped — total always reconciles to the full group sum.
--
-- CN/DN coverage is reported AGGREGATE only: their JEs reference the note,
-- cancellations create mirror JEs, and per-doc diffing there is deferred —
-- documented boundary, not an omission.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gst_reconciliation(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_docs AS (
  SELECT
    si.id AS doc_id, si.invoice_number AS doc_number, si.invoice_date AS doc_date,
    c.name AS party_name, si.cgst_amount, si.sgst_amount, si.igst_amount, si.cess_amount,
    (si.cgst_amount + si.sgst_amount + si.igst_amount + si.cess_amount) AS doc_tax_total
  FROM sales_invoices si
  JOIN customers c ON c.id = si.customer_id
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND si.invoice_date BETWEEN p_from AND p_to
),
in_docs AS (
  SELECT
    pb.id AS doc_id, pb.bill_number AS doc_number, pb.bill_date AS doc_date,
    sup.name AS party_name, pb.cgst_amount, pb.sgst_amount, pb.igst_amount, pb.cess_amount,
    (pb.cgst_amount + pb.sgst_amount + pb.igst_amount + pb.cess_amount) AS doc_tax_total
  FROM purchase_bills pb
  JOIN suppliers sup ON sup.id = pb.supplier_id
  WHERE pb.business_id = p_business_id
    AND pb.status IN ('confirmed', 'partially_paid', 'paid')
    AND pb.bill_date BETWEEN p_from AND p_to
),
out_je AS (
  SELECT
    je.reference_id AS doc_id,
    COUNT(DISTINCT je.id) AS je_count,
    COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) AS je_tax_total,
    COALESCE(SUM(CASE WHEN a.name = 'Output CGST' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS je_cgst,
    COALESCE(SUM(CASE WHEN a.name = 'Output SGST' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS je_sgst,
    COALESCE(SUM(CASE WHEN a.name = 'Output IGST' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS je_igst,
    COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0)
      - COALESCE(SUM(CASE WHEN a.name IN ('Output CGST','Output SGST','Output IGST')
                          THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS unmapped_residual
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.business_id = je.business_id
  JOIN accounts a ON a.id = jel.account_id AND a.group_name = 'GST Payable'
  WHERE je.business_id = p_business_id
    AND je.status = 'posted'
    AND je.reference_type = 'sales_invoice'
  GROUP BY je.reference_id
),
in_je AS (
  SELECT
    je.reference_id AS doc_id,
    COUNT(DISTINCT je.id) AS je_count,
    COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS je_tax_total,
    COALESCE(SUM(CASE WHEN a.name = 'Input CGST' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS je_cgst,
    COALESCE(SUM(CASE WHEN a.name = 'Input SGST' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS je_sgst,
    COALESCE(SUM(CASE WHEN a.name = 'Input IGST' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS je_igst,
    COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)
      - COALESCE(SUM(CASE WHEN a.name IN ('Input CGST','Input SGST','Input IGST')
                          THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS unmapped_residual
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.business_id = je.business_id
  JOIN accounts a ON a.id = jel.account_id AND a.group_name = 'GST Receivable'
  WHERE je.business_id = p_business_id
    AND je.status = 'posted'
    AND je.reference_type = 'purchase_bill'
  GROUP BY je.reference_id
),
doc_rows AS (
  SELECT
    'sales_invoice'::text AS doc_type, o.doc_id, o.doc_number, o.doc_date, o.party_name,
    'outward'::text AS direction,
    o.cgst_amount AS doc_cgst, o.sgst_amount AS doc_sgst, o.igst_amount AS doc_igst,
    o.cess_amount AS doc_cess, o.doc_tax_total,
    COALESCE(j.je_cgst, 0) AS je_cgst, COALESCE(j.je_sgst, 0) AS je_sgst,
    COALESCE(j.je_igst, 0) AS je_igst, COALESCE(j.unmapped_residual, 0) AS unmapped_residual,
    COALESCE(j.je_tax_total, 0) AS je_tax_total,
    COALESCE(j.je_count, 0) AS je_count,
    CASE
      WHEN COALESCE(j.je_count, 0) = 0 THEN 'unjournaled'
      WHEN j.je_count > 1 THEN 'multi_posted'
      WHEN abs(j.je_tax_total - o.doc_tax_total) <= 0.01 THEN 'matched'
      ELSE 'difference'
    END::text AS match_status
  FROM out_docs o LEFT JOIN out_je j ON j.doc_id = o.doc_id

  UNION ALL

  SELECT
    'purchase_bill', i2.doc_id, i2.doc_number, i2.doc_date, i2.party_name,
    'inward',
    i2.cgst_amount, i2.sgst_amount, i2.igst_amount, i2.cess_amount, i2.doc_tax_total,
    COALESCE(k.je_cgst, 0), COALESCE(k.je_sgst, 0),
    COALESCE(k.je_igst, 0), COALESCE(k.unmapped_residual, 0),
    COALESCE(k.je_tax_total, 0),
    COALESCE(k.je_count, 0),
    CASE
      WHEN COALESCE(k.je_count, 0) = 0 THEN 'unjournaled'
      WHEN k.je_count > 1 THEN 'multi_posted'
      WHEN abs(k.je_tax_total - i2.doc_tax_total) <= 0.01 THEN 'matched'
      ELSE 'difference'
    END
  FROM in_docs i2 LEFT JOIN in_je k ON k.doc_id = i2.doc_id
)
SELECT jsonb_build_object(
  'basis', 'journal-vs-document',
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'documents', (
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_type, r.doc_number), '[]'::jsonb)
    FROM doc_rows r
  ),
  'totals', jsonb_build_object(
    'docs_checked', (SELECT COUNT(*) FROM doc_rows),
    'matched', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'matched'),
    'with_difference', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'difference'),
    'unjournaled', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'unjournaled'),
    'multi_posted', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'multi_posted'),
    'absolute_difference_sum', (SELECT COALESCE(SUM(abs(r.je_tax_total - r.doc_tax_total)), 0)
                                FROM doc_rows r WHERE r.match_status IN ('difference', 'multi_posted')),
    'unmapped_ledger_residual_sum', (SELECT COALESCE(SUM(r.unmapped_residual), 0) FROM doc_rows r)
  ),
  'notes_coverage', jsonb_build_object(
    'credit_notes_live', (SELECT COUNT(*) FROM credit_notes cn2
                          WHERE cn2.business_id = p_business_id
                            AND cn2.status IN ('issued', 'applied')
                            AND cn2.date BETWEEN p_from AND p_to),
    'credit_note_posted_jes', (SELECT COUNT(*) FROM journal_entries je2
                               WHERE je2.business_id = p_business_id
                                 AND je2.status = 'posted'
                                 AND je2.reference_type = 'credit_note'),
    'debit_notes_live', (SELECT COUNT(*) FROM debit_notes dn2
                         WHERE dn2.business_id = p_business_id
                           AND dn2.status IN ('issued', 'applied')
                           AND dn2.date BETWEEN p_from AND p_to),
    'debit_note_posted_jes', (SELECT COUNT(*) FROM journal_entries je3
                              WHERE je3.business_id = p_business_id
                                AND je3.status = 'posted'
                                AND je3.reference_type = 'debit_note')),
  'boundary_note', 'Per-doc diffing covers invoices and bills; CN/DN JEs are covered as aggregate counts (issue vs cancellation mirror JEs make per-doc diffs v2 scope). Reversal JEs (reference_type *_reversal) are excluded from per-doc totals by design.',
  'read_only', true
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_gst_reconciliation(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_reconciliation(uuid, date, date) TO authenticated;
