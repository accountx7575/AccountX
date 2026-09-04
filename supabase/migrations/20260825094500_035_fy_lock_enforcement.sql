/*
# 035 — Fiscal year lock enforcement (T60 item 3)

027 provides close/reopen but NOTHING blocks backdated documents into a
closed year. This migration adds minimal enforcement WITHOUT editing any
existing migration: BEFORE triggers at the date-validation point of the
three core transactional paths (m017's save targets).

Semantics: while an UN-reopened close exists for label L, new/edited
documents dated INSIDE L's bounds are rejected. Open years unaffected.
Bounds derive from businesses.financial_year labels of the form
'FY 2025-26' / 'FY 2025-2026' (Apr 1 - Mar 31, Indian FY). Unparsable
labels are skipped open — never false-block real work.

SCOPE HONESTY: journal_entries + sales_invoices + purchase_bills only.
CN/DN/QT/SO/PO date paths and direct client INSERTs to those tables
(where policies allow) are NOT yet gated; noted as gap in T60 report.
*/

CREATE OR REPLACE FUNCTION fy_label_bounds(p_label text)
RETURNS table(fy_start date, fy_end date)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_m1 text;
  v_m2 text;
  y1 int;
  y2 int;
BEGIN
  v_m1 := substring(p_label from '\d{4}-(\d{2,4})');
  v_m2 := substring(p_label from '(\d{4})');
  IF v_m1 IS NULL OR v_m2 IS NULL THEN
    RETURN;
  END IF;
  y1 := v_m2::int;
  IF length(v_m1) = 4 THEN
    y2 := v_m1::int;
  ELSE
    y2 := (y1 / 100 * 100) + v_m1::int;
    IF y2 <= y1 THEN
      y2 := y2 + 100;
    END IF;
  END IF;
  IF y2 <> y1 + 1 THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT make_date(y1, 4, 1), make_date(y2, 3, 31);
END;
$$;

CREATE OR REPLACE FUNCTION enforce_fy_lock_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  r_bounds RECORD;
BEGIN
  -- System-generated close/reopen journals must never self-block (027 dates them CURRENT_DATE)
  IF NEW.reference_type IN ('fiscal_close', 'fiscal_reopen') THEN
    RETURN NEW;
  END IF;

  SELECT financial_year INTO v_label FROM businesses WHERE id = NEW.business_id;
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.date >= r_bounds.fy_start AND NEW.date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = NEW.business_id AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - documents dated % through % cannot be created or edited',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_fy_lock_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  r_bounds RECORD;
BEGIN
  SELECT financial_year INTO v_label FROM businesses WHERE id = NEW.business_id;
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.invoice_date >= r_bounds.fy_start AND NEW.invoice_date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = NEW.business_id AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - invoices dated % through % cannot be created or edited',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_fy_lock_bill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  r_bounds RECORD;
BEGIN
  SELECT financial_year INTO v_label FROM businesses WHERE id = NEW.business_id;
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.bill_date >= r_bounds.fy_start AND NEW.bill_date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = NEW.business_id AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - bills dated % through % cannot be created or edited',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fy_lock_journal ON journal_entries;
CREATE TRIGGER trg_fy_lock_journal
BEFORE INSERT OR UPDATE OF date ON journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_journal();

DROP TRIGGER IF EXISTS trg_fy_lock_invoices ON sales_invoices;
CREATE TRIGGER trg_fy_lock_invoices
BEFORE INSERT OR UPDATE OF invoice_date ON sales_invoices
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_invoice();

DROP TRIGGER IF EXISTS trg_fy_lock_bills ON purchase_bills;
CREATE TRIGGER trg_fy_lock_bills
BEFORE INSERT OR UPDATE OF bill_date ON purchase_bills
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_bill();
