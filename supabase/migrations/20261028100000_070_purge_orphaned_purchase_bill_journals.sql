-- Migration: 20261028100000_070_purge_orphaned_purchase_bill_journals.sql
-- Description: Purge test purchase bill journal entries and lines (DOC/26-27/1, PB/6263, JE/2026/0041-0045)
-- and recalculate all account balances in the chart of accounts from active posted journal entries.

-- 1. Delete matching test journal entries and cascading lines
DELETE FROM journal_entries
WHERE entry_number IN ('JE/2026/0041', 'JE/2026/0042', 'JE/2026/0043', 'JE/2026/0044', 'JE/2026/0045')
   OR narration ILIKE '%DOC/26-27/1%'
   OR narration ILIKE '%PB/6263%'
   OR narration ILIKE '%hfjh6263%'
   OR reference_id = 'c7202302-31d3-440b-bb06-91be8c30fee4';

-- 2. Clean up any orphaned journal lines without parent entry
DELETE FROM journal_entry_lines
WHERE entry_id NOT IN (SELECT id FROM journal_entries);

-- 3. Recalculate all account balances from active posted journal lines
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
  2);
