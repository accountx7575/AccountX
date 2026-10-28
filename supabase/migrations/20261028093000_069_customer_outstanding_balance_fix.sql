-- Migration: 20261028093000_069_customer_outstanding_balance_fix.sql
-- Description: Reconcile customer outstanding balance, total_sales, and total_paid from posted documents.
-- Ensures that unallocated/advance payments do not produce arbitrary positive debit balances.

-- 1. Reconcile customers current_balance, total_sales, and total_paid
UPDATE customers c
SET current_balance = CASE
      WHEN COALESCE(c.opening_balance, 0) + COALESCE(inv.total_inv, 0) <= 0 THEN 0.00
      ELSE GREATEST(0.00, ROUND(COALESCE(c.opening_balance, 0) + COALESCE(inv.total_inv, 0) - COALESCE(pay.total_pay, 0), 2))
    END,
    total_sales = COALESCE(ROUND(inv.total_inv, 2), 0.00),
    total_paid = COALESCE(ROUND(pay.total_pay, 2), 0.00)
FROM (
  SELECT c2.id,
         COALESCE(SUM(si.grand_total), 0) AS total_inv
  FROM customers c2
  LEFT JOIN sales_invoices si ON si.customer_id = c2.id AND si.status IN ('issued', 'partially_paid', 'paid')
  GROUP BY c2.id
) inv
LEFT JOIN (
  SELECT c3.id,
         COALESCE(SUM(pm.amount), 0) AS total_pay
  FROM customers c3
  LEFT JOIN payments pm ON pm.party_id = c3.id AND pm.party_type = 'customer' AND pm.type = 'received'
  GROUP BY c3.id
) pay ON pay.id = inv.id
WHERE c.id = inv.id;

-- 2. Reconcile Sundry Debtors accounts current_balance to match posted journal entries
UPDATE accounts a
SET current_balance = round(
  COALESCE(a.opening_balance, 0) +
  CASE WHEN account_nature(a.group_name) = 'debit' THEN 1 ELSE -1 END *
  COALESCE((
    SELECT SUM(l.debit_amount - l.credit_amount)
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = a.id AND e.status = 'posted'
  ), 0),
  2)
WHERE a.group_name = 'Sundry Debtors';
