/*
# 038 — FY-lock extension to remaining transactional paths (T64 rider)

035 gated journal_entries / sales_invoices / purchase_bills. This closes
the remaining dated-document paths so a closed fiscal year cannot gain
new or edited documents anywhere:

  payments(date)            - received AND made share one table
  expenses(date)
  credit_notes(date) / debit_notes(date)
  quotations(quote_date)
  sales_orders(order_date) / purchase_orders(order_date)

Stock adjustments need no new gate: their accounting truth is a journal
entry, already gated by 035.

Implementation: ONE generic BEFORE trigger function reading the date
column name from TG_ARGV[0] and the value via to_jsonb(NEW) - same
closed-year semantics as 035 (un-reopened close for that label, Apr-Mar
bounds, unparsable labels stay open). Expiry/expected/due dates are NOT
gated: they are planning metadata, not books of account.
*/

CREATE OR REPLACE FUNCTION enforce_fy_lock_generic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_label text;
  r_bounds RECORD;
  v_date text;
BEGIN
  v_date := to_jsonb(NEW) ->> v_col;
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT financial_year INTO v_label FROM businesses WHERE id = to_jsonb(NEW) ->> 'business_id';
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_date::date >= r_bounds.fy_start AND v_date::date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = (to_jsonb(NEW) ->> 'business_id')::uuid
        AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - documents dated % through % cannot be created or edited here',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fy_lock_payments ON payments;
CREATE TRIGGER trg_fy_lock_payments
BEFORE INSERT OR UPDATE OF date ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_expenses ON expenses;
CREATE TRIGGER trg_fy_lock_expenses
BEFORE INSERT OR UPDATE OF date ON expenses
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_credit_notes ON credit_notes;
CREATE TRIGGER trg_fy_lock_credit_notes
BEFORE INSERT OR UPDATE OF date ON credit_notes
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_debit_notes ON debit_notes;
CREATE TRIGGER trg_fy_lock_debit_notes
BEFORE INSERT OR UPDATE OF date ON debit_notes
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_quotations ON quotations;
CREATE TRIGGER trg_fy_lock_quotations
BEFORE INSERT OR UPDATE OF quote_date ON quotations
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('quote_date');

DROP TRIGGER IF EXISTS trg_fy_lock_sales_orders ON sales_orders;
CREATE TRIGGER trg_fy_lock_sales_orders
BEFORE INSERT OR UPDATE OF order_date ON sales_orders
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('order_date');

DROP TRIGGER IF EXISTS trg_fy_lock_purchase_orders ON purchase_orders;
CREATE TRIGGER trg_fy_lock_purchase_orders
BEFORE INSERT OR UPDATE OF order_date ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('order_date');
