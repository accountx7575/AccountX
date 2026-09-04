/*
# 019 — Ledger / Trial Balance correctness (T19)

## get_trial_balance(p_business_id, p_to_date DEFAULT NULL, p_from_date DEFAULT NULL)
Signature EXTENDED backwards-compatibly: the new period parameter is
appended last, every existing caller (as-of mode) keeps working untouched.
- As-of mode (p_from_date IS NULL): byte-for-byte today's semantics.
- Period mode (both bounds): opening_balance becomes the BROUGHT-FORWARD
  figure = stored opening + nature-signed posted movements strictly before
  p_from_date; period movements cover [from .. to]; closing = bf-opening +
  signed period movement. Global identity unchanged: closing == column
  opening + ALL signed movements up to to-date. Fixes §2.3.

## get_ledger(p_business_id, p_account_id, p_from_date DEFAULT NULL, p_to_date DEFAULT NULL)
RETURNS TABLE(entry_date date, entry_number text, narration text,
              debit_amount numeric, credit_amount numeric,
              running_balance numeric, is_brought_forward boolean)
The correct data shape for LedgerPage (consumption rewire is Stanley's):
- First row is a synthetic BROUGHT-FORWARD row (is_brought_forward = true)
  carrying the nature-adjusted opening as a debit/credit split, dated at
  p_from_date (else first movement date, else today).
- Rows then flow CHRONOLOGICALLY (e.date, e.created_at, e.id) — fixes the
  anti-chronological ordering bug of accounting.ts:198 / §2.2.
- running_balance is NATURE-SIGNED (TB-consistent): it starts at the
  signed brought-forward value on the BF row and advances by
  +(debit-credit) on debit-natured accounts, +(credit-debit) on
  credit-natured ones. Clients consume the provided column directly; no
  client-side nature math needed.
- Posted entries only, business-scoped, unknown account raises.

## set_account_opening_balance(p_business_id, p_account_id, p_opening_balance)
RETURNS numeric (the new opening)
Sanctioned opening-balance workflow with automatic Opening Balance Equity
counter-entry (§2.3 "out-of-balance TB is easy to produce"):
- Locks the account row; must belong to the business; targeting the OBE
  account itself is forbidden (it is the counterweight, not a subject).
- Sets opening_balance AND moves current_balance by the same delta —
  kills the R8 stale-current_balance drift in one stroke.
- Adjusts the business's 'Opening Balance Equity' ledger (auto-created,
  Capital Account group) by delta x nature-sign(target), keeping total
  Dr openings == total Cr openings so the TB stays globally balanced.
  Openings are positions, not transactions — deliberately NO journal here.
*/

-- ============================================================================
-- Extended trial balance (as-of kept intact; period mode added)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_trial_balance(
  p_business_id uuid,
  p_to_date date DEFAULT NULL,
  p_from_date date DEFAULT NULL
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
    (
      COALESCE(a.opening_balance, 0) +
      CASE WHEN p_from_date IS NOT NULL
        THEN CASE WHEN account_nature(a.group_name) = 'debit'
                   THEN COALESCE(mov.pre_debit, 0) - COALESCE(mov.pre_credit, 0)
                   ELSE COALESCE(mov.pre_credit, 0) - COALESCE(mov.pre_debit, 0) END
        ELSE 0 END
    )::numeric AS opening_balance,
    COALESCE(mov.per_debit, 0)::numeric AS period_debit,
    COALESCE(mov.per_credit, 0)::numeric AS period_credit,
    (
      COALESCE(a.opening_balance, 0) +
      CASE WHEN p_from_date IS NOT NULL
        THEN CASE WHEN account_nature(a.group_name) = 'debit'
                   THEN COALESCE(mov.pre_debit, 0) - COALESCE(mov.pre_credit, 0)
                   ELSE COALESCE(mov.pre_credit, 0) - COALESCE(mov.pre_debit, 0) END
        ELSE 0 END
      +
      CASE WHEN account_nature(a.group_name) = 'debit'
             THEN COALESCE(mov.per_debit, 0) - COALESCE(mov.per_credit, 0)
             ELSE COALESCE(mov.per_credit, 0) - COALESCE(mov.per_debit, 0) END
    )::numeric AS closing_balance,
    account_nature(a.group_name) AS nature
  FROM accounts a
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(l.debit_amount) FILTER (WHERE e.date < p_from_date), 0)  AS pre_debit,
      COALESCE(sum(l.credit_amount) FILTER (WHERE e.date < p_from_date), 0) AS pre_credit,
      COALESCE(sum(l.debit_amount) FILTER (
        WHERE (p_from_date IS NULL OR e.date >= p_from_date)
          AND (p_to_date IS NULL OR e.date <= p_to_date)), 0)               AS per_debit,
      COALESCE(sum(l.credit_amount) FILTER (
        WHERE (p_from_date IS NULL OR e.date >= p_from_date)
          AND (p_to_date IS NULL OR e.date <= p_to_date)), 0)               AS per_credit
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = a.id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
  ) mov ON true
  WHERE a.business_id = p_business_id
  ORDER BY a.group_name, a.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_trial_balance(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_trial_balance(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_trial_balance(uuid, date, date) TO authenticated;

-- ============================================================================
-- Correct ledger shape: brought-forward + chronological + signed running
-- ============================================================================
CREATE OR REPLACE FUNCTION get_ledger(
  p_business_id uuid,
  p_account_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  entry_date date,
  entry_number text,
  narration text,
  debit_amount numeric,
  credit_amount numeric,
  running_balance numeric,
  is_brought_forward boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct RECORD;
  v_sign int;
  v_bf numeric;
  v_running numeric;
  v_split_dr numeric(14,2);
  v_split_cr numeric(14,2);
  v_bf_date date;
  r RECORD;
BEGIN
  SELECT * INTO v_acct
  FROM accounts
  WHERE id = p_account_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found in this business';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_sign := CASE WHEN account_nature(v_acct.group_name) = 'debit' THEN 1 ELSE -1 END;

  -- Brought forward: stored opening + nature-signed posted movements before from-date
  IF p_from_date IS NULL THEN
    v_bf := COALESCE(v_acct.opening_balance, 0);
  ELSE
    SELECT COALESCE(v_acct.opening_balance, 0) + v_sign * COALESCE(sum(l.debit_amount - l.credit_amount), 0)
    INTO v_bf
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = p_account_id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date < p_from_date;
  END IF;

  -- Display split of the BF position onto raw debit/credit cells
  IF v_bf >= 0 THEN
    v_split_dr := round(v_bf, 2);
    v_split_cr := 0;
  ELSE
    v_split_dr := 0;
    v_split_cr := round(-v_bf, 2);
  END IF;

  SELECT COALESCE(min(e.date), COALESCE(p_from_date, CURRENT_DATE))
  INTO v_bf_date
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  WHERE l.account_id = p_account_id
    AND l.business_id = p_business_id
    AND e.status = 'posted';

  v_running := v_bf;

  entry_date         := v_bf_date;
  entry_number       := NULL;
  narration          := 'Brought forward';
  debit_amount       := v_split_dr;
  credit_amount      := v_split_cr;
  running_balance    := round(v_running, 2);
  is_brought_forward := true;
  RETURN NEXT;

  FOR r IN
    SELECT e.date AS e_date, e.entry_number, e.narration,
           l.debit_amount, l.credit_amount
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = p_account_id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
      AND (p_from_date IS NULL OR e.date >= p_from_date)
      AND (p_to_date IS NULL OR e.date <= p_to_date)
    ORDER BY e.date ASC, e.created_at ASC, e.id ASC
  LOOP
    v_running := v_running + v_sign * (COALESCE(r.debit_amount, 0) - COALESCE(r.credit_amount, 0));

    entry_date         := r.e_date;
    entry_number       := r.entry_number;
    narration          := r.narration;
    debit_amount       := r.debit_amount;
    credit_amount      := r.credit_amount;
    running_balance    := round(v_running, 2);
    is_brought_forward := false;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_ledger(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ledger(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_ledger(uuid, uuid, date, date) TO authenticated;

-- ============================================================================
-- Opening-balance workflow with automatic OBE counterweight (R8 fix)
-- ============================================================================
CREATE OR REPLACE FUNCTION set_account_opening_balance(
  p_business_id uuid,
  p_account_id uuid,
  p_opening_balance numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct RECORD;
  v_delta numeric(14,2);
  v_sign int;
  v_obe_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_acct
  FROM accounts
  WHERE id = p_account_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found in this business';
  END IF;

  IF v_acct.name = 'Opening Balance Equity' THEN
    RAISE EXCEPTION 'Opening Balance Equity is the counterweight account; adjust a real account instead';
  END IF;

  v_delta := round(COALESCE(p_opening_balance, 0), 2) - COALESCE(v_acct.opening_balance, 0);

  IF v_delta = 0 THEN
    RETURN COALESCE(v_acct.opening_balance, 0);
  END IF;

  v_sign := CASE WHEN account_nature(v_acct.group_name) = 'debit' THEN 1 ELSE -1 END;

  UPDATE accounts
  SET opening_balance = round(COALESCE(p_opening_balance, 0), 2),
      current_balance = round(COALESCE(current_balance, 0) + v_delta, 2)
  WHERE id = p_account_id;

  -- Counterweight moves opposite in stored terms via nature sign
  v_obe_id := find_or_create_account(p_business_id, 'Opening Balance Equity', 'Capital Account');

  UPDATE accounts
  SET opening_balance = round(COALESCE(opening_balance, 0) + v_delta * v_sign, 2),
      current_balance = round(COALESCE(current_balance, 0) + v_delta * v_sign, 2)
  WHERE id = v_obe_id;

  RETURN round(COALESCE(p_opening_balance, 0), 2);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_account_opening_balance(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_account_opening_balance(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION set_account_opening_balance(uuid, uuid, numeric) TO authenticated;
