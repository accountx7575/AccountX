/*
# 025 — GST summary aggregation surface (T53)

get_gst_summary(biz, from, to) RETURNS TABLE(
  section        text,   -- 'Outward' | 'Inward' | 'Summary'
  ledger_name    text,   -- component ledger ('Output CGST', ...) or label
  taxable_amount numeric,
  cgst           numeric,
  sgst           numeric,
  igst           numeric,
  cess           numeric,
  net_amount     numeric -- signed position of THIS row
)

Built FROM JOURNAL LINES on the GST account groups per instruction:
- Outward = accounts in group 'GST Payable': liability grows on credit;
  amount = SUM(credit - debit) over posted entries in [from..to].
  Credit-notes naturally REDUCE outward (they debit Output GST).
- Inward = accounts in group 'GST Receivable': credit grows on debit;
  amount = SUM(debit - credit). Debit notes reduce inward symmetrically.
- Component classification by ledger-name suffix (CGST/SGST/IGST/Cess),
  so m011's original cess naming and 022's Output/Input Cess both land
  correctly regardless of which name a business actually uses.
- taxable_outward = signed movement on the canonical 'Sales' ledger
  (Direct Income); taxable_inward = signed movement on 'Purchases'
  (Direct Expense). Journal-truth, not doc-table truth — matches the JE
  posting engine single-source doctrine.
- Final row section='Summary', ledger_name='Net GST Payable':
  per-component outward-minus-inward plus net_position total; negative
  means refund/credit carried forward.

RPC chosen over view (period params required). SECURITY DEFINER +
standard guards so FE binds immediately.
*/

CREATE OR REPLACE FUNCTION get_gst_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS TABLE (
  section text,
  ledger_name text,
  taxable_amount numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric,
  net_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  RETURN QUERY
  WITH mov AS (
    SELECT a.name, a.group_name,
           COALESCE(SUM(l.credit_amount - l.debit_amount), 0) AS c_bal,
           COALESCE(SUM(l.debit_amount - l.credit_amount), 0) AS d_bal
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date >= p_from_date
      AND e.date <= p_to_date
      AND (
        a.group_name IN ('GST Payable', 'GST Receivable')
        OR (a.group_name = 'Direct Income' AND a.name = 'Sales')
        OR (a.group_name = 'Direct Expense' AND a.name = 'Purchases')
      )
    GROUP BY a.name, a.group_name
  ),
  comp AS (
    SELECT
      CASE WHEN m.group_name = 'GST Payable' THEN 'Outward'
           WHEN m.group_name = 'GST Receivable' THEN 'Inward'
      END AS sec,
      m.name AS lname,
      CASE WHEN m.name LIKE '%CGST%' THEN m.c_bal ELSE 0 END AS c_cg,
      CASE WHEN m.name LIKE '%SGST%' THEN m.c_bal ELSE 0 END AS c_sg,
      CASE WHEN m.name LIKE '%IGST%' THEN m.c_bal ELSE 0 END AS c_ig,
      CASE WHEN m.name LIKE '%Cess%' THEN m.c_bal ELSE 0 END AS c_ce,
      CASE WHEN m.name LIKE '%CGST%' THEN m.d_bal ELSE 0 END AS d_cg,
      CASE WHEN m.name LIKE '%SGST%' THEN m.d_bal ELSE 0 END AS d_sg,
      CASE WHEN m.name LIKE '%IGST%' THEN m.d_bal ELSE 0 END AS d_ig,
      CASE WHEN m.name LIKE '%Cess%' THEN m.d_bal ELSE 0 END AS d_ce
    FROM mov m
    WHERE m.group_name IN ('GST Payable', 'GST Receivable')
  ),
  taxable AS (
    SELECT
      round(COALESCE(SUM(m.c_bal) FILTER (WHERE m.group_name = 'Direct Income'), 0), 2) AS out_tax,
      round(COALESCE(SUM(m.d_bal) FILTER (WHERE m.group_name = 'Direct Expense'), 0), 2) AS in_tax
    FROM mov m
  )
  SELECT
    c.sec,
    c.lname,
    CASE WHEN c.sec = 'Outward' THEN t.out_tax ELSE t.in_tax END,
    round(c.c_cg + c.d_cg, 2),
    round(c.c_sg + c.d_sg, 2),
    round(c.c_ig + c.d_ig, 2),
    round(c.c_ce + c.d_ce, 2),
    round(c.c_cg + c.d_cg + c.c_sg + c.d_sg + c.c_ig + c.d_ig + c.c_ce + c.d_ce, 2)
  FROM comp c
  CROSS JOIN taxable t
  UNION ALL
  SELECT
    'Summary',
    'Net GST Payable',
    round(t.out_tax - t.in_tax, 2),
    round(SUM(c.c_cg + c.d_cg), 2),
    round(SUM(c.c_sg + c.d_sg), 2),
    round(SUM(c.c_ig + c.d_ig), 2),
    round(SUM(c.c_ce + c.d_ce), 2),
    round(SUM(c.c_cg + c.d_cg + c.c_sg + c.d_sg + c.c_ig + c.d_ig + c.c_ce + c.d_ce), 2)
  FROM comp c
  CROSS JOIN taxable t;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_gst_summary(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_gst_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_gst_summary(uuid, date, date) TO authenticated;
