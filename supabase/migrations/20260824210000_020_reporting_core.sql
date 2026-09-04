/*
# 020 — Reporting core: KPIs, P&L, Balance Sheet, cashflow, day-book, aging BASES (T20)

Read-only reporting layer. VIEWS are created WITH (security_invoker = on) so
RLS keeps applying through them (Supabase PG15+); RPCs are SECURITY DEFINER
with the standard auth/business guards.

STABLE COLUMN CONTRACTS (FE binds against these; do not rename):

- v_dashboard_kpis: ONE ROW PER BUSINESS
    business_id, sales_total, sales_count, purchases_total, purchases_count,
    expenses_total, receivables_outstanding, receivables_overdue,
    payables_outstanding, payables_overdue, cash_in_hand, bank_balance,
    collections_today, payouts_today
  Live docs only (sales: issued/partially_paid/paid; purchases:
  confirmed/partially_paid/paid). Overdue = unpaid portion past due_date.
  This view is the SINGLE SOURCE for dashboard numbers: accrual totals
  (docs) and realized cash (collections/payouts) come from the same query
  surface — absorbs the T45 accrual-vs-balance-history delta wish.

- v_cashflow_daily: business_id, flow_date, inflow, outflow
  Journal lines hitting the canonical Cash/Bank ledgers (post-013b names),
  posted entries only. Debit = money in, credit = money out.

- v_day_book: business_id, entry_date, doc_type, doc_id, doc_number,
    party_name, description, debit_ledger, credit_ledger, amount
  Legs: sale, purchase, expense, payment_received, payment_made, journal.
  Manual/posted journals appear once per entry (aggregated sides).

- v_receivables_aging_base / v_payables_aging_base: one row per LIVE doc
    (business_id, doc_id, doc_number, party_id, party_name, doc_date,
     due_date, grand_total, paid_amount, outstanding,
     days_outstanding, days_overdue)
  outstanding is COMPUTED (grand_total - paid_amount), never trusted from
  balance_amount. T28 buckets build strictly on these.

RPCs:
- get_profit_and_loss(biz, from, to) -> section, group_name, account_id,
    account_name, amount  [amount nature-signed positive within section;
    final row section='Summary', account_name='Net Profit']
- get_balance_sheet(biz, as_of DEFAULT NULL) -> group_name, account_id,
    account_name, closing_balance (nature-signed), nature; plus synthetic
    'Retained Earnings (P&L to date)' row under Capital Account so assets
    == liabilities + capital + P&L-to-date ties arithmetically.
*/

-- ============================================================================
-- DASHBOARD KPIs (single source)
-- ============================================================================
CREATE OR REPLACE VIEW v_dashboard_kpis WITH (security_invoker = on) AS
SELECT
  b.id AS business_id,
  COALESCE(s.total, 0)::numeric          AS sales_total,
  COALESCE(s.cnt, 0)                     AS sales_count,
  COALESCE(pu.total, 0)::numeric         AS purchases_total,
  COALESCE(pu.cnt, 0)                    AS purchases_count,
  COALESCE(ex.total, 0)::numeric         AS expenses_total,
  COALESCE(s.outstanding, 0)::numeric    AS receivables_outstanding,
  COALESCE(s.overdue, 0)::numeric        AS receivables_overdue,
  COALESCE(pu.outstanding, 0)::numeric   AS payables_outstanding,
  COALESCE(pu.overdue, 0)::numeric       AS payables_overdue,
  COALESCE(cash.bal, 0)::numeric         AS cash_in_hand,
  COALESCE(bank.bal, 0)::numeric         AS bank_balance,
  COALESCE(coll.today_amt, 0)::numeric   AS collections_today,
  COALESCE(pay.today_amt, 0)::numeric    AS payouts_today
FROM businesses b
LEFT JOIN LATERAL (
  SELECT
    sum(si.grand_total)                                        AS total,
    count(*)                                                   AS cnt,
    sum(GREATEST(si.grand_total - si.paid_amount, 0))
      FILTER (WHERE si.payment_status <> 'paid')               AS outstanding,
    sum(GREATEST(si.grand_total - si.paid_amount, 0))
      FILTER (WHERE si.payment_status <> 'paid'
               AND si.due_date < CURRENT_DATE)                 AS overdue
  FROM sales_invoices si
  WHERE si.business_id = b.id
    AND si.status IN ('issued', 'partially_paid', 'paid')
) s ON true
LEFT JOIN LATERAL (
  SELECT
    sum(pb.grand_total)                                        AS total,
    count(*)                                                   AS cnt,
    sum(GREATEST(pb.grand_total - pb.paid_amount, 0))
      FILTER (WHERE pb.payment_status <> 'paid')               AS outstanding,
    sum(GREATEST(pb.grand_total - pb.paid_amount, 0))
      FILTER (WHERE pb.payment_status <> 'paid'
               AND pb.due_date < CURRENT_DATE)                 AS overdue
  FROM purchase_bills pb
  WHERE pb.business_id = b.id
    AND pb.status IN ('confirmed', 'partially_paid', 'paid')
) pu ON true
LEFT JOIN LATERAL (
  SELECT sum(e.total_amount) AS total
  FROM expenses e
  WHERE e.business_id = b.id
) ex ON true
LEFT JOIN LATERAL (
  SELECT sum(a.current_balance) AS bal
  FROM accounts a
  WHERE a.business_id = b.id AND a.name = 'Cash'
) cash ON true
LEFT JOIN LATERAL (
  SELECT sum(a.current_balance) AS bal
  FROM accounts a
  WHERE a.business_id = b.id AND a.name = 'Bank'
) bank ON true
LEFT JOIN LATERAL (
  SELECT sum(pm.amount) AS today_amt
  FROM payments pm
  WHERE pm.business_id = b.id AND pm.type = 'received'
    AND pm.date = CURRENT_DATE
) coll ON true
LEFT JOIN LATERAL (
  SELECT sum(pm.amount) AS today_amt
  FROM payments pm
  WHERE pm.business_id = b.id AND pm.type = 'made'
    AND pm.date = CURRENT_DATE
) pay ON true;

-- ============================================================================
-- DAILY CASHFLOW (canonical Cash/Bank ledger lines)
-- ============================================================================
CREATE OR REPLACE VIEW v_cashflow_daily WITH (security_invoker = on) AS
SELECT
  l.business_id,
  e.date AS flow_date,
  COALESCE(sum(l.debit_amount), 0)::numeric  AS inflow,
  COALESCE(sum(l.credit_amount), 0)::numeric AS outflow
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.entry_id
JOIN accounts a ON a.id = l.account_id
WHERE e.status = 'posted'
  AND a.name IN ('Cash', 'Bank')
GROUP BY l.business_id, e.date;

-- ============================================================================
-- DAY BOOK (unified document feed)
-- ============================================================================
CREATE OR REPLACE VIEW v_day_book WITH (security_invoker = on) AS
SELECT si.business_id, si.invoice_date AS entry_date, 'sale'::text AS doc_type,
       si.id AS doc_id, si.invoice_number AS doc_number, c.name AS party_name,
       'Sales invoice'::text AS description,
       'Accounts Receivable'::text AS debit_ledger,
       'Sales Revenue'::text AS credit_ledger,
       si.grand_total::numeric AS amount
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
UNION ALL
SELECT pb.business_id, pb.bill_date, 'purchase'::text, pb.id, pb.bill_number,
       sp.name, 'Purchase bill'::text,
       'Purchases'::text, 'Accounts Payable'::text, pb.grand_total::numeric
FROM purchase_bills pb
JOIN suppliers sp ON sp.id = pb.supplier_id
WHERE pb.status IN ('confirmed', 'partially_paid', 'paid')
UNION ALL
SELECT ex.business_id, ex.date, 'expense'::text, ex.id, ex.expense_number,
       NULL::text, COALESCE(ec.name, 'Miscellaneous') || ' expense',
       COALESCE(ec.name, 'Miscellaneous Expense') AS debit_ledger,
       CASE ex.payment_method
         WHEN 'cash' THEN 'Cash'
         WHEN 'bank' THEN 'Bank'
         WHEN 'upi' THEN 'Bank'
         WHEN 'card' THEN 'Bank'
         WHEN 'cheque' THEN 'Bank'
         ELSE 'Expense Payable'
       END::text, ex.total_amount::numeric
FROM expenses ex
LEFT JOIN expense_categories ec ON ec.id = ex.category_id
UNION ALL
SELECT pm.business_id, pm.date, 'payment_received'::text, pm.id, pm.payment_number,
       cu.name, 'Payment received'::text,
       CASE pm.payment_method WHEN 'cash' THEN 'Cash' ELSE 'Bank' END,
       'Accounts Receivable'::text, pm.amount::numeric
FROM payments pm
JOIN customers cu ON cu.id = pm.party_id AND pm.party_type = 'customer'
WHERE pm.type = 'received'
UNION ALL
SELECT pm.business_id, pm.date, 'payment_made'::text, pm.id, pm.payment_number,
       su.name, 'Payment made'::text,
       'Accounts Payable'::text,
       CASE pm.payment_method WHEN 'cash' THEN 'Cash' ELSE 'Bank' END,
       pm.amount::numeric
FROM payments pm
JOIN suppliers su ON su.id = pm.party_id AND pm.party_type = 'supplier'
WHERE pm.type = 'made';

-- ============================================================================
-- AGING BASES (consumed verbatim by 021 buckets/statements)
-- ============================================================================
CREATE OR REPLACE VIEW v_receivables_aging_base WITH (security_invoker = on) AS
SELECT
  si.business_id,
  si.id            AS doc_id,
  si.invoice_number AS doc_number,
  si.customer_id   AS party_id,
  c.name           AS party_name,
  si.invoice_date  AS doc_date,
  COALESCE(si.due_date, si.invoice_date) AS due_date,
  si.grand_total::numeric AS grand_total,
  si.paid_amount::numeric AS paid_amount,
  GREATEST(si.grand_total - si.paid_amount, 0)::numeric AS outstanding,
  GREATEST(CURRENT_DATE - si.invoice_date, 0) AS days_outstanding,
  GREATEST(CURRENT_DATE - COALESCE(si.due_date, si.invoice_date), 0) AS days_overdue
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.status IN ('issued', 'partially_paid', 'paid');

CREATE OR REPLACE VIEW v_payables_aging_base WITH (security_invoker = on) AS
SELECT
  pb.business_id,
  pb.id            AS doc_id,
  pb.bill_number   AS doc_number,
  pb.supplier_id   AS party_id,
  sp.name          AS party_name,
  pb.bill_date     AS doc_date,
  COALESCE(pb.due_date, pb.bill_date) AS due_date,
  pb.grand_total::numeric AS grand_total,
  pb.paid_amount::numeric AS paid_amount,
  GREATEST(pb.grand_total - pb.paid_amount, 0)::numeric AS outstanding,
  GREATEST(CURRENT_DATE - pb.bill_date, 0) AS days_outstanding,
  GREATEST(CURRENT_DATE - COALESCE(pb.due_date, pb.bill_date), 0) AS days_overdue
FROM purchase_bills pb
JOIN suppliers sp ON sp.id = pb.supplier_id
WHERE pb.status IN ('confirmed', 'partially_paid', 'paid');

-- ============================================================================
-- PROFIT & LOSS (windowed, nature-signed amounts per account)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_profit_and_loss(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS TABLE (
  section text,
  group_name text,
  account_id uuid,
  account_name text,
  amount numeric
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
    SELECT l.account_id,
           COALESCE(sum(l.debit_amount), 0)  AS dr,
           COALESCE(sum(l.credit_amount), 0) AS cr
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date >= p_from_date
      AND e.date <= p_to_date
    GROUP BY l.account_id
  ),
  classified AS (
    SELECT
      CASE
        WHEN a.group_name LIKE 'Income%' THEN 'Income'
        WHEN a.group_name = 'Direct Expense' THEN 'Direct Expense'
        WHEN a.group_name LIKE 'Indirect Expense%' THEN 'Indirect Expense'
      END AS c_section,
      a.group_name AS c_group,
      a.id AS c_account_id,
      a.name AS c_account_name,
      CASE WHEN a.group_name LIKE 'Income%'
        THEN COALESCE(m.cr, 0) - COALESCE(m.dr, 0)
        ELSE COALESCE(m.dr, 0) - COALESCE(m.cr, 0)
      END AS c_amt
    FROM accounts a
    LEFT JOIN mov m ON m.account_id = a.id
    WHERE a.business_id = p_business_id
      AND (a.group_name LIKE 'Income%'
           OR a.group_name = 'Direct Expense'
           OR a.group_name LIKE 'Indirect Expense%')
  )
  SELECT c_section AS section, c_group AS group_name,
         c_account_id AS account_id, c_account_name AS account_name,
         round(c_amt, 2) AS amount
  FROM classified
  WHERE c_section IS NOT NULL AND c_amt <> 0
  UNION ALL
  SELECT 'Summary', 'Net Profit'::text, NULL::uuid, 'Net Profit'::text,
         round(COALESCE(sum(CASE WHEN c_section = 'Income' THEN c_amt
                                 ELSE -c_amt END), 0), 2)
  FROM classified
  WHERE c_section IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_profit_and_loss(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_profit_and_loss(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_profit_and_loss(uuid, date, date) TO authenticated;

-- ============================================================================
-- BALANCE SHEET (as-of, incl. synthetic retained earnings so it ties)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_balance_sheet(
  p_business_id uuid,
  p_as_of date DEFAULT NULL
)
RETURNS TABLE (
  group_name text,
  account_id uuid,
  account_name text,
  closing_balance numeric,
  nature text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_as_of := COALESCE(p_as_of, CURRENT_DATE);

  RETURN QUERY
  WITH mov AS (
    SELECT l.account_id,
           COALESCE(sum(l.debit_amount), 0)  AS dr,
           COALESCE(sum(l.credit_amount), 0) AS cr
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date <= v_as_of
    GROUP BY l.account_id
  ),
  bs_accounts AS (
    SELECT
      a.group_name,
      a.id AS account_id2,
      a.name AS account_name2,
      COALESCE(a.opening_balance, 0) +
        CASE WHEN account_nature(a.group_name) = 'debit'
          THEN COALESCE(m.dr, 0) - COALESCE(m.cr, 0)
          ELSE COALESCE(m.cr, 0) - COALESCE(m.dr, 0)
        END AS closing_balance2,
      account_nature(a.group_name) AS nature2
    FROM accounts a
    LEFT JOIN mov m ON m.account_id = a.id
    WHERE a.business_id = p_business_id
      AND (a.group_name LIKE '%Asset%'
           OR a.group_name IN ('Current Liabilities', 'Long Term Liabilities',
                               'Capital Account'))
  ),
  pnl_to_date AS (
    SELECT
      COALESCE(sum(CASE WHEN a.group_name LIKE 'Income%'
        THEN COALESCE(m.cr, 0) - COALESCE(m.dr, 0)
        ELSE -(COALESCE(m.dr, 0) - COALESCE(m.cr, 0)) END), 0) AS net
    FROM accounts a
    LEFT JOIN mov m ON m.account_id = a.id
    WHERE a.business_id = p_business_id
      AND (a.group_name LIKE 'Income%'
           OR a.group_name = 'Direct Expense'
           OR a.group_name LIKE 'Indirect Expense%')
  )
  SELECT b.group_name, b.account_id2, b.account_name2,
         round(b.closing_balance2, 2), b.nature2
  FROM bs_accounts b
  UNION ALL
  SELECT 'Capital Account', NULL::uuid,
         'Retained Earnings (P&L to date)', round(pl.net, 2), 'credit'
  FROM pnl_to_date pl;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_balance_sheet(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_balance_sheet(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_balance_sheet(uuid, date) TO authenticated;
