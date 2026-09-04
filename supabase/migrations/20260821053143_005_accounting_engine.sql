/*
# Double-Entry Accounting Engine

## Overview
Adds server-side enforcement for double-entry accounting rules and
balance recalculation. Keeps all existing RLS policies intact.

## New Database Objects

### Function: post_journal_entry(p_business_id, p_date, p_narration, p_reference_type, p_reference_id, p_lines)
SECURITY DEFINER function that atomically:
1. Validates the caller is a business member with write access
2. Validates total_debit = total_credit (balanced entry)
3. Validates every line has an account and at least one nonzero amount
4. Validates no line has both debit and credit > 0
5. Generates a sequential entry_number (JE/YYYY/NNNN)
6. Inserts the journal_entries row (status='posted')
7. Inserts all journal_entry_lines rows
8. Updates each affected account's current_balance by adding the net movement

### Function: get_trial_balance(p_business_id, p_to_date)
SECURITY DEFINER function that returns one row per account with:
- account id, name, group_name, code
- opening_balance
- total debit and credit movements in the period
- closing balance (opening + debit - credit for debit-natured groups,
  opening + credit - debit for credit-natured groups)
This is the single source of truth for trial balance and ledger closing.

## Security
- Both functions are SECURITY DEFINER with fixed search_path = public
- EXECUTE revoked from PUBLIC, granted only to authenticated
- post_journal_entry checks can_write_business() before posting
- get_trial_balance checks is_business_member() before returning data
- All existing RLS policies remain unchanged and enforced
- No service-role keys needed; runs as the caller's JWT-authenticated session
*/

-- ============================================================================
-- Helper: account nature (debit vs credit) by group
-- ============================================================================
CREATE OR REPLACE FUNCTION account_nature(p_group_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_group_name IN (
      'Current Assets', 'Fixed Assets', 'Direct Expense',
      'Indirect Expense', 'Sundry Debtors', 'Cash & Bank'
    ) THEN 'debit'
    WHEN p_group_name IN (
      'Current Liabilities', 'Long-term Liabilities', 'Capital Account',
      'Direct Income', 'Indirect Income', 'Sundry Creditors'
    ) THEN 'credit'
    ELSE 'debit'
  END;
$$;

-- ============================================================================
-- Function: post_journal_entry
-- Atomically posts a balanced journal entry and updates account balances
-- ============================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id uuid,
  p_date date,
  p_narration text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_seq int;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_line jsonb;
  v_account_id uuid;
  v_account_name text;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_nature text;
  v_movement numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Journal entry must have at least one line';
  END IF;

  -- Validate lines and compute totals
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_account_id := v_line->>'account_id';
    v_debit := COALESCE((v_line->>'debit_amount')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit_amount')::numeric, 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Every line must have an account';
    END IF;

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Amounts cannot be negative';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'A line cannot have both debit and credit amounts';
    END IF;

    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'Every line must have a nonzero amount';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  v_total_debit := round(v_total_debit, 2);
  v_total_credit := round(v_total_credit, 2);

  IF v_total_debit != v_total_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced. Total debit % does not equal total credit %', v_total_debit, v_total_credit;
  END IF;

  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'Journal entry must have a nonzero total';
  END IF;

  -- Generate sequential entry number
  SELECT COALESCE(max(
    CASE
      WHEN entry_number ~ '^JE/[0-9]{4}/[0-9]+$'
        THEN substring(entry_number from '[0-9]+$')::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM journal_entries
  WHERE business_id = p_business_id
    AND entry_number ~ ('^JE/' || extract(year from p_date)::text || '/[0-9]+$');

  v_entry_number := 'JE/' || extract(year from p_date)::text || '/' || lpad(v_seq::text, 4, '0');

  -- Insert the journal entry
  INSERT INTO journal_entries (
    business_id, entry_number, date, reference_type, reference_id,
    narration, total_debit, total_credit, status, created_by
  ) VALUES (
    p_business_id, v_entry_number, p_date, p_reference_type, p_reference_id,
    p_narration, v_total_debit, v_total_credit, 'posted', auth.uid()
  )
  RETURNING id INTO v_entry_id;

  -- Insert lines and update account balances
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_account_id := v_line->>'account_id';
    v_debit := COALESCE((v_line->>'debit_amount')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit_amount')::numeric, 0);

    SELECT name INTO v_account_name FROM accounts WHERE id = v_account_id;

    INSERT INTO journal_entry_lines (
      business_id, entry_id, account_id, account_name,
      debit_amount, credit_amount
    ) VALUES (
      p_business_id, v_entry_id, v_account_id, v_account_name,
      v_debit, v_credit
    );

    -- Update account current_balance
    -- For debit-natured accounts: debit increases, credit decreases
    -- For credit-natured accounts: credit increases, debit decreases
    SELECT account_nature(group_name) INTO v_nature FROM accounts WHERE id = v_account_id;

    IF v_nature = 'debit' THEN
      v_movement := v_debit - v_credit;
    ELSE
      v_movement := v_credit - v_debit;
    END IF;

    UPDATE accounts
    SET current_balance = round(COALESCE(current_balance, 0) + v_movement, 2)
    WHERE id = v_account_id;
  END LOOP;

  RETURN v_entry_id;
END;
$$;

-- ============================================================================
-- Function: get_trial_balance
-- Returns per-account opening, movements, and closing balances
-- ============================================================================
CREATE OR REPLACE FUNCTION get_trial_balance(
  p_business_id uuid,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  account_name text,
  group_name text,
  code text,
  opening_balance numeric,
  period_debit numeric,
  period_credit numeric,
  closing_balance numeric,
  nature text
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
  SELECT
    a.id,
    a.name,
    a.group_name,
    a.code,
    COALESCE(a.opening_balance, 0)::numeric AS opening_balance,
    COALESCE(mov.debit_sum, 0)::numeric AS period_debit,
    COALESCE(mov.credit_sum, 0)::numeric AS period_credit,
    (
      COALESCE(a.opening_balance, 0) +
      CASE
        WHEN account_nature(a.group_name) = 'debit'
          THEN COALESCE(mov.debit_sum, 0) - COALESCE(mov.credit_sum, 0)
        ELSE COALESCE(mov.credit_sum, 0) - COALESCE(mov.debit_sum, 0)
      END
    )::numeric AS closing_balance,
    account_nature(a.group_name) AS nature
  FROM accounts a
  LEFT JOIN LATERAL (
    SELECT
      sum(l.debit_amount) AS debit_sum,
      sum(l.credit_amount) AS credit_sum
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = a.id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
      AND (p_to_date IS NULL OR e.date <= p_to_date)
  ) mov ON true
  WHERE a.business_id = p_business_id
  ORDER BY a.group_name, a.name;
END;
$$;

-- Revoke public execute, grant to authenticated only
REVOKE EXECUTE ON FUNCTION post_journal_entry FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_trial_balance FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_nature(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION post_journal_entry TO authenticated;
GRANT EXECUTE ON FUNCTION get_trial_balance TO authenticated;
