/*
# 014 — Accounting engine hardening (T11)

Closes audit risks R1-R4. Fixes only; behaviour preserved for valid flows.

## R1 — cross-business account validation
post_journal_entry now resolves every line account with
`WHERE id = ? AND business_id = p_business_id` and raises when missing.
Members of two businesses can no longer post lines against another
business's accounts (previously corrupted their current_balance and leaked
names into lines).

## R2 — table-level double-entry enforcement + DML lockdown
- Six RLS policies removed (insert/update/delete on journal_entries and
  journal_entry_lines). Clients keep SELECT; writes go through the
  SECURITY DEFINER RPCs which bypass RLS — the RPC path becomes the only
  door.
- Statement-level AFTER triggers on journal_entry_lines (insert / update /
  delete, transition tables) verify every affected entry satisfies
  sum(debit)=sum(credit) and total != 0. Defence in depth for definer-side
  bugs and future code paths.
- NOTE: post_journal_entry is reworked to bulk-insert its lines in ONE
  statement so the insert trigger validates the COMPLETE entry, not a
  half-posted intermediate state.

## R3 — race-free entry numbering
max()+1 numbering now runs under pg_advisory_xact_lock keyed by
(business_id, financial year), serialising concurrent postings per
business-year. Keeps the existing JE/YYYY/NNNN format and UNIQUE
constraint as backstop. Proper per-doc-type sequences arrive with T13.

## R4 — status guards on document posting wrappers
post_sales_invoice_journal / post_purchase_bill_journal (as delivered in
013b, cess+round_off intact) now accept ONLY live documents:
sales 'issued'/'partially_paid'/'paid', purchase 'confirmed'/
'partially_paid'/'paid' (schema reality per master §J2 ENUM REALITY —
no 'posted' value exists yet; normalisation is future work). Draft,
cancelled and void documents are rejected with explicit messages, closing
the re-post-after-cancel hole.

Untaxed/valid flows behave exactly as before. Statics: paired $$ bodies,
balanced IF/END IF throughout.
*/

-- ============================================================================
-- R2a — revoke direct client DML on journal tables (RPCs become the only door)
-- ============================================================================
DROP POLICY IF EXISTS "journal_entries_insert" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entries_update" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entries_delete" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entry_lines_insert" ON public.journal_entry_lines;
DROP POLICY IF EXISTS "journal_entry_lines_update" ON public.journal_entry_lines;
DROP POLICY IF EXISTS "journal_entry_lines_delete" ON public.journal_entry_lines;

-- ============================================================================
-- R2b — shared checker: every listed entry must be balanced and non-zero
-- ============================================================================
CREATE OR REPLACE FUNCTION assert_journal_entries_balanced(p_entry_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF cardinality(p_entry_ids) = 0 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT e.id,
           round(COALESCE(sum(l.debit_amount), 0), 2)  AS tot_dr,
           round(COALESCE(sum(l.credit_amount), 0), 2) AS tot_cr
    FROM journal_entries e
    LEFT JOIN journal_entry_lines l ON l.entry_id = e.id
    WHERE e.id = ANY (p_entry_ids)
    GROUP BY e.id
  LOOP
    IF r.tot_dr <> r.tot_cr THEN
      RAISE EXCEPTION 'Journal entry % is not balanced: debit % != credit %',
        r.id, r.tot_dr, r.tot_cr;
    END IF;
    IF r.tot_dr = 0 THEN
      RAISE EXCEPTION 'Journal entry % has no lines or a zero total', r.id;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION assert_journal_entries_balanced(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_journal_entries_balanced(uuid[]) FROM anon;

-- ============================================================================
-- R2c — statement-level enforcement triggers (transition tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_lines_balance_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_journal_entries_balanced(
    ARRAY(SELECT DISTINCT entry_id FROM new_lines)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_lines_balance_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_journal_entries_balanced(
    ARRAY(SELECT DISTINCT entry_id FROM (
      SELECT entry_id FROM new_lines
      UNION
      SELECT entry_id FROM old_lines
    ) s)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_lines_balance_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_journal_entries_balanced(
    ARRAY(SELECT DISTINCT entry_id FROM old_lines)
  );
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_update() FROM anon;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_delete() FROM anon;

DROP TRIGGER IF EXISTS trg_lines_balance_ins ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS trg_lines_balance_upd ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS trg_lines_balance_del ON public.journal_entry_lines;

CREATE TRIGGER trg_lines_balance_ins
  AFTER INSERT ON public.journal_entry_lines
  REFERENCING NEW TABLE AS new_lines
  FOR EACH STATEMENT EXECUTE FUNCTION trg_lines_balance_on_insert();

CREATE TRIGGER trg_lines_balance_upd
  AFTER UPDATE ON public.journal_entry_lines
  REFERENCING OLD TABLE AS old_lines NEW TABLE AS new_lines
  FOR EACH STATEMENT EXECUTE FUNCTION trg_lines_balance_on_update();

CREATE TRIGGER trg_lines_balance_del
  AFTER DELETE ON public.journal_entry_lines
  REFERENCING OLD TABLE AS old_lines
  FOR EACH STATEMENT EXECUTE FUNCTION trg_lines_balance_on_delete();

-- ============================================================================
-- R1 + R3 + R2 — hardened post_journal_entry
--   (bulk line insert so the balance trigger sees the whole entry;
--    business-scoped account resolution; advisory-locked numbering)
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
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_movement numeric(14,2);
  v_mov RECORD;
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

    -- R1: account must belong to THIS business
    IF NOT EXISTS (
      SELECT 1 FROM accounts
      WHERE id = v_account_id AND business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'Account % does not belong to this business', v_account_id;
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

  -- R3: serialise number generation per business + year
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || extract(year from p_date)::text, 42)
  );

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

  -- Bulk-insert lines (single statement -> balance trigger sees full entry).
  -- R1 enforced again by the INNER JOIN: foreign accounts cannot slip in.
  INSERT INTO journal_entry_lines (
    business_id, entry_id, account_id, account_name,
    debit_amount, credit_amount
  )
  SELECT
    p_business_id,
    v_entry_id,
    a.id,
    a.name,
    COALESCE((ln->>'debit_amount')::numeric, 0),
    COALESCE((ln->>'credit_amount')::numeric, 0)
  FROM jsonb_array_elements(p_lines) AS ln
  JOIN accounts a
    ON a.id = (ln->>'account_id')::uuid
   AND a.business_id = p_business_id;

  -- Apply net movements per account
  FOR v_mov IN
    WITH mov_lines AS (
      SELECT
        (ln->>'account_id')::uuid AS account_id,
        COALESCE((ln->>'debit_amount')::numeric, 0)  AS dr,
        COALESCE((ln->>'credit_amount')::numeric, 0) AS cr
      FROM jsonb_array_elements(p_lines) AS ln
    )
    SELECT ml.account_id,
           SUM(CASE WHEN account_nature(a.group_name) = 'debit'
                    THEN ml.dr - ml.cr
                    ELSE ml.cr - ml.dr END)::numeric(14,2) AS mov
    FROM mov_lines ml
    JOIN accounts a ON a.id = ml.account_id
    GROUP BY ml.account_id
  LOOP
    UPDATE accounts
    SET current_balance = round(COALESCE(current_balance, 0) + v_mov.mov, 2)
    WHERE id = v_mov.account_id;
  END LOOP;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_journal_entry FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_journal_entry FROM anon;
GRANT EXECUTE ON FUNCTION post_journal_entry TO authenticated;

-- ============================================================================
-- R4 — posting wrappers reject anything but live documents
--      (bodies identical to 013b delivery except the status guard)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_customer_name text;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_gst RECORD;
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- R4: only live documents may receive their original journal
  IF v_invoice.status NOT IN ('issued', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'Cannot post journal for invoice in status %', v_invoice.status;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_invoice.customer_id;

  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id, v_customer_name, 'Sundry Debtors'
  );
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id, 'Sales', 'Direct Income'
  );

  v_total_tax := COALESCE(v_invoice.cgst_amount, 0) + COALESCE(v_invoice.sgst_amount, 0) + COALESCE(v_invoice.igst_amount, 0);

  -- Build journal lines: debit receivable (full grand_total), credit sales (taxable) + GST
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_receivable_account_id,
      'debit_amount', v_invoice.grand_total,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_sales_account_id,
      'debit_amount', 0,
      'credit_amount', v_invoice.taxable_amount
    )
  );

  -- Add GST lines only if there is GST
  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_invoice.business_id);

    IF COALESCE(v_invoice.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_cgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.cgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_sgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.sgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_igst,
          'debit_amount', 0,
          'credit_amount', v_invoice.igst_amount
        )
      );
    END IF;
  END IF;

  -- Cess liability line (group home legalised by 013a)
  IF COALESCE(v_invoice.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_invoice.business_id, 'Output Cess', 'GST Payable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', 0,
        'credit_amount', v_invoice.cess_amount
      )
    );
  END IF;

  -- Rounding plug: credit when positive, debit |amount| when negative
  IF COALESCE(v_invoice.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_invoice.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_invoice.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', v_invoice.round_off
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', abs(v_invoice.round_off),
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

CREATE OR REPLACE FUNCTION post_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_supplier_name text;
  v_payable_account_id uuid;
  v_purchase_account_id uuid;
  v_gst RECORD;
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  -- R4: only live documents may receive their original journal
  IF v_bill.status NOT IN ('confirmed', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'Cannot post journal for bill in status %', v_bill.status;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_bill.supplier_id;

  v_payable_account_id := find_or_create_account(
    v_bill.business_id, v_supplier_name, 'Sundry Creditors'
  );
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id, 'Purchases', 'Direct Expense'
  );

  v_total_tax := COALESCE(v_bill.cgst_amount, 0) + COALESCE(v_bill.sgst_amount, 0) + COALESCE(v_bill.igst_amount, 0);

  -- Build journal lines: debit purchases (taxable) + GST input, credit payable (full grand_total)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_purchase_account_id,
      'debit_amount', v_bill.taxable_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_payable_account_id,
      'debit_amount', 0,
      'credit_amount', v_bill.grand_total
    )
  );

  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_bill.business_id);

    IF COALESCE(v_bill.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_cgst,
          'debit_amount', v_bill.cgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_sgst,
          'debit_amount', v_bill.sgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_igst,
          'debit_amount', v_bill.igst_amount,
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  -- Input cess asset line (group home legalised by 013a)
  IF COALESCE(v_bill.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_bill.business_id, 'Input Cess', 'GST Receivable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', v_bill.cess_amount,
        'credit_amount', 0
      )
    );
  END IF;

  -- Rounding plug (mirror of sales): debit when positive, credit |amount|
  IF COALESCE(v_bill.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_bill.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_bill.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', v_bill.round_off,
          'credit_amount', 0
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', abs(v_bill.round_off)
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;
