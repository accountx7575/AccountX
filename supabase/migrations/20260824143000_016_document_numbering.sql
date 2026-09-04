/*
# 016 — Document numbering service (T13, arbitration §J3)

Per-business, per-doc-type atomic sequences behind a SECURITY DEFINER RPC.
Retires client-side Date.now() slicing (SalesInvoiceCreatePage.tsx:165,
PaymentsReceivedPage.tsx:77, PaymentsMadePage.tsx:69) once Stanley rewires
flows onto these RPCs (T15).

## Design
- document_sequences: counter row per (business_id, doc_type). Allocation
  is a single INSERT..ON CONFLICT DO UPDATE ... RETURNING — Postgres row
  locking makes concurrent calls strictly serial and gap-free per row.
- document_numbers: registry of every issued number with
  UNIQUE(business_id, doc_type, number) per arbitration. Explicitly
  supplied numbers (legacy clients mid-transition) hit this UNIQUE and
  fail loudly instead of colliding silently.
- Formats (year label taken from p_date, cosmetic; counters do NOT reset
  per year — continuous, audit-friendly):
    sales_invoice      INV/<YYYY>/NNNNNN
    purchase_bill      BILL/<YYYY>/NNNNNN
    payment_received   RCV/<YYYY>/NNNNNN   (matches client convention)
    payment_made       PAY/<YYYY>/NNNNNN   (matches client convention)
- Journal entries keep their 014 advisory-locked JE/YYYY/NNNN scheme;
  migrating them onto this service is deliberately deferred (your call
  was mine to make: the advisory lock works and a format migration would
  churn every ledger view for zero correctness gain today).
*/

CREATE TABLE IF NOT EXISTS public.document_sequences (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('sales_invoice','purchase_bill','payment_received','payment_made')),
  next_no bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (business_id, doc_type)
);

CREATE TABLE IF NOT EXISTS public.document_numbers (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  number text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT document_numbers_unique UNIQUE (business_id, doc_type, number)
);

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_numbers_select" ON public.document_numbers;
CREATE POLICY "document_numbers_select" ON public.document_numbers
  FOR SELECT TO authenticated USING (is_business_member(business_id));

-- No insert/update/delete policies: writes happen only inside
-- SECURITY DEFINER code (this function, transactional save RPCs).

CREATE OR REPLACE FUNCTION next_document_number(
  p_business_id uuid,
  p_doc_type text,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_prefix text;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Atomically claim the next number for this (business, doc_type):
  -- inserts the counter row on first use, otherwise increments in place.
  INSERT INTO document_sequences (business_id, doc_type, next_no)
  VALUES (p_business_id, p_doc_type, 2)
  ON CONFLICT (business_id, doc_type)
  DO UPDATE SET next_no = document_sequences.next_no + 1
  RETURNING next_no - 1 INTO v_seq;

  v_prefix := CASE p_doc_type
    WHEN 'sales_invoice' THEN 'INV'
    WHEN 'purchase_bill' THEN 'BILL'
    WHEN 'payment_received' THEN 'RCV'
    WHEN 'payment_made' THEN 'PAY'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  v_number := v_prefix || '/' || extract(year from COALESCE(p_date, CURRENT_DATE))::text
              || '/' || lpad(v_seq::text, 6, '0');

  -- Registry backstop: impossible from the counter path, fatal for
  -- explicitly-supplied duplicates elsewhere.
  INSERT INTO document_numbers (business_id, doc_type, number)
  VALUES (p_business_id, p_doc_type, v_number)
  ON CONFLICT (business_id, doc_type, number) DO NOTHING;

  RETURN v_number;
END;
$$;

REVOKE EXECUTE ON FUNCTION next_document_number(uuid, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_document_number(uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, date) TO authenticated;

-- Helper used by save RPCs: register an EXPLICITLY supplied number so the
-- UNIQUE(business_id, doc_type, number) contract also covers legacy paths.
CREATE OR REPLACE FUNCTION register_document_number(
  p_business_id uuid,
  p_doc_type text,
  p_number text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_number IS NULL OR btrim(p_number) = '' THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO document_numbers (business_id, doc_type, number)
    VALUES (p_business_id, p_doc_type, btrim(p_number));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Document number % already used in this business', p_number;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION register_document_number(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_document_number(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION register_document_number(uuid, text, text) TO authenticated;
