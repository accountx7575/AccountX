/*
# 022 — Credit/Debit Notes: schema + reversal-integrated RPCs (T26) + expense numbering (T50)

NUMBERING (T26 + T50 rider): document_sequences doc_type CHECK widened to
add 'credit_note','debit_note','expense'; next_document_number prefix map
extended CN/DN/EXP (function re-emitted, body otherwise identical to 016).
Stanley can switch FE expense numbering onto the service now.

PAYMENTS: type CHECK extended with 'refund' (money OUT to customer) and
'refund_received' (money IN from supplier) so the paid-doc rule has a home.

SCHEMA: credit_notes / credit_note_items / debit_notes / debit_note_items.
Status machine (J2-compliant): draft -> issued -> applied; cancelled only
from draft/issued; applied is immutable (refunds already flowed).
Linkage: parent doc id + per-item sales_invoice_item_id /
purchase_bill_item_id original-line refs. restock flag controls goods flow.

RPC CONTRACTS:
- issue_credit_note(biz, credit_note_id) / issue_debit_note(biz, debit_note_id)
  draft -> issued. Posts the reversal-direction JE off CANONICAL accounts
  (party ledger under Sundry Debtors/Sundry Creditors, Sales/Purchases,
  Output/Input GST ledgers, Round Off same-sign convention as 013b) —
  internally balanced by construction. If restock: per-item RMW stock
  restore/return with insufficient-stock guard (sale_return / purchase_return).
- apply_credit_note(biz, credit_note_id, p_refund_method DEFAULT 'bank') /
  apply_debit_note(...)
  issued -> applied against the parent doc. Offset part reduces the live
  doc's outstanding (memo allocation — AR/AP already moved at issue).
  Paid-doc rule: any portion beyond current outstanding routes through a
  payments row (type='refund' / 'refund_received', numbered via the
  service RCV/PAY counters) plus its cash JE. Partially-paid parents get
  the split automatically.
- cancel_credit_note(biz, credit_note_id) / cancel_debit_note(...)
  draft: status flip only. issued: mirror-cancellation JE (reads the
  actually-posted lines and swaps them — cannot drift) + opposite stock
  movements, guarded against duplicates. applied: RAISES.

All RPCs SECURITY DEFINER, auth + can_write + business-scoped, FOR UPDATE
locks, single transaction per call.
*/

-- ============================================================================
-- A. NUMBERING SERVICE EXTENSION (constraint swap + re-emit)
-- ============================================================================
DO $$
DECLARE
  c text;
BEGIN
  SELECT max(conname) INTO c
  FROM pg_constraint
  WHERE conrelid = 'document_sequences'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%sales_invoice%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE document_sequences DROP CONSTRAINT ' || c;
  END IF;
END $$;

ALTER TABLE document_sequences ADD CHECK (doc_type IN (
  'sales_invoice','purchase_bill','payment_received','payment_made',
  'credit_note','debit_note','expense'));

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
    WHEN 'credit_note' THEN 'CN'
    WHEN 'debit_note' THEN 'DN'
    WHEN 'expense' THEN 'EXP'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  v_number := v_prefix || '/' || extract(year from COALESCE(p_date, CURRENT_DATE))::text
              || '/' || lpad(v_seq::text, 6, '0');

  INSERT INTO document_numbers (business_id, doc_type, number)
  VALUES (p_business_id, p_doc_type, v_number)
  ON CONFLICT (business_id, doc_type, number) DO NOTHING;

  RETURN v_number;
END;
$$;

-- ============================================================================
-- B. PAYMENTS TYPE EXTENSION
-- ============================================================================
DO $$
DECLARE
  c text;
BEGIN
  SELECT max(conname) INTO c
  FROM pg_constraint
  WHERE conrelid = 'payments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%received%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE payments DROP CONSTRAINT ' || c;
  END IF;
END $$;

ALTER TABLE payments ADD CHECK (type IN ('received','made','refund','refund_received'));

-- ============================================================================
-- C. TABLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  credit_note_number text NOT NULL,
  sales_invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,
  restock boolean NOT NULL DEFAULT false,
  subtotal numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','applied','cancelled')),
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, credit_note_number)
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  sales_invoice_item_id uuid REFERENCES sales_invoice_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  rate numeric(14,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  tax_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debit_note_number text NOT NULL,
  purchase_bill_id uuid NOT NULL REFERENCES purchase_bills(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,
  restock boolean NOT NULL DEFAULT false,
  subtotal numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','applied','cancelled')),
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, debit_note_number)
);

CREATE TABLE IF NOT EXISTS debit_note_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debit_note_id uuid NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
  purchase_bill_item_id uuid REFERENCES purchase_bill_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  rate numeric(14,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  tax_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE debit_note_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_notes_select" ON credit_notes FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "credit_notes_insert" ON credit_notes FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "credit_notes_update" ON credit_notes FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "credit_notes_delete" ON credit_notes FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "credit_note_items_select" ON credit_note_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "credit_note_items_insert" ON credit_note_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "credit_note_items_update" ON credit_note_items FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "credit_note_items_delete" ON credit_note_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "debit_notes_select" ON debit_notes FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "debit_notes_insert" ON debit_notes FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "debit_notes_update" ON debit_notes FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "debit_notes_delete" ON debit_notes FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "debit_note_items_select" ON debit_note_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "debit_note_items_insert" ON debit_note_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "debit_note_items_update" ON debit_note_items FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "debit_note_items_delete" ON debit_note_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_credit_notes_business ON credit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(sales_invoice_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_business ON debit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_bill ON debit_notes(purchase_bill_id);

-- ============================================================================
-- D. ISSUE RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION issue_credit_note(
  p_business_id uuid,
  p_credit_note_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cn RECORD;
  v_je uuid;
  v_party uuid;
  v_sales uuid;
  v_ocg uuid; v_osg uuid; v_oig uuid; v_ocess uuid;
  v_ro uuid;
  v_item RECORD;
  v_newbal numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_cn FROM credit_notes
  WHERE id = p_credit_note_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found in this business';
  END IF;

  IF v_cn.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft credit notes can be issued';
  END IF;

  IF COALESCE(v_cn.grand_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Credit note total must be positive';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM credit_note_items WHERE credit_note_id = p_credit_note_id) THEN
    RAISE EXCEPTION 'Credit note has no lines';
  END IF;

  -- Numbering (service counter, CN prefix)
  UPDATE credit_notes
  SET credit_note_number = next_document_number(p_business_id, 'credit_note', v_cn.date),
      updated_at = now()
  WHERE id = p_credit_note_id
  RETURNING credit_note_number INTO v_cn.credit_note_number;

  -- Canonical accounts
  SELECT c.name INTO v_cn.customer_name FROM customers c WHERE c.id = v_cn.customer_id;
  v_party := find_or_create_account(p_business_id, v_cn.customer_name, 'Sundry Debtors');
  v_sales := find_or_create_account(p_business_id, 'Sales', 'Direct Income');
  v_ocg   := find_or_create_account(p_business_id, 'Output CGST', 'GST Payable');
  v_osg   := find_or_create_account(p_business_id, 'Output SGST', 'GST Payable');
  v_oig   := find_or_create_account(p_business_id, 'Output IGST', 'GST Payable');
  v_ocess := find_or_create_account(p_business_id, 'Output Cess', 'GST Payable');
  v_ro    := find_or_create_account(p_business_id, 'Round Off', 'Indirect Income');

  -- Reversal-direction JE: Dr party (grand) / Cr Sales + Output GST + RO
  INSERT INTO journal_entries (business_id, entry_number, date, narration,
    total_debit, total_credit, status, reference_type, reference_id, created_by)
  VALUES (p_business_id, 'JE-' || v_cn.credit_note_number, v_cn.date,
    'Credit note ' || v_cn.credit_note_number,
    round(v_cn.grand_total,2), round(v_cn.grand_total,2),
    'posted', 'credit_note', p_credit_note_id, auth.uid())
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
  VALUES (p_business_id, v_je, v_party, round(v_cn.grand_total,2), 0),
         (p_business_id, v_je, v_sales, 0, round(COALESCE(v_cn.taxable_amount,0),2)),
         (p_business_id, v_je, v_ocg, 0, round(COALESCE(v_cn.cgst_amount,0),2)),
         (p_business_id, v_je, v_osg, 0, round(COALESCE(v_cn.sgst_amount,0),2)),
         (p_business_id, v_je, v_oig, 0, round(COALESCE(v_cn.igst_amount,0),2)),
         (p_business_id, v_je, v_ocess, 0, round(COALESCE(v_cn.cess_amount,0),2)),
         (p_business_id, v_je, v_ro, 0,
           round(GREATEST(COALESCE(v_cn.round_off,0),0),2)),
         (p_business_id, v_je, v_ro,
           round(GREATEST(-COALESCE(v_cn.round_off,0),0),2), 0);

  -- Stock restore (returned goods) per item, RMW with row locks
  IF v_cn.restock THEN
    FOR v_item IN
      SELECT product_id, quantity FROM credit_note_items
      WHERE credit_note_id = p_credit_note_id AND product_id IS NOT NULL
        AND quantity > 0
    LOOP
      UPDATE products
      SET current_stock = round(COALESCE(current_stock,0) + v_item.quantity, 2)
      WHERE id = v_item.product_id
      RETURNING current_stock INTO v_newbal;

      INSERT INTO stock_movements (business_id, product_id, type, quantity,
        balance_after, reference_type, reference_id, notes, created_by)
      VALUES (p_business_id, v_item.product_id, 'sale_return', v_item.quantity,
        v_newbal, 'credit_note', p_credit_note_id,
        'CN ' || v_cn.credit_note_number, auth.uid());
    END LOOP;
  END IF;

  RETURN p_credit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION issue_credit_note(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_credit_note(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION issue_credit_note(uuid, uuid) TO authenticated;

-- ============================================================================
CREATE OR REPLACE FUNCTION issue_debit_note(
  p_business_id uuid,
  p_debit_note_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dn RECORD;
  v_je uuid;
  v_party uuid;
  v_pur uuid;
  v_icg uuid; v_isg uuid; v_iig uuid; v_icess uuid;
  v_ro uuid;
  v_item RECORD;
  v_newbal numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_dn FROM debit_notes
  WHERE id = p_debit_note_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debit note not found in this business';
  END IF;

  IF v_dn.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft debit notes can be issued';
  END IF;

  IF COALESCE(v_dn.grand_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Debit note total must be positive';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM debit_note_items WHERE debit_note_id = p_debit_note_id) THEN
    RAISE EXCEPTION 'Debit note has no lines';
  END IF;

  UPDATE debit_notes
  SET debit_note_number = next_document_number(p_business_id, 'debit_note', v_dn.date),
      updated_at = now()
  WHERE id = p_debit_note_id
  RETURNING debit_note_number INTO v_dn.debit_note_number;

  SELECT s.name INTO v_dn.supplier_name FROM suppliers s WHERE s.id = v_dn.supplier_id;
  v_party := find_or_create_account(p_business_id, v_dn.supplier_name, 'Sundry Creditors');
  v_pur   := find_or_create_account(p_business_id, 'Purchases', 'Direct Expense');
  v_icg   := find_or_create_account(p_business_id, 'Input CGST', 'GST Receivable');
  v_isg   := find_or_create_account(p_business_id, 'Input SGST', 'GST Receivable');
  v_iig   := find_or_create_account(p_business_id, 'Input IGST', 'GST Receivable');
  v_icess := find_or_create_account(p_business_id, 'Input Cess', 'GST Receivable');
  v_ro    := find_or_create_account(p_business_id, 'Round Off', 'Indirect Income');

  -- Mirror-direction JE: Dr party (grand) / Cr Purchases + Input GST + RO
  INSERT INTO journal_entries (business_id, entry_number, date, narration,
    total_debit, total_credit, status, reference_type, reference_id, created_by)
  VALUES (p_business_id, 'JE-' || v_dn.debit_note_number, v_dn.date,
    'Debit note ' || v_dn.debit_note_number,
    round(v_dn.grand_total,2), round(v_dn.grand_total,2),
    'posted', 'debit_note', p_debit_note_id, auth.uid())
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
  VALUES (p_business_id, v_je, v_party, round(v_dn.grand_total,2), 0),
         (p_business_id, v_je, v_pur, 0, round(COALESCE(v_dn.taxable_amount,0),2)),
         (p_business_id, v_je, v_icg, 0, round(COALESCE(v_dn.cgst_amount,0),2)),
         (p_business_id, v_je, v_isg, 0, round(COALESCE(v_dn.sgst_amount,0),2)),
         (p_business_id, v_je, v_iig, 0, round(COALESCE(v_dn.igst_amount,0),2)),
         (p_business_id, v_je, v_icess, 0, round(COALESCE(v_dn.cess_amount,0),2)),
         (p_business_id, v_je, v_ro, 0,
           round(GREATEST(COALESCE(v_dn.round_off,0),0),2)),
         (p_business_id, v_je, v_ro,
           round(GREATEST(-COALESCE(v_dn.round_off,0),0),2), 0);

  -- Goods back to supplier: stock OUT per item
  IF v_dn.restock THEN
    FOR v_item IN
      SELECT product_id, ABS(quantity) AS quantity FROM debit_note_items
      WHERE debit_note_id = p_debit_note_id AND product_id IS NOT NULL
        AND quantity <> 0
    LOOP
      UPDATE products
      SET current_stock = round(COALESCE(current_stock,0) - v_item.quantity, 2)
      WHERE id = v_item.product_id
      RETURNING current_stock INTO v_newbal;

      IF v_newbal < 0 THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_item.product_id;
      END IF;

      INSERT INTO stock_movements (business_id, product_id, type, quantity,
        balance_after, reference_type, reference_id, notes, created_by)
      VALUES (p_business_id, v_item.product_id, 'purchase_return', -v_item.quantity,
        v_newbal, 'debit_note', p_debit_note_id,
        'DN ' || v_dn.debit_note_number, auth.uid());
    END LOOP;
  END IF;

  RETURN p_debit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION issue_debit_note(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION issue_debit_note(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION issue_debit_note(uuid, uuid) TO authenticated;

-- ============================================================================
-- E. APPLY RPCs (J2 paid-doc rule lives here)
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_credit_note(
  p_business_id uuid,
  p_credit_note_id uuid,
  p_refund_method text DEFAULT 'bank'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cn RECORD;
  v_inv RECORD;
  v_offset numeric(14,2);
  v_refund numeric(14,2);
  v_pay_no text;
  v_pay_id uuid;
  v_bank uuid;
  v_party uuid;
  v_je uuid;
  v_cust_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_cn FROM credit_notes
  WHERE id = p_credit_note_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found in this business';
  END IF;

  IF v_cn.status <> 'issued' THEN
    RAISE EXCEPTION 'Only issued credit notes can be applied';
  END IF;

  SELECT * INTO v_inv FROM sales_invoices
  WHERE id = v_cn.sales_invoice_id AND business_id = p_business_id
  FOR UPDATE;

  IF v_inv.status IN ('cancelled','void') THEN
    RAISE EXCEPTION 'Parent invoice is not live';
  END IF;

  v_offset := LEAST(GREATEST(v_inv.grand_total - v_inv.paid_amount, 0), v_cn.grand_total);
  v_refund := v_cn.grand_total - v_offset;

  IF v_refund > 0 THEN
    -- PAID-DOC RULE: excess routes through payments as a refund
    v_pay_no := next_document_number(p_business_id, 'payment_made', CURRENT_DATE);

    INSERT INTO payments (business_id, type, party_type, party_id, invoice_id,
      payment_number, date, amount, payment_method, notes, created_by)
    VALUES (p_business_id, 'refund', 'customer', v_cn.customer_id, v_cn.sales_invoice_id,
      v_pay_no, CURRENT_DATE, round(v_refund,2),
      CASE WHEN p_refund_method IN ('cash','upi','bank','card','cheque')
           THEN p_refund_method ELSE 'bank' END,
      'Refund for CN against ' || v_inv.invoice_number, auth.uid())
    RETURNING id INTO v_pay_id;

    -- Cash JE: Dr party ledger (clears the AR credit from issue) / Cr Bank|Cash
    SELECT c.name INTO v_cust_name FROM customers c WHERE c.id = v_cn.customer_id;
    v_party := find_or_create_account(p_business_id, v_cust_name, 'Sundry Debtors');
    v_bank  := find_or_create_account(p_business_id,
      CASE WHEN p_refund_method = 'cash' THEN 'Cash' ELSE 'Bank' END, 'Cash & Bank');

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id, 'JE-' || v_pay_no, CURRENT_DATE,
      'Refund payment ' || v_pay_no,
      round(v_refund,2), round(v_refund,2),
      'posted', 'refund', v_pay_id, auth.uid())
    RETURNING id INTO v_je;

    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_party, round(v_refund,2), 0),
           (p_business_id, v_je, v_bank, 0, round(v_refund,2));
  END IF;

  IF v_offset > 0 THEN
    UPDATE sales_invoices
    SET paid_amount = round(paid_amount + v_offset, 2),
        balance_amount = round(balance_amount - v_offset, 2),
        payment_status = CASE
          WHEN round(balance_amount - v_offset, 2) <= 0 THEN 'paid'
          WHEN paid_amount + v_offset > 0 THEN 'partial'
          ELSE payment_status END,
        status = CASE
          WHEN round(balance_amount - v_offset, 2) <= 0 THEN 'paid'
          ELSE status END,
        updated_at = now()
    WHERE id = v_cn.sales_invoice_id;
  END IF;

  UPDATE credit_notes
  SET status = 'applied', payment_id = v_pay_id, updated_at = now()
  WHERE id = p_credit_note_id;

  RETURN p_credit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_credit_note(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION apply_credit_note(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION apply_credit_note(uuid, uuid, text) TO authenticated;

-- ============================================================================
CREATE OR REPLACE FUNCTION apply_debit_note(
  p_business_id uuid,
  p_debit_note_id uuid,
  p_refund_method text DEFAULT 'bank'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dn RECORD;
  v_bill RECORD;
  v_offset numeric(14,2);
  v_refund numeric(14,2);
  v_pay_no text;
  v_pay_id uuid;
  v_bank uuid;
  v_party uuid;
  v_je uuid;
  v_supp_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_dn FROM debit_notes
  WHERE id = p_debit_note_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debit note not found in this business';
  END IF;

  IF v_dn.status <> 'issued' THEN
    RAISE EXCEPTION 'Only issued debit notes can be applied';
  END IF;

  SELECT * INTO v_bill FROM purchase_bills
  WHERE id = v_dn.purchase_bill_id AND business_id = p_business_id
  FOR UPDATE;

  IF v_bill.status IN ('cancelled') THEN
    RAISE EXCEPTION 'Parent bill is not live';
  END IF;

  v_offset := LEAST(GREATEST(v_bill.grand_total - v_bill.paid_amount, 0), v_dn.grand_total);
  v_refund := v_dn.grand_total - v_offset;

  IF v_refund > 0 THEN
    -- Supplier owes us money back: refund received
    v_pay_no := next_document_number(p_business_id, 'payment_received', CURRENT_DATE);

    INSERT INTO payments (business_id, type, party_type, party_id, bill_id,
      payment_number, date, amount, payment_method, notes, created_by)
    VALUES (p_business_id, 'refund_received', 'supplier', v_dn.supplier_id, v_dn.purchase_bill_id,
      v_pay_no, CURRENT_DATE, round(v_refund,2),
      CASE WHEN p_refund_method IN ('cash','upi','bank','card','cheque')
           THEN p_refund_method ELSE 'bank' END,
      'Supplier refund for DN against ' || v_bill.bill_number, auth.uid())
    RETURNING id INTO v_pay_id;

    SELECT s.name INTO v_supp_name FROM suppliers s WHERE s.id = v_dn.supplier_id;
    v_party := find_or_create_account(p_business_id, v_supp_name, 'Sundry Creditors');
    v_bank  := find_or_create_account(p_business_id,
      CASE WHEN p_refund_method = 'cash' THEN 'Cash' ELSE 'Bank' END, 'Cash & Bank');

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id, 'JE-' || v_pay_no, CURRENT_DATE,
      'Refund received ' || v_pay_no,
      round(v_refund,2), round(v_refund,2),
      'posted', 'refund_received', v_pay_id, auth.uid())
    RETURNING id INTO v_je;

    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_bank, round(v_refund,2), 0),
           (p_business_id, v_je, v_party, 0, round(v_refund,2));
  END IF;

  IF v_offset > 0 THEN
    UPDATE purchase_bills
    SET paid_amount = round(paid_amount + v_offset, 2),
        balance_amount = round(balance_amount - v_offset, 2),
        payment_status = CASE
          WHEN round(balance_amount - v_offset, 2) <= 0 THEN 'paid'
          WHEN paid_amount + v_offset > 0 THEN 'partial'
          ELSE payment_status END,
        status = CASE
          WHEN round(balance_amount - v_offset, 2) <= 0 THEN 'paid'
          ELSE status END,
        updated_at = now()
    WHERE id = v_dn.purchase_bill_id;
  END IF;

  UPDATE debit_notes
  SET status = 'applied', payment_id = v_pay_id, updated_at = now()
  WHERE id = p_debit_note_id;

  RETURN p_debit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_debit_note(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION apply_debit_note(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION apply_debit_note(uuid, uuid, text) TO authenticated;

-- ============================================================================
-- F. CANCEL RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_credit_note(
  p_business_id uuid,
  p_credit_note_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cn RECORD;
  v_src RECORD;
  v_je uuid;
  v_item RECORD;
  v_bal numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_cn FROM credit_notes
  WHERE id = p_credit_note_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found in this business';
  END IF;

  IF v_cn.status = 'applied' THEN
    RAISE EXCEPTION 'Applied credit notes cannot be cancelled';
  END IF;

  IF v_cn.status = 'cancelled' THEN
    RETURN p_credit_note_id;
  END IF;

  IF v_cn.status = 'issued' THEN
    -- Mirror-cancellation JE: read the actually-posted lines, swap sides
    IF EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'credit_note_cancellation'
        AND reference_id = p_credit_note_id AND status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Credit note already cancelled';
    END IF;

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    SELECT business_id, 'JE-CXL-' || v_cn.credit_note_number, CURRENT_DATE,
      'Cancellation of CN ' || v_cn.credit_note_number,
      sum(debit_amount), sum(credit_amount), 'posted',
      'credit_note_cancellation', p_credit_note_id, auth.uid()
    FROM journal_entry_lines
    WHERE entry_id IN (
      SELECT id FROM journal_entries
      WHERE reference_type = 'credit_note' AND reference_id = p_credit_note_id
        AND status = 'posted')
    GROUP BY business_id
    RETURNING id INTO v_je;

    FOR v_src IN
      SELECT l.account_id, l.debit_amount, l.credit_amount
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.reference_type = 'credit_note'
        AND e.reference_id = p_credit_note_id AND e.status = 'posted'
    LOOP
      INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
      VALUES (p_business_id, v_je, v_src.account_id, v_src.credit_amount, v_src.debit_amount);
    END LOOP;

    -- Reverse restored stock
    IF v_cn.restock THEN
      FOR v_item IN
        SELECT product_id, quantity FROM credit_note_items
        WHERE credit_note_id = p_credit_note_id AND product_id IS NOT NULL
          AND quantity > 0
      LOOP
        UPDATE products
        SET current_stock = round(COALESCE(current_stock,0) - v_item.quantity, 2)
        WHERE id = v_item.product_id
        RETURNING current_stock INTO v_bal;

        INSERT INTO stock_movements (business_id, product_id, type, quantity,
          balance_after, reference_type, reference_id, notes, created_by)
        VALUES (p_business_id, v_item.product_id, 'adjustment_out', -v_item.quantity,
          v_bal, 'credit_note_cancellation', p_credit_note_id,
          'CN cancellation ' || v_cn.credit_note_number, auth.uid());
      END LOOP;
    END IF;
  END IF;

  UPDATE credit_notes
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_credit_note_id;

  RETURN p_credit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_credit_note(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_credit_note(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_credit_note(uuid, uuid) TO authenticated;

-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_debit_note(
  p_business_id uuid,
  p_debit_note_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dn RECORD;
  v_src RECORD;
  v_je uuid;
  v_item RECORD;
  v_bal numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_dn FROM debit_notes
  WHERE id = p_debit_note_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Debit note not found in this business';
  END IF;

  IF v_dn.status = 'applied' THEN
    RAISE EXCEPTION 'Applied debit notes cannot be cancelled';
  END IF;

  IF v_dn.status = 'cancelled' THEN
    RETURN p_debit_note_id;
  END IF;

  IF v_dn.status = 'issued' THEN
    IF EXISTS (
      SELECT 1 FROM journal_entries
      WHERE reference_type = 'debit_note_cancellation'
        AND reference_id = p_debit_note_id AND status = 'posted'
    ) THEN
      RAISE EXCEPTION 'Debit note already cancelled';
    END IF;

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    SELECT business_id, 'JE-CXL-' || v_dn.debit_note_number, CURRENT_DATE,
      'Cancellation of DN ' || v_dn.debit_note_number,
      sum(debit_amount), sum(credit_amount), 'posted',
      'debit_note_cancellation', p_debit_note_id, auth.uid()
    FROM journal_entry_lines
    WHERE entry_id IN (
      SELECT id FROM journal_entries
      WHERE reference_type = 'debit_note' AND reference_id = p_debit_note_id
        AND status = 'posted')
    GROUP BY business_id
    RETURNING id INTO v_je;

    FOR v_src IN
      SELECT l.account_id, l.debit_amount, l.credit_amount
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.reference_type = 'debit_note'
        AND e.reference_id = p_debit_note_id AND e.status = 'posted'
    LOOP
      INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
      VALUES (p_business_id, v_je, v_src.account_id, v_src.credit_amount, v_src.debit_amount);
    END LOOP;

    IF v_dn.restock THEN
      FOR v_item IN
        SELECT product_id, ABS(quantity) AS quantity FROM debit_note_items
        WHERE debit_note_id = p_debit_note_id AND product_id IS NOT NULL
          AND quantity <> 0
      LOOP
        UPDATE products
        SET current_stock = round(COALESCE(current_stock,0) + v_item.quantity, 2)
        WHERE id = v_item.product_id
        RETURNING current_stock INTO v_bal;

        INSERT INTO stock_movements (business_id, product_id, type, quantity,
          balance_after, reference_type, reference_id, notes, created_by)
        VALUES (p_business_id, v_item.product_id, 'adjustment_in', v_item.quantity,
          v_bal, 'debit_note_cancellation', p_debit_note_id,
          'DN cancellation ' || v_dn.debit_note_number, auth.uid());
      END LOOP;
    END IF;
  END IF;

  UPDATE debit_notes
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_debit_note_id;

  RETURN p_debit_note_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_debit_note(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_debit_note(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_debit_note(uuid, uuid) TO authenticated;
