-- 073 — Sync Payment Received Edit to Journal Entries, Lines, and Customer Balance
-- Ensures that editing a payment automatically updates linked journal entries, lines (Cash/Bank and Debtor), and customer balances.

CREATE OR REPLACE FUNCTION sync_payment_received_journal(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_customer_name text;
  v_cash_bank_account_id uuid;
  v_receivable_account_id uuid;
  v_cash_bank_name text;
  v_existing_id uuid;
  v_existing_entry_number text;
  v_entry_id uuid;
  v_seq int;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.type != 'received' THEN
    RAISE EXCEPTION 'This function only handles received payments';
  END IF;

  -- 1. Find existing journal entry
  SELECT id, entry_number INTO v_existing_id, v_existing_entry_number
  FROM journal_entries
  WHERE business_id = v_payment.business_id
    AND ((reference_type = 'payment_received' AND reference_id = p_payment_id)
         OR (v_payment.payment_number IS NOT NULL AND narration ILIKE '%' || v_payment.payment_number || '%'))
  ORDER BY created_at DESC
  LIMIT 1;

  -- 2. Resolve accounts
  SELECT name INTO v_customer_name FROM customers WHERE id = v_payment.party_id;
  v_cash_bank_name := CASE WHEN v_payment.payment_method = 'cash' THEN 'Cash' ELSE 'Bank' END;

  v_cash_bank_account_id := find_or_create_account(
    v_payment.business_id,
    v_cash_bank_name,
    'Cash & Bank'
  );

  v_receivable_account_id := find_or_create_account(
    v_payment.business_id,
    COALESCE(v_customer_name, 'Customer Receivable'),
    'Sundry Debtors'
  );

  -- 3. Delete existing journal entry if found (lines cascade automatically)
  IF v_existing_id IS NOT NULL THEN
    DELETE FROM journal_entries WHERE id = v_existing_id;
  END IF;

  -- 4. Determine entry number
  IF v_existing_entry_number IS NOT NULL THEN
    v_entry_id := gen_random_uuid();
    INSERT INTO journal_entries (
      id, business_id, entry_number, date, reference_type, reference_id,
      narration, total_debit, total_credit, status, created_by
    ) VALUES (
      v_entry_id, v_payment.business_id, v_existing_entry_number, v_payment.date, 'payment_received', p_payment_id,
      'Payment received ' || COALESCE(v_payment.payment_number, ''), v_payment.amount, v_payment.amount, 'posted',
      COALESCE(auth.uid(), v_payment.created_by, (SELECT owner_id FROM businesses WHERE id = v_payment.business_id LIMIT 1))
    );
  ELSE
    SELECT COALESCE(max(
      CASE
        WHEN entry_number ~ '^JE/[0-9]{4}/[0-9]+$'
          THEN substring(entry_number from '[0-9]+$')::int
        ELSE 0
      END
    ), 0) + 1
    INTO v_seq
    FROM journal_entries
    WHERE business_id = v_payment.business_id
      AND entry_number ~ ('^JE/' || extract(year from v_payment.date)::text || '/[0-9]+$');

    v_existing_entry_number := 'JE/' || extract(year from v_payment.date)::text || '/' || lpad(v_seq::text, 4, '0');

    v_entry_id := gen_random_uuid();
    INSERT INTO journal_entries (
      id, business_id, entry_number, date, reference_type, reference_id,
      narration, total_debit, total_credit, status, created_by
    ) VALUES (
      v_entry_id, v_payment.business_id, v_existing_entry_number, v_payment.date, 'payment_received', p_payment_id,
      'Payment received ' || COALESCE(v_payment.payment_number, ''), v_payment.amount, v_payment.amount, 'posted',
      COALESCE(auth.uid(), v_payment.created_by, (SELECT owner_id FROM businesses WHERE id = v_payment.business_id LIMIT 1))
    );
  END IF;

  -- 5. Insert lines atomically
  INSERT INTO journal_entry_lines (
    business_id, entry_id, account_id, account_name, debit_amount, credit_amount
  ) VALUES
    (v_payment.business_id, v_entry_id, v_cash_bank_account_id, v_cash_bank_name, v_payment.amount, 0),
    (v_payment.business_id, v_entry_id, v_receivable_account_id, COALESCE(v_customer_name, 'Customer Receivable'), 0, v_payment.amount);

  -- 6. Recalculate customer balance
  IF v_payment.party_id IS NOT NULL THEN
    UPDATE customers c
    SET current_balance = CASE
          WHEN COALESCE(c.opening_balance, 0) + COALESCE(inv.total_inv, 0) <= 0 THEN 0.00
          ELSE GREATEST(0.00, ROUND(COALESCE(c.opening_balance, 0) + COALESCE(inv.total_inv, 0) - COALESCE(pay.total_pay, 0), 2))
        END,
        total_sales = COALESCE(ROUND(inv.total_inv, 2), 0.00),
        total_paid = COALESCE(ROUND(pay.total_pay, 2), 0.00),
        last_transaction_date = NOW()
    FROM (
      SELECT COALESCE(SUM(si.grand_total), 0) AS total_inv
      FROM sales_invoices si
      WHERE si.customer_id = v_payment.party_id
        AND si.status IN ('issued', 'partially_paid', 'paid')
    ) inv
    CROSS JOIN (
      SELECT COALESCE(SUM(pm.amount), 0) AS total_pay
      FROM payments pm
      WHERE pm.party_id = v_payment.party_id
        AND pm.party_type = 'customer'
        AND pm.type = 'received'
    ) pay
    WHERE c.id = v_payment.party_id;
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_payment_received_journal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_payment_received_journal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION sync_payment_received_journal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_payment_received_journal(uuid) TO service_role;

-- Overwrite post_payment_received_journal to reuse sync logic
CREATE OR REPLACE FUNCTION post_payment_received_journal(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN sync_payment_received_journal(p_payment_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION post_payment_received_journal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_payment_received_journal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION post_payment_received_journal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION post_payment_received_journal(uuid) TO service_role;

-- Statement/Row trigger on payments table for updates
CREATE OR REPLACE FUNCTION trg_sync_payment_received_update()
RETURNS TRIGGER AS $$
DECLARE
  v_old_cust uuid;
BEGIN
  IF (OLD.amount IS DISTINCT FROM NEW.amount)
     OR (OLD.date IS DISTINCT FROM NEW.date)
     OR (OLD.payment_number IS DISTINCT FROM NEW.payment_number)
     OR (OLD.payment_method IS DISTINCT FROM NEW.payment_method)
     OR (OLD.party_id IS DISTINCT FROM NEW.party_id) THEN

    PERFORM sync_payment_received_journal(NEW.id);

    IF OLD.party_id IS NOT NULL AND OLD.party_id IS DISTINCT FROM NEW.party_id THEN
      v_old_cust := OLD.party_id;
      UPDATE customers c
      SET current_balance = CASE
            WHEN COALESCE(c.opening_balance, 0) + COALESCE(inv.total_inv, 0) <= 0 THEN 0.00
            ELSE GREATEST(0.00, ROUND(COALESCE(c.opening_balance, 0) + COALESCE(inv.total_inv, 0) - COALESCE(pay.total_pay, 0), 2))
          END,
          total_sales = COALESCE(ROUND(inv.total_inv, 2), 0.00),
          total_paid = COALESCE(ROUND(pay.total_pay, 2), 0.00),
          last_transaction_date = NOW()
      FROM (
        SELECT COALESCE(SUM(si.grand_total), 0) AS total_inv
        FROM sales_invoices si
        WHERE si.customer_id = v_old_cust
          AND si.status IN ('issued', 'partially_paid', 'paid')
      ) inv
      CROSS JOIN (
        SELECT COALESCE(SUM(pm.amount), 0) AS total_pay
        FROM payments pm
        WHERE pm.party_id = v_old_cust
          AND pm.party_type = 'customer'
          AND pm.type = 'received'
      ) pay
      WHERE c.id = v_old_cust;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_payment_received_update_sync ON payments;
CREATE TRIGGER trg_payment_received_update_sync
AFTER UPDATE ON payments
FOR EACH ROW
WHEN (NEW.type = 'received' AND NEW.party_type = 'customer')
EXECUTE FUNCTION trg_sync_payment_received_update();
