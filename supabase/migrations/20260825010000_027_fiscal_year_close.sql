/*
# 027 — Fiscal year close (T31)

SCHEMA: fiscal_year_closes — one row per (business, fy_label) closure.
businesses.financial_year (text label, m001) is used AS-IS; the close
ledger lives here instead of widening the businesses table. Update/Delete
policies deliberately OMITTED: closures are append-only history (reopen
marks the row, never rewrites it).

CONTRACTS (both admin-only via is_business_admin):

close_fiscal_year(p_business_id) RETURNS uuid (closing JE id)
- Locks the business row, reads financial_year label.
- Idempotency: RAISES if an UN-reopened close already exists for that
  label; after a reopen, the year may be closed again.
- Computes ALL-TIME-to-date nature-signed balances per account across
  Income groups (credit-positive) and Expense groups (debit-positive),
  posted entries only. Zero balances excluded. RAISES if there is
  nothing to close.
- Posts ONE balanced closing JE (reference_type 'fiscal_close'):
    Dr each income ledger (its balance)
    Cr each expense ledger (its balance)
    Cr 'Retained Earnings' / Capital Account by net (income - expenses)
  Debits == Credits by construction (expenses + net == income).
  This realizes 020's synthetic retained-earnings row into actual
  ledgers; afterwards the P&L groups sit at zero and the BS ties through
  Retained Earnings. Numbering: JE-FYCLOSE-<label>.
- Writes an audit_logs row. Returns the JE id.

reopen_fiscal_year(p_business_id) RETURNS uuid (reversal JE id)
- Finds the active close for the CURRENT label (RAISES if none/reopened).
- House-pattern reversal: READS the actually-posted close-JE lines and
  swaps sides into a mirror JE (reference_type 'fiscal_reopen'),
  numbered JE-FYREOPEN-<label>; marks the close row reopened_at=now().
- Audit row written. Returns the reversal JE id.
*/

-- ============================================================================
-- A. CLOSE LEDGER TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS fiscal_year_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fy_label text NOT NULL,
  close_date date NOT NULL DEFAULT CURRENT_DATE,
  closing_je_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopening_je_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- One ACTIVE closure per business at a time; historical (reopened) rows kept
CREATE UNIQUE INDEX IF NOT EXISTS uq_fyc_active_per_business
  ON fiscal_year_closes(business_id)
  WHERE reopened_at IS NULL;

ALTER TABLE fiscal_year_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fiscal_year_closes_select" ON fiscal_year_closes;
CREATE POLICY "fiscal_year_closes_select" ON fiscal_year_closes FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "fiscal_year_closes_insert" ON fiscal_year_closes;
CREATE POLICY "fiscal_year_closes_insert" ON fiscal_year_closes FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_fyc_business ON fiscal_year_closes(business_id);

-- ============================================================================
-- B. CLOSE
-- ============================================================================
CREATE OR REPLACE FUNCTION close_fiscal_year(
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy text;
  v_je uuid;
  v_close_id uuid;
  v_income_total numeric(14,2);
  v_expense_total numeric(14,2);
  v_net numeric(14,2);
  v_dr_sum numeric(14,2);
  v_cr_sum numeric(14,2);
  v_re uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can close a fiscal year';
  END IF;

  SELECT financial_year INTO v_fy
  FROM businesses
  WHERE id = p_business_id
  FOR UPDATE;

  IF v_fy IS NULL THEN
    RAISE EXCEPTION 'Business has no financial year label set';
  END IF;

  IF EXISTS (
    SELECT 1 FROM fiscal_year_closes
    WHERE business_id = p_business_id AND fy_label = v_fy
      AND reopened_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Fiscal year % is already closed', v_fy;
  END IF;

  -- Nature-signed all-time balances per P&L account
  SELECT
    COALESCE(SUM(CASE WHEN a.group_name LIKE '%Income%'
      THEN l.credit_amount - l.debit_amount END), 0),
    COALESCE(SUM(CASE WHEN a.group_name LIKE '%Expense%'
      THEN l.debit_amount - l.credit_amount END), 0)
  INTO v_income_total, v_expense_total
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id
    AND e.status = 'posted'
    AND (a.group_name LIKE '%Income%' OR a.group_name LIKE '%Expense%');

  v_net := round(v_income_total - v_expense_total, 2);

  IF v_income_total = 0 AND v_expense_total = 0 THEN
    RAISE EXCEPTION 'No open profit-and-loss balances to close';
  END IF;

  -- Per-account ROUNDED arm sums; header totals are derived from THESE so
  -- total_debit/credit equal the actual line sums to the penny.
  WITH acct AS (
    SELECT a.id, a.group_name AS g,
      CASE WHEN a.group_name LIKE '%Income%'
        THEN round(COALESCE(SUM(l.credit_amount - l.debit_amount), 0), 2)
        ELSE round(COALESCE(SUM(l.debit_amount - l.credit_amount), 0), 2)
      END AS bal
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.business_id = p_business_id AND e.status = 'posted'
      AND (a.group_name LIKE '%Income%' OR a.group_name LIKE '%Expense%')
    GROUP BY a.id, a.group_name
  )
  SELECT
    round(COALESCE(SUM(CASE WHEN g LIKE '%Income%'   AND bal > 0 THEN bal END), 0), 2)
      + round(COALESCE(SUM(CASE WHEN g LIKE '%Expense%' AND bal < 0 THEN -bal END), 0), 2)
      + round(GREATEST(-v_net, 0), 2),
    round(COALESCE(SUM(CASE WHEN g LIKE '%Expense%'  AND bal > 0 THEN bal END), 0), 2)
      + round(COALESCE(SUM(CASE WHEN g LIKE '%Income%'  AND bal < 0 THEN -bal END), 0), 2)
      + round(GREATEST(v_net, 0), 2)
  INTO v_dr_sum, v_cr_sum
  FROM acct;

  INSERT INTO fiscal_year_closes (business_id, fy_label, closed_by)
  VALUES (p_business_id, v_fy, auth.uid())
  RETURNING id INTO v_close_id;

  v_re := find_or_create_account(p_business_id, 'Retained Earnings', 'Capital Account');

  -- Four-arm line build keeps every amount non-negative even when an
  -- account carries a reversed-sign balance (e.g. debit-heavy income).
  INSERT INTO journal_entries (business_id, entry_number, date, narration,
    total_debit, total_credit, status, reference_type, reference_id, created_by)
  VALUES (p_business_id, 'JE-FYCLOSE-' || v_fy, CURRENT_DATE,
    'Fiscal year close ' || v_fy,
    v_dr_sum, v_cr_sum,
    'posted', 'fiscal_close', v_close_id, auth.uid())
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
  SELECT p_business_id, v_je, a.id,
         round(COALESCE(SUM(l.credit_amount - l.debit_amount), 0), 2), 0
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Income%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.credit_amount - l.debit_amount), 0) > 0
  UNION ALL
  SELECT p_business_id, v_je, a.id, 0,
         round(-COALESCE(SUM(l.credit_amount - l.debit_amount), 0), 2)
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Income%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.credit_amount - l.debit_amount), 0) < 0
  UNION ALL
  SELECT p_business_id, v_je, a.id, 0,
         round(COALESCE(SUM(l.debit_amount - l.credit_amount), 0), 2)
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Expense%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.debit_amount - l.credit_amount), 0) > 0
  UNION ALL
  SELECT p_business_id, v_je, a.id,
         round(-COALESCE(SUM(l.debit_amount - l.credit_amount), 0), 2), 0
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Expense%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.debit_amount - l.credit_amount), 0) < 0;

  -- Counterweight: Retained Earnings absorbs the residual either direction
  IF v_net >= 0 THEN
    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_re, 0, v_net);
  ELSE
    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_re, -v_net, 0);
  END IF;

  UPDATE fiscal_year_closes
  SET closing_je_id = v_je
  WHERE id = v_close_id;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'fiscal_year_closed', 'fiscal_year_close', v_close_id,
          'FY ' || v_fy || ' closed; net ' || v_net::text || ' moved to Retained Earnings');

  RETURN v_je;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_fiscal_year(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION close_fiscal_year(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION close_fiscal_year(uuid) TO authenticated;

-- ============================================================================
-- C. REOPEN
-- ============================================================================
CREATE OR REPLACE FUNCTION reopen_fiscal_year(
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy text;
  v_close RECORD;
  v_src RECORD;
  v_je uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can reopen a fiscal year';
  END IF;

  SELECT financial_year INTO v_fy
  FROM businesses
  WHERE id = p_business_id;

  SELECT * INTO v_close
  FROM fiscal_year_closes
  WHERE business_id = p_business_id AND fy_label = v_fy
  FOR UPDATE;

  IF NOT FOUND OR v_close.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fiscal year % is not currently closed', v_fy;
  END IF;

  -- House pattern: mirror the ACTUAL posted close lines, sides swapped
  INSERT INTO journal_entries (business_id, entry_number, date, narration,
    total_debit, total_credit, status, reference_type, reference_id, created_by)
  SELECT business_id, 'JE-FYREOPEN-' || v_close.fy_label, CURRENT_DATE,
    'Fiscal year reopen ' || v_close.fy_label,
    sum(debit_amount), sum(credit_amount), 'posted',
    'fiscal_reopen', v_close.id, auth.uid()
  FROM journal_entry_lines
  WHERE entry_id = v_close.closing_je_id
  GROUP BY business_id
  RETURNING id INTO v_je;

  FOR v_src IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_entry_lines
    WHERE entry_id = v_close.closing_je_id
  LOOP
    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_src.account_id, v_src.credit_amount, v_src.debit_amount);
  END LOOP;

  UPDATE fiscal_year_closes
  SET reopened_at = now(), reopening_je_id = v_je
  WHERE id = v_close.id;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'fiscal_year_reopened', 'fiscal_year_close', v_close.id,
          'FY ' || v_close.fy_label || ' reopened');

  RETURN v_je;
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_fiscal_year(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reopen_fiscal_year(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION reopen_fiscal_year(uuid) TO authenticated;
