-- ============================================================================
-- 065 — Numbering counter resync + registry-burn skip (AUTHOR-ONLY)
--
-- STATUS: authored for human review; NOT applied automatically. Apply once in
-- the Supabase SQL editor. Mirrors the PBS-79 "author, do not apply" pattern.
--
-- Root cause this heals: document_sequences.next_no can go stale relative to
-- a business's actual document rows whenever numbers enter the doc tables
-- outside the counter (seeded exports, restores, manual entries like
-- SO/26-27/1). Allocation then collides against UNIQUE(business_id, <number>)
-- on every retry and the UI surfaces "Could not allocate a unique number".
--
-- UP (in order):
-- 1. Resync every document_sequences.next_no from its real table's max
--    parsed suffix per business.
-- 2. Harden next_document_number: the document_numbers registry insert now
--    detects already-burned numbers (RETURNING stays empty on conflict) and
--    steps the sequence forward until it lands on a never-issued number,
--    instead of silently returning a duplicate noexcept. Bounded at 1000
--    steps with a descriptive failure.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Counter resync (per business, per doc type -> its real table/column)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_map text[] := ARRAY[
    'sales_invoice|sales_invoices|invoice_number',
    'purchase_bill|purchase_bills|bill_number',
    'payment_received|payments|payment_number',
    'payment_made|payments|payment_number',
    'quotation|quotations|quotation_number',
    'sales_order|sales_orders|order_number',
    'purchase_order|purchase_orders|order_number',
    'credit_note|credit_notes|credit_note_number',
    'debit_note|debit_notes|debit_note_number',
    'expense|expenses|expense_number',
    'stock_transfer|stock_transfers|transfer_number'
  ];
  v_entry text;
  v_parts text[];
BEGIN
  FOREACH v_entry IN ARRAY v_map LOOP
    v_parts := string_to_array(v_entry, '|');
    EXECUTE format(
      $sql$
      WITH parsed AS (
        SELECT business_id,
               max(substring(%I::text from '[-/](\d+)$')::bigint) AS max_no
        FROM %I
        WHERE %I IS NOT NULL
        GROUP BY business_id
      )
      INSERT INTO document_sequences (business_id, doc_type, next_no)
      SELECT p.business_id, %L, p.max_no + 1
      FROM parsed p
      WHERE p.max_no IS NOT NULL
      ON CONFLICT (business_id, doc_type)
      DO UPDATE SET next_no = GREATEST(
        document_sequences.next_no,
        EXCLUDED.next_no
      )
      $sql$,
      v_parts[3], v_parts[2], v_parts[3], v_parts[1]
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Hardened next_document_number (skip registry-burned numbers)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_document_number(
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
  v_inserted text;
  v_start bigint;
  v_steps int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  INSERT INTO document_sequences (business_id, doc_type, next_no)
  VALUES (p_business_id, p_doc_type, 2)
  ON CONFLICT (business_id, doc_type)
  DO UPDATE SET next_no = document_sequences.next_no + 1
  RETURNING next_no - 1 INTO v_seq;
  v_start := v_seq;

  v_prefix := CASE p_doc_type
    WHEN 'sales_invoice' THEN 'INV'
    WHEN 'purchase_bill' THEN 'BILL'
    WHEN 'payment_received' THEN 'RCV'
    WHEN 'payment_made' THEN 'PAY'
    WHEN 'credit_note' THEN 'CN'
    WHEN 'debit_note' THEN 'DN'
    WHEN 'expense' THEN 'EXP'
    WHEN 'quotation' THEN 'QT'
    WHEN 'sales_order' THEN 'SO'
    WHEN 'purchase_order' THEN 'PO'
    WHEN 'stock_transfer' THEN 'TRF'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  LOOP
    v_number := v_prefix || '/' || extract(year from COALESCE(p_date, CURRENT_DATE))::text
                || '/' || lpad(v_seq::text, 6, '0');

    -- A fresh registry row means this number was never issued before. An
    -- empty RETURNING means it was burned (issued but the doc save failed,
    -- or pre-registry seeding); step forward instead of handing out a dup.
    INSERT INTO document_numbers (business_id, doc_type, number)
    VALUES (p_business_id, p_doc_type, v_number)
    ON CONFLICT (business_id, doc_type, number) DO NOTHING
    RETURNING number INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      RETURN v_number;
    END IF;

    v_seq := v_seq + 1;
    v_steps := v_steps + 1;
    IF v_steps > 1000 THEN
      RAISE EXCEPTION
        'Could not allocate a unique number for % after % steps', p_doc_type, v_steps;
    END IF;

    UPDATE document_sequences
      SET next_no = GREATEST(next_no, v_seq + 1)
      WHERE business_id = p_business_id AND doc_type = p_doc_type;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION next_document_number(uuid, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_document_number(uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, date) TO authenticated;
-- ============================================================================
-- 065 END
-- ============================================================================
