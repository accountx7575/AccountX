/*
# 037 — Canonical account balance maintenance (QA P1 #5 fix)

Problem: accounts.current_balance was maintained INCREMENTALLY by some
writers (engine wrappers) but never by direct-INSERT paths (payments 029,
CN/DN 022, settlement 028, FY close 027) — drift accumulates and the
dashboard liquid-cash KPI reads the stale column.

Fix (same pattern as stock's canonical recompute, 023): an AFTER row
trigger on journal_entry_lines recomputes the affected account's
balance from first principles after every line mutation:

  current_balance = round(opening_balance
    + nature_sign * SUM(posted dr - cr), 2)

This is EXACTLY the brought-forward identity get_trial_balance/m019's
ledger already uses, so ledger/TB/CoA/dashboard finally agree by
construction. Existing incremental UPDATEs become harmless (this trigger
runs after them and wins). One-time backfill heals accumulated drift.

Draft lines are excluded (status='posted' filter). Index added for the
per-account aggregation.
*/

CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);

CREATE OR REPLACE FUNCTION trg_recalc_account_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct uuid;
BEGIN
  v_acct := COALESCE(NEW.account_id, OLD.account_id);
  IF v_acct IS NULL THEN
    RETURN NULL;
  END IF;

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
  WHERE a.id = v_acct;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_account_balance_tg ON journal_entry_lines;
CREATE TRIGGER trg_recalc_account_balance_tg
AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION trg_recalc_account_balance();

-- One-time heal of accumulated drift across ALL accounts
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
