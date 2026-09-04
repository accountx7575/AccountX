/*
# 030 — Draft lifecycle for documents (T47)

1. create_sales_invoice / create_purchase_bill EXTENDED with an appended
   p_status parameter (DEFAULT 'issued' / 'confirmed' -> existing 3-arg
   callers unaffected; 4-arg overload carries the new signature). Accepted
   values: the live default, or 'draft'.
   DRAFTS ARE PAPERWORK, NOT EVENTS (J2): the draft branch skips stock
   movements AND journal posting entirely; status/payment/balance columns
   are stored identically so promotion is purely additive.
   NUMBERING POLICY (deviation from 'placeholder' idea, documented):
   numbers are assigned AT CREATION even for drafts — invoice_number/
   bill_number are NOT NULL and registry-backed, and placeholder states
   would need nullable-UNIQUE gymnastics. A hard-deleted draft burns its
   number (registry keeps it) — accepted, serial counters tolerate gaps.
2. issue_document(biz, doc_type, doc_id) RETURNS uuid (JE id): promotes
   draft -> issued/confirmed. Applies EXACTLY what the save path applies
   at live time: per-item product RMW stock movements ('sale' -qty /
   'purchase' +qty) then post_*_journal wrapper, flips status. Guards:
   doc must belong to biz, must BE draft (strict RAISE if already live —
   explicit idempotency refusal per dispatch), >=1 item required.
3. cancel_draft(biz, doc_type, doc_id): HARD DELETE allowed only from
   draft — nothing was ever posted, so no cancellation JEs are needed
   (J2-legal simplicity). Anything else RAISES pointing at the proper
   cancel RPC. Items go via ON DELETE CASCADE.
4. LEGACY-DRAFT POLICY (documented, NON-destructive): m001 defaulted new
   rows to 'draft', so pre-017 client-era rows may exist as drafts. They
   are FIRST-CLASS: promotable via issue_document, deletable via
   cancel_draft. NO cleanup statement runs — deleting user financial
   paperwork autonomously is wrong. Stanley surfaces them honestly via
   v_draft_documents (security_invoker view, both doc kinds) and badges
   by status in lists.

All functions SECURITY DEFINER, pinned search_path, hardened grants.
*/

-- ============================================================================
-- 1a. Extended save: sales invoice (live + draft)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_sales_invoice(
  p_business_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_status text DEFAULT 'issued'
)
RETURNS TABLE (invoice_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_number text;
  v_invoice_id uuid;
  v_je_id uuid;
  v_item jsonb;
  v_pid uuid;
  v_stock numeric;
  v_bal numeric;
  v_qty numeric;
  v_grand_total numeric;
  v_is_draft boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invoice must have at least one item';
  END IF;

  IF p_status NOT IN ('issued', 'draft') OR COALESCE(p_invoice->>'status', p_status) NOT IN ('issued', 'draft') THEN
    RAISE EXCEPTION 'Only statuses ''issued'' and ''draft'' are supported by this RPC';
  END IF;

  v_is_draft := (p_status = 'draft') OR (COALESCE(p_invoice->>'status', p_status) = 'draft');

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_name', '') = '' THEN
      RAISE EXCEPTION 'Every item needs a product name';
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % needs a positive quantity', v_item->>'product_name';
    END IF;
  END LOOP;

  v_grand_total := COALESCE((p_invoice->>'grand_total')::numeric, 0);

  v_invoice_number := COALESCE(
    nullif(btrim(COALESCE(p_invoice->>'invoice_number', '')), ''),
    next_document_number(p_business_id, 'sales_invoice', COALESCE((p_invoice->>'invoice_date')::date, CURRENT_DATE))
  );
  IF p_invoice->>'invoice_number' IS NOT NULL AND nullif(btrim(p_invoice->>'invoice_number'), '') IS NOT NULL THEN
    PERFORM register_document_number(p_business_id, 'sales_invoice', v_invoice_number);
  END IF;

  INSERT INTO sales_invoices (
    business_id, customer_id, invoice_number, invoice_date, due_date,
    place_of_supply, subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount, round_off,
    grand_total, paid_amount, balance_amount, payment_status, status,
    payment_method, notes, terms, created_by
  ) VALUES (
    p_business_id,
    (p_invoice->>'customer_id')::uuid,
    v_invoice_number,
    COALESCE((p_invoice->>'invoice_date')::date, CURRENT_DATE),
    (p_invoice->>'due_date')::date,
    p_invoice->>'place_of_supply',
    COALESCE((p_invoice->>'subtotal')::numeric, 0),
    COALESCE((p_invoice->>'discount_amount')::numeric, 0),
    COALESCE((p_invoice->>'taxable_amount')::numeric, 0),
    COALESCE((p_invoice->>'cgst_amount')::numeric, 0),
    COALESCE((p_invoice->>'sgst_amount')::numeric, 0),
    COALESCE((p_invoice->>'igst_amount')::numeric, 0),
    COALESCE((p_invoice->>'cess_amount')::numeric, 0),
    COALESCE((p_invoice->>'round_off')::numeric, 0),
    v_grand_total,
    0,
    v_grand_total,
    'unpaid',
    CASE WHEN v_is_draft THEN 'draft' ELSE 'issued' END,
    nullif(p_invoice->>'payment_method', ''),
    nullif(p_invoice->>'notes', ''),
    nullif(p_invoice->>'terms', ''),
    auth.uid()
  )
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    INSERT INTO sales_invoice_items (
      business_id, invoice_id, product_id, product_name, hsn_sac,
      quantity, unit, rate, discount_amount, tax_rate, taxable_amount,
      cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount
    ) VALUES (
      p_business_id,
      v_invoice_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      nullif(v_item->>'hsn_sac', ''),
      (v_item->>'quantity')::numeric,
      COALESCE(nullif(v_item->>'unit', ''), 'PCS'),
      COALESCE((v_item->>'rate')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE((v_item->>'tax_rate')::numeric, 0),
      COALESCE((v_item->>'taxable_amount')::numeric, 0),
      COALESCE((v_item->>'cgst_amount')::numeric, 0),
      COALESCE((v_item->>'sgst_amount')::numeric, 0),
      COALESCE((v_item->>'igst_amount')::numeric, 0),
      COALESCE((v_item->>'cess_amount')::numeric, 0),
      COALESCE((v_item->>'total_amount')::numeric, 0)
    );

    -- Stock is an EVENT: skipped entirely for drafts
    IF NOT v_is_draft THEN
      v_pid := (v_item->>'product_id')::uuid;
      IF v_pid IS NOT NULL THEN
        SELECT current_stock INTO v_stock
        FROM products
        WHERE id = v_pid AND business_id = p_business_id AND type = 'product'
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Product % not found in this business', COALESCE(v_item->>'product_name', v_pid::text);
        END IF;

        v_qty := (v_item->>'quantity')::numeric;

        UPDATE products
        SET current_stock = round(current_stock - v_qty, 2)
        WHERE id = v_pid
        RETURNING current_stock INTO v_bal;

        INSERT INTO stock_movements (
          business_id, product_id, type, quantity, balance_after,
          reference_type, reference_id, notes, created_by
        ) VALUES (
          p_business_id, v_pid, 'sale', -v_qty, v_bal,
          'sales_invoice', v_invoice_id, 'Invoice ' || v_invoice_number, auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p_business_id, auth.uid(), 'invoice_created', 'sales_invoice', v_invoice_id,
    CASE WHEN v_is_draft THEN 'Invoice ' || v_invoice_number || ' saved as DRAFT'
         ELSE 'Invoice ' || v_invoice_number || ' created via transactional RPC' END
  );

  -- Journal is an EVENT: drafts post nothing
  IF v_is_draft THEN
    v_je_id := NULL;
  ELSE
    v_je_id := post_sales_invoice_journal(v_invoice_id);
  END IF;

  RETURN QUERY SELECT v_invoice_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb, text) TO authenticated;

-- Backwards-compatible overload: legacy 3-arg callers keep working
CREATE OR REPLACE FUNCTION create_sales_invoice(
  p_business_id uuid,
  p_invoice jsonb,
  p_items jsonb
)
RETURNS TABLE (invoice_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM create_sales_invoice(p_business_id, p_invoice, p_items, 'issued');
END;
$$;

REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- 1b. Extended save: purchase bill (live + draft)
-- ============================================================================
CREATE OR REPLACE FUNCTION create_purchase_bill(
  p_business_id uuid,
  p_bill jsonb,
  p_items jsonb,
  p_status text DEFAULT 'confirmed'
)
RETURNS TABLE (bill_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_number text;
  v_bill_id uuid;
  v_je_id uuid;
  v_item jsonb;
  v_pid uuid;
  v_stock numeric;
  v_bal numeric;
  v_qty numeric;
  v_grand_total numeric;
  v_is_draft boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one item';
  END IF;

  IF p_status NOT IN ('confirmed', 'draft') OR COALESCE(p_bill->>'status', p_status) NOT IN ('confirmed', 'draft') THEN
    RAISE EXCEPTION 'Only statuses ''confirmed'' and ''draft'' are supported by this RPC';
  END IF;

  v_is_draft := (p_status = 'draft') OR (COALESCE(p_bill->>'status', p_status) = 'draft');

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_name', '') = '' THEN
      RAISE EXCEPTION 'Every item needs a product name';
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % needs a positive quantity', v_item->>'product_name';
    END IF;
  END LOOP;

  v_grand_total := COALESCE((p_bill->>'grand_total')::numeric, 0);

  v_bill_number := COALESCE(
    nullif(btrim(COALESCE(p_bill->>'bill_number', '')), ''),
    next_document_number(p_business_id, 'purchase_bill', COALESCE((p_bill->>'bill_date')::date, CURRENT_DATE))
  );
  IF p_bill->>'bill_number' IS NOT NULL AND nullif(btrim(p_bill->>'bill_number'), '') IS NOT NULL THEN
    PERFORM register_document_number(p_business_id, 'purchase_bill', v_bill_number);
  END IF;

  INSERT INTO purchase_bills (
    business_id, supplier_id, bill_number, bill_date, due_date,
    subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount, round_off,
    grand_total, paid_amount, balance_amount, payment_status, status,
    payment_method, notes, created_by
  ) VALUES (
    p_business_id,
    (p_bill->>'supplier_id')::uuid,
    v_bill_number,
    COALESCE((p_bill->>'bill_date')::date, CURRENT_DATE),
    (p_bill->>'due_date')::date,
    COALESCE((p_bill->>'subtotal')::numeric, 0),
    COALESCE((p_bill->>'discount_amount')::numeric, 0),
    COALESCE((p_bill->>'taxable_amount')::numeric, 0),
    COALESCE((p_bill->>'cgst_amount')::numeric, 0),
    COALESCE((p_bill->>'sgst_amount')::numeric, 0),
    COALESCE((p_bill->>'igst_amount')::numeric, 0),
    COALESCE((p_bill->>'cess_amount')::numeric, 0),
    COALESCE((p_bill->>'round_off')::numeric, 0),
    v_grand_total,
    0,
    v_grand_total,
    'unpaid',
    CASE WHEN v_is_draft THEN 'draft' ELSE 'confirmed' END,
    nullif(p_bill->>'payment_method', ''),
    nullif(p_bill->>'notes', ''),
    auth.uid()
  )
  RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    INSERT INTO purchase_bill_items (
      business_id, bill_id, product_id, product_name, hsn_sac,
      quantity, unit, rate, discount_amount, tax_rate, taxable_amount,
      cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount
    ) VALUES (
      p_business_id,
      v_bill_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      nullif(v_item->>'hsn_sac', ''),
      (v_item->>'quantity')::numeric,
      COALESCE(nullif(v_item->>'unit', ''), 'PCS'),
      COALESCE((v_item->>'rate')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE((v_item->>'tax_rate')::numeric, 0),
      COALESCE((v_item->>'taxable_amount')::numeric, 0),
      COALESCE((v_item->>'cgst_amount')::numeric, 0),
      COALESCE((v_item->>'sgst_amount')::numeric, 0),
      COALESCE((v_item->>'igst_amount')::numeric, 0),
      COALESCE((v_item->>'cess_amount')::numeric, 0),
      COALESCE((v_item->>'total_amount')::numeric, 0)
    );

    IF NOT v_is_draft THEN
      v_pid := (v_item->>'product_id')::uuid;
      IF v_pid IS NOT NULL THEN
        SELECT current_stock INTO v_stock
        FROM products
        WHERE id = v_pid AND business_id = p_business_id AND type = 'product'
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Product % not found in this business', COALESCE(v_item->>'product_name', v_pid::text);
        END IF;

        v_qty := (v_item->>'quantity')::numeric;

        UPDATE products
        SET current_stock = round(current_stock + v_qty, 2)
        WHERE id = v_pid
        RETURNING current_stock INTO v_bal;

        INSERT INTO stock_movements (
          business_id, product_id, type, quantity, balance_after,
          reference_type, reference_id, notes, created_by
        ) VALUES (
          p_business_id, v_pid, 'purchase', v_qty, v_bal,
          'purchase_bill', v_bill_id, 'Bill ' || v_bill_number, auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p_business_id, auth.uid(), 'bill_created', 'purchase_bill', v_bill_id,
    CASE WHEN v_is_draft THEN 'Bill ' || v_bill_number || ' saved as DRAFT'
         ELSE 'Bill ' || v_bill_number || ' created via transactional RPC' END
  );

  IF v_is_draft THEN
    v_je_id := NULL;
  ELSE
    v_je_id := post_purchase_bill_journal(v_bill_id);
  END IF;

  RETURN QUERY SELECT v_bill_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION create_purchase_bill(
  p_business_id uuid,
  p_bill jsonb,
  p_items jsonb
)
RETURNS TABLE (bill_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM create_purchase_bill(p_business_id, p_bill, p_items, 'confirmed');
END;
$$;

REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- 2. Promotion: draft -> live (applies events at promotion time)
-- ============================================================================
CREATE OR REPLACE FUNCTION issue_document(
  p_business_id uuid,
  p_doc_type text,
  p_doc_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
  v_item RECORD;
  v_je uuid;
  v_bal numeric;
  v_qty numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_doc_type NOT IN ('sales_invoice', 'purchase_bill') THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  IF p_doc_type = 'sales_invoice' THEN
    SELECT * INTO v_doc FROM sales_invoices
    WHERE id = p_doc_id AND business_id = p_business_id FOR UPDATE;
  ELSE
    SELECT * INTO v_doc FROM purchase_bills
    WHERE id = p_doc_id AND business_id = p_business_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found in this business';
  END IF;

  IF v_doc.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft documents can be issued; document is already %', v_doc.status;
  END IF;

  IF p_doc_type = 'sales_invoice' THEN
    IF NOT EXISTS (SELECT 1 FROM sales_invoice_items WHERE invoice_id = p_doc_id) THEN
      RAISE EXCEPTION 'Document has no lines';
    END IF;

    FOR v_item IN
      SELECT product_id, quantity FROM sales_invoice_items
      WHERE invoice_id = p_doc_id AND product_id IS NOT NULL
    LOOP
      SELECT current_stock INTO v_bal
      FROM products
      WHERE id = v_item.product_id AND business_id = p_business_id AND type = 'product'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in this business', v_item.product_id;
      END IF;

      v_qty := v_item.quantity;

      UPDATE products
      SET current_stock = round(current_stock - v_qty, 2)
      WHERE id = v_item.product_id
      RETURNING current_stock INTO v_bal;

      INSERT INTO stock_movements (
        business_id, product_id, type, quantity, balance_after,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        p_business_id, v_item.product_id, 'sale', -v_qty, v_bal,
        'sales_invoice', p_doc_id, 'Invoice ' || v_doc.invoice_number || ' issued', auth.uid()
      );
    END LOOP;

    UPDATE sales_invoices SET status = 'issued' WHERE id = p_doc_id;

    v_je := post_sales_invoice_journal(p_doc_id);

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
    VALUES (p_business_id, auth.uid(), 'document_issued', 'sales_invoice', p_doc_id,
            'Invoice ' || v_doc.invoice_number || ' issued from draft');
  ELSE
    IF NOT EXISTS (SELECT 1 FROM purchase_bill_items WHERE bill_id = p_doc_id) THEN
      RAISE EXCEPTION 'Document has no lines';
    END IF;

    FOR v_item IN
      SELECT product_id, quantity FROM purchase_bill_items
      WHERE bill_id = p_doc_id AND product_id IS NOT NULL
    LOOP
      SELECT current_stock INTO v_bal
      FROM products
      WHERE id = v_item.product_id AND business_id = p_business_id AND type = 'product'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found in this business', v_item.product_id;
      END IF;

      v_qty := v_item.quantity;

      UPDATE products
      SET current_stock = round(current_stock + v_qty, 2)
      WHERE id = v_item.product_id
      RETURNING current_stock INTO v_bal;

      INSERT INTO stock_movements (
        business_id, product_id, type, quantity, balance_after,
        reference_type, reference_id, notes, created_by
      ) VALUES (
        p_business_id, v_item.product_id, 'purchase', v_qty, v_bal,
        'purchase_bill', p_doc_id, 'Bill ' || v_doc.bill_number || ' issued', auth.uid()
      );
    END LOOP;

    UPDATE purchase_bills SET status = 'confirmed' WHERE id = p_doc_id;

    v_je := post_purchase_bill_journal(p_doc_id);

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
    VALUES (p_business_id, auth.uid(), 'document_issued', 'purchase_bill', p_doc_id,
            'Bill ' || v_doc.bill_number || ' issued from draft');
  END IF;

  RETURN v_je;
END;
$$;

REVOKE EXECUTE ON FUNCTION issue_document(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_document(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION issue_document(uuid, text, uuid) TO authenticated;

-- ============================================================================
-- 4. Hard-delete from draft (nothing was ever posted)
-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_draft(
  p_business_id uuid,
  p_doc_type text,
  p_doc_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_doc_type NOT IN ('sales_invoice', 'purchase_bill') THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  IF p_doc_type = 'sales_invoice' THEN
    SELECT invoice_number INTO v_label FROM sales_invoices
    WHERE id = p_doc_id AND business_id = p_business_id AND status = 'draft'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Draft invoice not found (or not a draft); use cancel_sales_invoice for live documents';
    END IF;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
    VALUES (p_business_id, auth.uid(), 'draft_deleted', 'sales_invoice', p_doc_id,
            'Draft invoice ' || v_label || ' deleted');

    DELETE FROM sales_invoices WHERE id = p_doc_id;
  ELSE
    SELECT bill_number INTO v_label FROM purchase_bills
    WHERE id = p_doc_id AND business_id = p_business_id AND status = 'draft'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Draft bill not found (or not a draft); use cancel_purchase_bill for live documents';
    END IF;

    INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
    VALUES (p_business_id, auth.uid(), 'draft_deleted', 'purchase_bill', p_doc_id,
            'Draft bill ' || v_label || ' deleted');

    DELETE FROM purchase_bills WHERE id = p_doc_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_draft(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_draft(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_draft(uuid, text, uuid) TO authenticated;

-- ============================================================================
-- 5. Draft listing surface (legacy + new drafts, honestly badged)
-- ============================================================================
CREATE OR REPLACE VIEW v_draft_documents WITH (security_invoker = on) AS
SELECT si.business_id, si.id AS doc_id, 'sales_invoice'::text AS doc_type,
       si.invoice_number AS doc_number, si.invoice_date AS doc_date,
       c.name AS party_name, si.grand_total::numeric AS grand_total
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.status = 'draft'
UNION ALL
SELECT pb.business_id, pb.id, 'purchase_bill'::text,
       pb.bill_number, pb.bill_date,
       s.name, pb.grand_total::numeric
FROM purchase_bills pb
JOIN suppliers s ON s.id = pb.supplier_id
WHERE pb.status = 'draft';
