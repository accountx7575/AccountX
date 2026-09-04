/*
# 026 — Quotes / Sales Orders / Purchase Orders schema (T33)

Numbering: document_sequences doc_type CHECK extended with
'quotation','sales_order','purchase_order' (dynamic constraint discovery);
next_document_number re-emitted body-identical plus prefixes
QT / SO / PO. NO stock impact anywhere on this card — conversion RPCs are
a later card; these documents never touch products or stock_movements.

STATUS MACHINES (J2-family conventions: linear live path, immutable once
converted, cancellation blocked after downstream commitment):
- quotations:       draft -> sent -> accepted | rejected -> converted;
                    cancelled from draft/sent/accepted pre-conversion.
- sales_orders:     draft -> confirmed -> fulfilled -> converted;
                    cancelled from draft/confirmed pre-fulfilment.
- purchase_orders:  draft -> confirmed -> received -> converted;
                    cancelled from draft/confirmed pre-receipt.
('converted' rows carry converted_doc_id pointing at the downstream
document; terminal states are final.)

Tables mirror the invoice/bill family: party FK RESTRICT, full tax-totals
header block, per-item original structure with product refs (nullable —
quotes may be free-text lines), created_by/audit stamps,
UNIQUE(business_id, <number>), RLS four-policy house pattern, indexes.
*/

-- ============================================================================
-- A. NUMBERING EXTENSION
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
  'credit_note','debit_note','expense',
  'quotation','sales_order','purchase_order'));

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
    WHEN 'quotation' THEN 'QT'
    WHEN 'sales_order' THEN 'SO'
    WHEN 'purchase_order' THEN 'PO'
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
-- B. QUOTATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quotation_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  quote_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date,
  subtotal numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','rejected','converted','cancelled')),
  terms text,
  notes text,
  converted_doc_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, quotation_number)
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  hsn_sac text,
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  unit text DEFAULT 'PCS',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  tax_rate numeric(5,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- C. SALES ORDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  subtotal numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','fulfilled','converted','cancelled')),
  notes text,
  converted_doc_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, order_number)
);

CREATE TABLE IF NOT EXISTS sales_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  hsn_sac text,
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  unit text DEFAULT 'PCS',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  tax_rate numeric(5,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- D. PURCHASE ORDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date,
  subtotal numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','received','converted','cancelled')),
  notes text,
  converted_doc_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, order_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  hsn_sac text,
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  unit text DEFAULT 'PCS',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  tax_rate numeric(5,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- E. RLS + INDEXES (house pattern)
-- ============================================================================
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotations_select" ON quotations FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "quotations_insert" ON quotations FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "quotations_update" ON quotations FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "quotations_delete" ON quotations FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "quotation_items_select" ON quotation_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "quotation_items_insert" ON quotation_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "quotation_items_update" ON quotation_items FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "quotation_items_delete" ON quotation_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "sales_orders_select" ON sales_orders FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "sales_orders_insert" ON sales_orders FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "sales_orders_update" ON sales_orders FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "sales_orders_delete" ON sales_orders FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "sales_order_items_select" ON sales_order_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "sales_order_items_insert" ON sales_order_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "sales_order_items_update" ON sales_order_items FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "sales_order_items_delete" ON sales_order_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "purchase_orders_select" ON purchase_orders FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "purchase_orders_insert" ON purchase_orders FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "purchase_orders_update" ON purchase_orders FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "purchase_orders_delete" ON purchase_orders FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE POLICY "purchase_order_items_select" ON purchase_order_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "purchase_order_items_insert" ON purchase_order_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "purchase_order_items_update" ON purchase_order_items FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "purchase_order_items_delete" ON purchase_order_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_quotations_business ON quotations(business_id);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_business ON sales_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_business ON purchase_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(business_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
