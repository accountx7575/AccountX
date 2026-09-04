-- ============================================================================
-- 036: P0/P1 integrity fixes from post-redesign QA audit
--   1) C1: stock restoration on invoice/bill cancellation (compensating
--      movements inside the transactional cancel RPCs)
--   2) C4: atomic stock adjustment (movement + journal in ONE definer tx;
--      journal failure rolls back the movement - no orphans possible)
--   3) P1: DB backstop against duplicate posting -
--      UNIQUE(business_id, reference_type, reference_id) where reference set
--   4) P1: privilege tightening - 'owner' grants only via ownership transfer;
--      direct DML can no longer create or promote to owner
--
-- Rules honored: additive only, no data rewritten, RLS untouched (policies
-- replaced with STRICTER versions), SECURITY DEFINER pinned search_path,
-- revokes hardened.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a) cancel_sales_invoice - now restores stock for live (issued) invoices
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_existing_reversal uuid;
  v_item RECORD;
  v_product RECORD;
  v_new_stock numeric;
  v_cancelled_movement int;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- J2: money moved => cancellation blocked, refund via CN path
  IF v_invoice.paid_amount > 0 OR v_invoice.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Paid or partially paid invoices cannot be cancelled; use the credit-note flow';
  END IF;

  IF v_invoice.status = 'cancelled' OR v_invoice.status = 'void' THEN
    -- Immutable already: surface the existing reversal, if any
    SELECT id INTO v_existing_reversal
    FROM journal_entries
    WHERE business_id = v_invoice.business_id
      AND reference_type = 'sales_invoice_reversal'
      AND reference_id = p_invoice_id
    LIMIT 1;
    RETURN v_existing_reversal;
  END IF;

  IF v_invoice.status = 'draft' THEN
    -- Drafts never touched stock or books: nothing to restore
    UPDATE sales_invoices SET status = 'cancelled' WHERE id = p_invoice_id;
    RETURN NULL;
  END IF;

  -- Live (issued): flip first - the reversal engine requires it - then reverse
  UPDATE sales_invoices SET status = 'cancelled' WHERE id = p_invoice_id;

  -- ------------------------------------------------------------------
  -- QA C1 fix: restore stock consumed at issue time.
  -- One compensating movement per line item, reference-tagged so the
  -- operation is idempotent even if this function is re-entered.
  -- trg_stock_recompute keeps products.current_stock canonical from
  -- movements; we still maintain the row under lock (house style 030).
  -- ------------------------------------------------------------------
  FOR v_item IN
    SELECT product_id, quantity
    FROM sales_invoice_items
    WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL
  LOOP
    SELECT count(*) INTO v_cancelled_movement
    FROM stock_movements
    WHERE business_id = v_invoice.business_id
      AND reference_type = 'sales_invoice_cancel'
      AND reference_id = p_invoice_id
      AND product_id = v_item.product_id;
    IF v_cancelled_movement > 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_product FROM products
    WHERE id = v_item.product_id AND business_id = v_invoice.business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;  -- product deleted later; nothing to restore
    END IF;

    v_new_stock := v_product.current_stock + v_item.quantity;

    INSERT INTO stock_movements (
      business_id, product_id, type, quantity,
      balance_after, reference_type, reference_id, notes, created_by
    ) VALUES (
      v_invoice.business_id, v_item.product_id,
      'sale_return', v_item.quantity,
      v_new_stock, 'sales_invoice_cancel', p_invoice_id,
      'Stock restored on cancellation of ' || v_invoice.invoice_number,
      auth.uid()
    );

    UPDATE products SET current_stock = v_new_stock
    WHERE id = v_item.product_id;
  END LOOP;

  RETURN reverse_sales_invoice_journal(p_invoice_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_sales_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_sales_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_sales_invoice(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 1b) cancel_purchase_bill - mirrors 1a (stock returned to supplier)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_purchase_bill(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_existing_reversal uuid;
  v_item RECORD;
  v_product RECORD;
  v_new_stock numeric;
  v_cancelled_movement int;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- J2: money moved => cancellation blocked, refund via debit-note path
  IF v_bill.paid_amount > 0 OR v_bill.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Paid or partially paid bills cannot be cancelled; use the debit-note flow';
  END IF;

  IF v_bill.status = 'cancelled' OR v_bill.status = 'void' THEN
    SELECT id INTO v_existing_reversal
    FROM journal_entries
    WHERE business_id = v_bill.business_id
      AND reference_type = 'purchase_bill_reversal'
      AND reference_id = p_bill_id
    LIMIT 1;
    RETURN v_existing_reversal;
  END IF;

  IF v_bill.status = 'draft' THEN
    UPDATE purchase_bills SET status = 'cancelled' WHERE id = p_bill_id;
    RETURN NULL;
  END IF;

  UPDATE purchase_bills SET status = 'cancelled' WHERE id = p_bill_id;

  -- QA C1 fix: remove stock received at confirmation time
  FOR v_item IN
    SELECT product_id, quantity
    FROM purchase_bill_items
    WHERE bill_id = p_bill_id AND product_id IS NOT NULL
  LOOP
    SELECT count(*) INTO v_cancelled_movement
    FROM stock_movements
    WHERE business_id = v_bill.business_id
      AND reference_type = 'purchase_bill_cancel'
      AND reference_id = p_bill_id
      AND product_id = v_item.product_id;
    IF v_cancelled_movement > 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_product FROM products
    WHERE id = v_item.product_id AND business_id = v_bill.business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_new_stock := v_product.current_stock - v_item.quantity;

    INSERT INTO stock_movements (
      business_id, product_id, type, quantity,
      balance_after, reference_type, reference_id, notes, created_by
    ) VALUES (
      v_bill.business_id, v_item.product_id,
      'purchase_return', -v_item.quantity,
      v_new_stock, 'purchase_bill_cancel', p_bill_id,
      'Stock removed on cancellation of ' || v_bill.bill_number,
      auth.uid()
    );

    UPDATE products SET current_stock = v_new_stock
    WHERE id = v_item.product_id;
  END LOOP;

  RETURN reverse_purchase_bill_journal(p_bill_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_purchase_bill(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_purchase_bill(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_purchase_bill(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2) C4 fix: atomic stock adjustment.
--    The movement and its journal are written in THIS single definer
--    transaction. If post_stock_adjustment_journal fails, the whole
--    transaction (including the movement insert) rolls back - an orphaned
--    un-journaled movement becomes structurally impossible.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_stock_adjustment_atomic(
  p_business_id uuid,
  p_product_id uuid,
  p_type text,            -- 'adjustment_in' | 'adjustment_out'
  p_quantity numeric,     -- positive magnitude
  p_notes text DEFAULT NULL,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_product RECORD;
  v_signed numeric;
  v_new_stock numeric;
  v_movement_id uuid;
  v_je_id uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF p_type NOT IN ('adjustment_in', 'adjustment_out') THEN
    RAISE EXCEPTION 'Invalid adjustment type %', p_type;
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive';
  END IF;

  SELECT * INTO v_product FROM products
  WHERE id = p_product_id AND business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_signed := CASE WHEN p_type = 'adjustment_out' THEN -p_quantity ELSE p_quantity END;
  v_new_stock := v_product.current_stock + v_signed;

  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Adjustment would drive stock of % negative (%)',
      v_product.name, v_new_stock;
  END IF;

  INSERT INTO stock_movements (
    business_id, product_id, type, quantity, balance_after,
    reference_type, notes, created_by
  ) VALUES (
    p_business_id, p_product_id, p_type, v_signed, v_new_stock,
    'manual_adjustment', COALESCE(p_notes, 'Stock adjustment'), v_user
  )
  RETURNING id INTO v_movement_id;

  -- If THIS raises, the movement insert above rolls back with it.
  v_je_id := post_stock_adjustment_journal(
    p_business_id  => p_business_id,
    p_product_id   => p_product_id,
    p_quantity_change => v_signed,
    p_reference_id => v_movement_id,
    p_notes        => p_notes,
    p_date         => p_date
  );

  RETURN jsonb_build_object('movement_id', v_movement_id, 'journal_entry_id', v_je_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION post_stock_adjustment_atomic(uuid,uuid,text,numeric,text,date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_stock_adjustment_atomic(uuid,uuid,text,numeric,text,date) FROM anon;
GRANT EXECUTE ON FUNCTION post_stock_adjustment_atomic(uuid,uuid,text,numeric,text,date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Duplicate-posting DB backstop. Every wrapper checks-then-inserts on this
--    triple; two concurrent writers could both pass the check. This index makes
--    the second insert fail hard instead of double-posting.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_idempotency
  ON journal_entries (business_id, reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4) Privilege tightening: ownership changes ONLY via admin_transfer_ownership.
--    4a) Direct DML can neither create nor promote into 'owner'.
--    4b) admin_change_member_role refuses 'owner' targets (034 allowed it).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "members_insert" ON business_members;
CREATE POLICY "members_insert" ON business_members FOR INSERT
  TO authenticated WITH CHECK (
    business_members.role <> 'owner'
    AND EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  );

DROP POLICY IF EXISTS "members_update" ON business_members;
CREATE POLICY "members_update" ON business_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  )
  WITH CHECK (
    business_members.role <> 'owner'
    AND EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  );

CREATE OR REPLACE FUNCTION admin_change_member_role(
  p_member_id uuid,
  p_new_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target business_members%ROWTYPE;
  v_caller_is_owner boolean;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- QA privilege fix: ownership is transferred, never granted
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Ownership must be changed via the transfer-ownership flow';
  END IF;

  SELECT * INTO v_target FROM business_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'Only active members can change role';
  END IF;
  IF NOT is_business_admin(v_target.business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can change member roles';
  END IF;
  IF p_new_role NOT IN ('admin','manager','accountant','sales_staff','purchase_staff','inventory_staff','viewer') THEN
    RAISE EXCEPTION 'Unknown role %', p_new_role;
  END IF;

  IF v_target.role = 'owner' THEN
    SELECT EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = v_target.business_id AND user_id = auth.uid()
        AND role = 'owner' AND status = 'active'
    ) INTO v_caller_is_owner;
    IF NOT v_caller_is_owner THEN
      RAISE EXCEPTION 'Only an owner can demote another owner';
    END IF;
    SELECT count(*) INTO v_owner_count
    FROM business_members
    WHERE business_id = v_target.business_id
      AND role = 'owner' AND status = 'active' AND is_active = true;
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of a business';
    END IF;
  END IF;

  UPDATE business_members SET role = p_new_role WHERE id = p_member_id;

  PERFORM write_audit(v_target.business_id, 'member_role_changed', 'business_member',
    p_member_id::text, jsonb_build_object('from', v_target.role, 'to', p_new_role),
    'Role changed from ' || v_target.role || ' to ' || p_new_role);

  RETURN p_member_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_change_member_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_change_member_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_change_member_role(uuid, text) TO authenticated;
