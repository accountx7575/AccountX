-- ============================================================================
-- 062 — RELEASE HARDENING: server-side document header-totals integrity guard
-- ============================================================================
-- T116 (Stanley finding relay). Both save RPCs persisted CLIENT header totals
-- verbatim: no grand_total cross-check, no negative-component guard. The FE is
-- now correct; this closes the hostile/broken-client path that could persist
-- self-inconsistent documents and corrupt downstream GST/journal math.
--
-- Guards added to create_sales_invoice + create_purchase_bill (reject-don't-
-- fix — we NEVER silently override; bad payloads must surface):
--   G1 item rows: negative taxable/cgst/sgst/igst/cess RAISE (negative
--      quantity was already guarded).
--   G2 header: negative taxable/GST/cess RAISE (round_off EXCLUDED by design
--      — signed plug per 013b: credited positive, debited |amount| negative).
--   G3 header-vs-items agreement within paisa tolerance 0.01 for the five
--      summed components.
--   G4 013b identity mirrored from the ITEM payload:
--        grand_total = Σitem.taxable + Σitem.cgst + Σitem.sgst + Σitem.igst
--                    + Σitem.cess + header.round_off   (±0.01)
-- Applied to drafts TOO: a corrupt draft poisons issue_document promotion,
-- which posts the JE straight from stored header figures.
--
-- CONTRACT NOTE: item payloads MUST carry the per-item tax breakdown
-- (taxable/cgst/sgst/igst/cess) — true of the FE contract since 017-era and
-- reaffirmed by Stanley's client-side fix. Bodies below are VERBATIM 030
-- copies; every inserted region is delimited by paired T116-OPEN / T116-CLOSE
-- marker comments so the zero-drift claim is mechanically provable.
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
-- T116(+) declared sums + expected total
  v_sum_taxable numeric := 0;
  v_sum_cgst numeric := 0;
  v_sum_sgst numeric := 0;
  v_sum_igst numeric := 0;
  v_sum_cess numeric := 0;
  v_expected_total numeric;
-- T116(-)
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
-- T116(+) item-level negativity + component accumulation
    IF COALESCE((v_item->>'taxable_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'cgst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'sgst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'igst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'cess_amount')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Item % has a negative amount', v_item->>'product_name';
    END IF;
    v_sum_taxable := v_sum_taxable + COALESCE((v_item->>'taxable_amount')::numeric, 0);
    v_sum_cgst := v_sum_cgst + COALESCE((v_item->>'cgst_amount')::numeric, 0);
    v_sum_sgst := v_sum_sgst + COALESCE((v_item->>'sgst_amount')::numeric, 0);
    v_sum_igst := v_sum_igst + COALESCE((v_item->>'igst_amount')::numeric, 0);
    v_sum_cess := v_sum_cess + COALESCE((v_item->>'cess_amount')::numeric, 0);
-- T116(-)
  END LOOP;

  v_grand_total := COALESCE((p_invoice->>'grand_total')::numeric, 0);

-- T116(+) header guards: negativity, items-agreement, 013b identity
  IF COALESCE((p_invoice->>'taxable_amount')::numeric, 0) < 0
     OR COALESCE((p_invoice->>'cgst_amount')::numeric, 0) < 0
     OR COALESCE((p_invoice->>'sgst_amount')::numeric, 0) < 0
     OR COALESCE((p_invoice->>'igst_amount')::numeric, 0) < 0
     OR COALESCE((p_invoice->>'cess_amount')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'Invoice header has a negative tax component';
  END IF;

  IF abs(COALESCE((p_invoice->>'taxable_amount')::numeric, 0) - v_sum_taxable) > 0.01
     OR abs(COALESCE((p_invoice->>'cgst_amount')::numeric, 0) - v_sum_cgst) > 0.01
     OR abs(COALESCE((p_invoice->>'sgst_amount')::numeric, 0) - v_sum_sgst) > 0.01
     OR abs(COALESCE((p_invoice->>'igst_amount')::numeric, 0) - v_sum_igst) > 0.01
     OR abs(COALESCE((p_invoice->>'cess_amount')::numeric, 0) - v_sum_cess) > 0.01 THEN
    RAISE EXCEPTION 'Invoice header tax amounts disagree with the item payload beyond 0.01';
  END IF;

  v_expected_total := v_sum_taxable + v_sum_cgst + v_sum_sgst + v_sum_igst
                      + v_sum_cess + COALESCE((p_invoice->>'round_off')::numeric, 0);
  IF abs(v_grand_total - v_expected_total) > 0.01 THEN
    RAISE EXCEPTION 'Invoice grand_total % does not equal items+round_off %',
      v_grand_total, v_expected_total;
  END IF;
-- T116(-)

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

-- ============================================================================
-- 1b. Extended save: purchase bill (live + draft) — T116 guards mirrored
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
-- T116(+) declared sums + expected total
  v_sum_taxable numeric := 0;
  v_sum_cgst numeric := 0;
  v_sum_sgst numeric := 0;
  v_sum_igst numeric := 0;
  v_sum_cess numeric := 0;
  v_expected_total numeric;
-- T116(-)
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
-- T116(+) item-level negativity + component accumulation
    IF COALESCE((v_item->>'taxable_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'cgst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'sgst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'igst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'cess_amount')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Item % has a negative amount', v_item->>'product_name';
    END IF;
    v_sum_taxable := v_sum_taxable + COALESCE((v_item->>'taxable_amount')::numeric, 0);
    v_sum_cgst := v_sum_cgst + COALESCE((v_item->>'cgst_amount')::numeric, 0);
    v_sum_sgst := v_sum_sgst + COALESCE((v_item->>'sgst_amount')::numeric, 0);
    v_sum_igst := v_sum_igst + COALESCE((v_item->>'igst_amount')::numeric, 0);
    v_sum_cess := v_sum_cess + COALESCE((v_item->>'cess_amount')::numeric, 0);
-- T116(-)
  END LOOP;

  v_grand_total := COALESCE((p_bill->>'grand_total')::numeric, 0);

-- T116(+) header guards: negativity, items-agreement, 013b identity
  IF COALESCE((p_bill->>'taxable_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'cgst_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'sgst_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'igst_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'cess_amount')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'Bill header has a negative tax component';
  END IF;

  IF abs(COALESCE((p_bill->>'taxable_amount')::numeric, 0) - v_sum_taxable) > 0.01
     OR abs(COALESCE((p_bill->>'cgst_amount')::numeric, 0) - v_sum_cgst) > 0.01
     OR abs(COALESCE((p_bill->>'sgst_amount')::numeric, 0) - v_sum_sgst) > 0.01
     OR abs(COALESCE((p_bill->>'igst_amount')::numeric, 0) - v_sum_igst) > 0.01
     OR abs(COALESCE((p_bill->>'cess_amount')::numeric, 0) - v_sum_cess) > 0.01 THEN
    RAISE EXCEPTION 'Bill header tax amounts disagree with the item payload beyond 0.01';
  END IF;

  v_expected_total := v_sum_taxable + v_sum_cgst + v_sum_sgst + v_sum_igst
                      + v_sum_cess + COALESCE((p_bill->>'round_off')::numeric, 0);
  IF abs(v_grand_total - v_expected_total) > 0.01 THEN
    RAISE EXCEPTION 'Bill grand_total % does not equal items+round_off %',
      v_grand_total, v_expected_total;
  END IF;
-- T116(-)

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
