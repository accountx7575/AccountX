/*
# 021 — AR/AP aging reports + party statements (T28)

Consumes ONLY the 020 bases (v_receivables_aging_base /
v_payables_aging_base) plus payments for as-of-accurate outstanding.

CONTRACTS:

- get_receivables_aging(p_business_id, p_as_of DEFAULT CURRENT_DATE)
  RETURNS TABLE(party_id uuid, party_name text, doc_id uuid,
    doc_number text, doc_date date, due_date date, outstanding numeric,
    current numeric, days_1_30 numeric, days_31_60 numeric,
    days_61_90 numeric, days_90_plus numeric)
  One row per invoice with outstanding > 0 AS OF p_as_of. Outstanding is
  recomputed historically: grand_total - SUM(received payments dated
  <= p_as_of) — NOT the live paid_amount column, so past-date runs are
  truthful. Buckets key off days PAST DUE (0 -> 'current').
  get_payables_aging mirrors (payments type='made' via bill_id).

- get_customer_statement(p_business_id, p_customer_id,
      p_from_date DEFAULT NULL, p_to_date DEFAULT NULL)
  RETURNS TABLE(entry_date date, doc_type text, doc_number text,
    description text, debit_amount numeric, credit_amount numeric,
    running_balance numeric)
  Row 1 = 'Brought forward' (opening_balance + pre-window nets).
  Invoices (live) = DEBIT; received payments = CREDIT.
  running_balance positive == CUSTOMER OWES YOU.
  get_supplier_statement mirrors with bills = CREDIT, payments made =
  DEBIT; running_balance positive == YOU OWE SUPPLIER.
  Both statements guard that the party belongs to the business.
*/

-- ============================================================================
-- AR AGING
-- ============================================================================
CREATE OR REPLACE FUNCTION get_receivables_aging(
  p_business_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  party_id uuid,
  party_name text,
  doc_id uuid,
  doc_number text,
  doc_date date,
  due_date date,
  outstanding numeric,
  "current" numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_90_plus numeric
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
  WITH asof_outstanding AS (
    SELECT base.doc_id,
           base.party_id,
           base.party_name,
           base.doc_number,
           base.doc_date,
           base.due_date,
           GREATEST(base.grand_total - COALESCE(pp.paid_to_date, 0), 0)
             AS amt_due
    FROM v_receivables_aging_base base
    LEFT JOIN LATERAL (
      SELECT sum(pm.amount) AS paid_to_date
      FROM payments pm
      WHERE pm.invoice_id = base.doc_id
        AND pm.type = 'received'
        AND pm.date <= p_as_of
    ) pp ON true
    WHERE base.business_id = p_business_id
  )
  SELECT ao.party_id,
         ao.party_name,
         ao.doc_id,
         ao.doc_number,
         ao.doc_date,
         ao.due_date,
         round(ao.amt_due, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) = 0 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) BETWEEN 1 AND 30 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) BETWEEN 31 AND 60 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) BETWEEN 61 AND 90 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) > 90 THEN 1 ELSE 0 END, 2)
  FROM asof_outstanding ao
  WHERE ao.amt_due > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_receivables_aging(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_receivables_aging(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_receivables_aging(uuid, date) TO authenticated;

-- ============================================================================
-- AP AGING
-- ============================================================================
CREATE OR REPLACE FUNCTION get_payables_aging(
  p_business_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  party_id uuid,
  party_name text,
  doc_id uuid,
  doc_number text,
  doc_date date,
  due_date date,
  outstanding numeric,
  "current" numeric,
  days_1_30 numeric,
  days_31_60 numeric,
  days_61_90 numeric,
  days_90_plus numeric
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
  WITH asof_outstanding AS (
    SELECT base.doc_id,
           base.party_id,
           base.party_name,
           base.doc_number,
           base.doc_date,
           base.due_date,
           GREATEST(base.grand_total - COALESCE(pp.paid_to_date, 0), 0)
             AS amt_due
    FROM v_payables_aging_base base
    LEFT JOIN LATERAL (
      SELECT sum(pm.amount) AS paid_to_date
      FROM payments pm
      WHERE pm.bill_id = base.doc_id
        AND pm.type = 'made'
        AND pm.date <= p_as_of
    ) pp ON true
    WHERE base.business_id = p_business_id
  )
  SELECT ao.party_id,
         ao.party_name,
         ao.doc_id,
         ao.doc_number,
         ao.doc_date,
         ao.due_date,
         round(ao.amt_due, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) = 0 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) BETWEEN 1 AND 30 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) BETWEEN 31 AND 60 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) BETWEEN 61 AND 90 THEN 1 ELSE 0 END, 2),
         round(ao.amt_due * CASE WHEN GREATEST(p_as_of - ao.due_date, 0) > 90 THEN 1 ELSE 0 END, 2)
  FROM asof_outstanding ao
  WHERE ao.amt_due > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_payables_aging(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_payables_aging(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_payables_aging(uuid, date) TO authenticated;

-- ============================================================================
-- PARTY STATEMENTS (brought forward + chronological + signed running)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_customer_statement(
  p_business_id uuid,
  p_customer_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  entry_date date,
  doc_type text,
  doc_number text,
  description text,
  debit_amount numeric,
  credit_amount numeric,
  running_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust RECORD;
  v_bf numeric;
  v_running numeric;
  r RECORD;
BEGIN
  SELECT * INTO v_cust
  FROM customers
  WHERE id = p_customer_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found in this business';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  -- Brought forward: stored opening + pre-window net (invoices - receipts)
  SELECT COALESCE(c.opening_balance, 0)
     + COALESCE(inv.pre_dr, 0) - COALESCE(pay.pre_cr, 0)
  INTO v_bf
  FROM customers c
  LEFT JOIN LATERAL (
    SELECT sum(si.grand_total) AS pre_dr
    FROM sales_invoices si
    WHERE si.customer_id = p_customer_id
      AND si.status IN ('issued', 'partially_paid', 'paid')
      AND (p_from_date IS NULL OR si.invoice_date < p_from_date)
      AND (p_to_date IS NULL OR si.invoice_date <= p_to_date)
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT sum(pm.amount) AS pre_cr
    FROM payments pm
    WHERE pm.party_id = p_customer_id
      AND pm.party_type = 'customer'
      AND pm.type = 'received'
      AND (p_from_date IS NULL OR pm.date < p_from_date)
      AND (p_to_date IS NULL OR pm.date <= p_to_date)
  ) pay ON true
  WHERE c.id = p_customer_id;

  v_running := COALESCE(v_bf, 0);

  entry_date      := COALESCE(p_from_date, CURRENT_DATE);
  doc_type        := 'bf';
  doc_number      := NULL;
  description     := 'Brought forward';
  debit_amount    := 0;
  credit_amount   := 0;
  running_balance := round(v_running, 2);
  RETURN NEXT;

  FOR r IN
    SELECT si.invoice_date AS d, 'invoice'::text AS t,
           si.invoice_number AS n, 'Sales invoice'::text AS descr,
           si.grand_total::numeric AS dr, 0::numeric AS cr
    FROM sales_invoices si
    WHERE si.customer_id = p_customer_id
      AND si.status IN ('issued', 'partially_paid', 'paid')
      AND (p_from_date IS NULL OR si.invoice_date >= p_from_date)
      AND (p_to_date IS NULL OR si.invoice_date <= p_to_date)
    UNION ALL
    SELECT pm.date, 'payment_received', pm.payment_number,
           'Payment received', 0::numeric, pm.amount::numeric
    FROM payments pm
    WHERE pm.party_id = p_customer_id
      AND pm.party_type = 'customer'
      AND pm.type = 'received'
      AND (p_from_date IS NULL OR pm.date >= p_from_date)
      AND (p_to_date IS NULL OR pm.date <= p_to_date)
    ORDER BY d ASC, t DESC
  LOOP
    v_running := v_running + (COALESCE(r.dr, 0) - COALESCE(r.cr, 0));

    entry_date      := r.d;
    doc_type        := r.t;
    doc_number      := r.n;
    description     := r.descr;
    debit_amount    := r.dr;
    credit_amount   := r.cr;
    running_balance := round(v_running, 2);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_customer_statement(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_customer_statement(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_customer_statement(uuid, uuid, date, date) TO authenticated;

-- ============================================================================
CREATE OR REPLACE FUNCTION get_supplier_statement(
  p_business_id uuid,
  p_supplier_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  entry_date date,
  doc_type text,
  doc_number text,
  description text,
  debit_amount numeric,
  credit_amount numeric,
  running_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supp RECORD;
  v_bf numeric;
  v_running numeric;
  r RECORD;
BEGIN
  SELECT * INTO v_supp
  FROM suppliers
  WHERE id = p_supplier_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier not found in this business';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  -- Brought forward: stored opening + pre-window net (bills - payments made)
  SELECT COALESCE(s.opening_balance, 0)
     + COALESCE(bil.pre_cr, 0) - COALESCE(pay.pre_dr, 0)
  INTO v_bf
  FROM suppliers s
  LEFT JOIN LATERAL (
    SELECT sum(pb.grand_total) AS pre_cr
    FROM purchase_bills pb
    WHERE pb.supplier_id = p_supplier_id
      AND pb.status IN ('confirmed', 'partially_paid', 'paid')
      AND (p_from_date IS NULL OR pb.bill_date < p_from_date)
      AND (p_to_date IS NULL OR pb.bill_date <= p_to_date)
  ) bil ON true
  LEFT JOIN LATERAL (
    SELECT sum(pm.amount) AS pre_dr
    FROM payments pm
    WHERE pm.party_id = p_supplier_id
      AND pm.party_type = 'supplier'
      AND pm.type = 'made'
      AND (p_from_date IS NULL OR pm.date < p_from_date)
      AND (p_to_date IS NULL OR pm.date <= p_to_date)
  ) pay ON true
  WHERE s.id = p_supplier_id;

  v_running := COALESCE(v_bf, 0);

  entry_date      := COALESCE(p_from_date, CURRENT_DATE);
  doc_type        := 'bf';
  doc_number      := NULL;
  description     := 'Brought forward';
  debit_amount    := 0;
  credit_amount   := 0;
  running_balance := round(v_running, 2);
  RETURN NEXT;

  FOR r IN
    SELECT pb.bill_date AS d, 'bill'::text AS t,
           pb.bill_number AS n, 'Purchase bill'::text AS descr,
           0::numeric AS dr, pb.grand_total::numeric AS cr
    FROM purchase_bills pb
    WHERE pb.supplier_id = p_supplier_id
      AND pb.status IN ('confirmed', 'partially_paid', 'paid')
      AND (p_from_date IS NULL OR pb.bill_date >= p_from_date)
      AND (p_to_date IS NULL OR pb.bill_date <= p_to_date)
    UNION ALL
    SELECT pm.date, 'payment_made', pm.payment_number,
           'Payment made', pm.amount::numeric, 0::numeric
    FROM payments pm
    WHERE pm.party_id = p_supplier_id
      AND pm.party_type = 'supplier'
      AND pm.type = 'made'
      AND (p_from_date IS NULL OR pm.date >= p_from_date)
      AND (p_to_date IS NULL OR pm.date <= p_to_date)
    ORDER BY d ASC, t DESC
  LOOP
    -- Positive running == you owe the supplier (credits grow the balance)
    v_running := v_running + (COALESCE(r.cr, 0) - COALESCE(r.dr, 0));

    entry_date      := r.d;
    doc_type        := r.t;
    doc_number      := r.n;
    description     := r.descr;
    debit_amount    := r.dr;
    credit_amount   := r.cr;
    running_balance := round(v_running, 2);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_supplier_statement(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_supplier_statement(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_supplier_statement(uuid, uuid, date, date) TO authenticated;
