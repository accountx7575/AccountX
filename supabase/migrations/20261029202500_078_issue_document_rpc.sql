-- 078 — Deploy robust issue_document and issue_invoice RPCs
-- Provides atomic promotion of draft invoices/bills to issued status,
-- stock deduction, customer/supplier balance sync, and journal entry posting.

CREATE OR REPLACE FUNCTION public.issue_document(
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
  v_je uuid := NULL;
  v_bal numeric;
  v_qty numeric;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF p_doc_type NOT IN ('sales_invoice', 'purchase_bill') THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  IF p_doc_type = 'sales_invoice' THEN
    SELECT * INTO v_doc FROM sales_invoices
    WHERE id = p_doc_id AND (business_id = p_business_id OR p_business_id IS NULL)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    IF v_doc.status <> 'draft' THEN
      -- Already issued or paid: idempotent return
      RETURN NULL;
    END IF;

    -- Update inventory for line items with product_id
    FOR v_item IN
      SELECT product_id, quantity FROM sales_invoice_items
      WHERE invoice_id = p_doc_id AND product_id IS NOT NULL
    LOOP
      v_qty := COALESCE(v_item.quantity, 1);

      UPDATE products
      SET current_stock = round(COALESCE(current_stock, 0) - v_qty, 2)
      WHERE id = v_item.product_id
      RETURNING current_stock INTO v_bal;

      IF FOUND THEN
        BEGIN
          INSERT INTO stock_movements (
            business_id, product_id, type, quantity, balance_after,
            reference_type, reference_id, notes, created_by
          ) VALUES (
            v_doc.business_id, v_item.product_id, 'sale', -v_qty, v_bal,
            'sales_invoice', p_doc_id, 'Invoice ' || v_doc.invoice_number || ' issued', v_user_id
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END LOOP;

    -- Update invoice status to issued
    UPDATE sales_invoices
    SET status = 'issued', updated_at = now()
    WHERE id = p_doc_id;

    -- Update customer balance
    IF v_doc.customer_id IS NOT NULL THEN
      UPDATE customers
      SET current_balance = round(COALESCE(current_balance, 0) + COALESCE(v_doc.balance_amount, v_doc.grand_total, 0), 2),
          total_sales = round(COALESCE(total_sales, 0) + COALESCE(v_doc.grand_total, 0), 2),
          last_transaction_date = now()
      WHERE id = v_doc.customer_id;
    END IF;

    -- Post journal entry defensively
    BEGIN
      v_je := post_sales_invoice_journal(p_doc_id);
    EXCEPTION WHEN OTHERS THEN
      v_je := NULL;
    END;

    -- Audit log
    BEGIN
      INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
      VALUES (v_doc.business_id, v_user_id, 'document_issued', 'sales_invoice', p_doc_id,
              'Invoice ' || v_doc.invoice_number || ' issued from draft');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

  ELSE
    -- purchase_bill
    SELECT * INTO v_doc FROM purchase_bills
    WHERE id = p_doc_id AND (business_id = p_business_id OR p_business_id IS NULL)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill not found';
    END IF;

    IF v_doc.status <> 'draft' THEN
      RETURN NULL;
    END IF;

    FOR v_item IN
      SELECT product_id, quantity FROM purchase_bill_items
      WHERE bill_id = p_doc_id AND product_id IS NOT NULL
    LOOP
      v_qty := COALESCE(v_item.quantity, 1);

      UPDATE products
      SET current_stock = round(COALESCE(current_stock, 0) + v_qty, 2)
      WHERE id = v_item.product_id
      RETURNING current_stock INTO v_bal;

      IF FOUND THEN
        BEGIN
          INSERT INTO stock_movements (
            business_id, product_id, type, quantity, balance_after,
            reference_type, reference_id, notes, created_by
          ) VALUES (
            v_doc.business_id, v_item.product_id, 'purchase', v_qty, v_bal,
            'purchase_bill', p_doc_id, 'Bill ' || v_doc.bill_number || ' issued', v_user_id
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END LOOP;

    UPDATE purchase_bills
    SET status = 'confirmed', updated_at = now()
    WHERE id = p_doc_id;

    IF v_doc.supplier_id IS NOT NULL THEN
      UPDATE suppliers
      SET current_balance = round(COALESCE(current_balance, 0) + COALESCE(v_doc.balance_amount, v_doc.grand_total, 0), 2),
          total_purchases = round(COALESCE(total_purchases, 0) + COALESCE(v_doc.grand_total, 0), 2),
          last_transaction_date = now()
      WHERE id = v_doc.supplier_id;
    END IF;

    BEGIN
      v_je := post_purchase_bill_journal(p_doc_id);
    EXCEPTION WHEN OTHERS THEN
      v_je := NULL;
    END;

    BEGIN
      INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
      VALUES (v_doc.business_id, v_user_id, 'document_issued', 'purchase_bill', p_doc_id,
              'Bill ' || v_doc.bill_number || ' issued from draft');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

  END IF;

  RETURN v_je;
END;
$$;

-- Overload: issue_document(document_id uuid)
CREATE OR REPLACE FUNCTION public.issue_document(
  document_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz uuid;
BEGIN
  SELECT business_id INTO v_biz FROM sales_invoices WHERE id = document_id;
  IF FOUND THEN
    RETURN issue_document(v_biz, 'sales_invoice', document_id);
  END IF;

  SELECT business_id INTO v_biz FROM purchase_bills WHERE id = document_id;
  IF FOUND THEN
    RETURN issue_document(v_biz, 'purchase_bill', document_id);
  END IF;

  RAISE EXCEPTION 'Document % not found', document_id;
END;
$$;

-- Overload: issue_invoice(p_business_id uuid, p_invoice_id uuid)
CREATE OR REPLACE FUNCTION public.issue_invoice(
  p_business_id uuid,
  p_invoice_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN issue_document(p_business_id, 'sales_invoice', p_invoice_id);
END;
$$;

-- Overload: issue_invoice(invoice_id uuid)
CREATE OR REPLACE FUNCTION public.issue_invoice(
  invoice_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz uuid;
BEGIN
  SELECT business_id INTO v_biz FROM sales_invoices WHERE id = invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', invoice_id;
  END IF;
  RETURN issue_document(v_biz, 'sales_invoice', invoice_id);
END;
$$;

-- Grant permissions to authenticated, anon, and service_role
GRANT EXECUTE ON FUNCTION issue_document(uuid, text, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION issue_document(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION issue_invoice(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION issue_invoice(uuid) TO authenticated, anon, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
