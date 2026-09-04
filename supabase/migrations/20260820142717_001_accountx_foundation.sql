/*
# AccountX Foundation Schema

## Overview
Creates the complete foundation for AccountX, an Indian business accounting platform.
Covers identity, multi-business, parties, products, inventory, sales, purchases,
payments, expenses, accounting infrastructure, and system tables.

## Tables Created (20 tables)
1. businesses, 2. business_members, 3. settings, 4. customers, 5. suppliers,
6. product_categories, 7. warehouses, 8. products, 9. stock_movements,
10. sales_invoices, 11. sales_invoice_items, 12. purchase_bills, 13. purchase_bill_items,
14. payments, 15. expense_categories, 16. expenses,
17. accounts, 18. journal_entries, 19. journal_entry_lines, 20. audit_logs

## Security
- RLS enabled on EVERY table, all scoped by business membership
- Owner/admin/manager/accountant/staff can write; viewers read-only
- Policies use auth.uid() for ownership, never current_user
- Two SECURITY DEFINER helper functions for membership checks
*/

-- ============================================================================
-- 1. BUSINESSES (created first so helper functions can reference it)
-- ============================================================================
CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  legal_name text,
  business_type text DEFAULT 'trading',
  phone text,
  email text,
  address text,
  city text,
  state text,
  country text DEFAULT 'India',
  gstin text,
  pan text,
  financial_year text DEFAULT '2026-27',
  currency text DEFAULT 'INR',
  currency_symbol text DEFAULT '₹',
  invoice_prefix text DEFAULT 'INV',
  logo_url text,
  gst_registered boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 2. BUSINESS MEMBERS (RBAC)
-- ============================================================================
CREATE TABLE IF NOT EXISTS business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'admin', 'manager', 'accountant', 'sales_staff', 'purchase_staff', 'inventory_staff', 'viewer')),
  is_active boolean DEFAULT true,
  invited_at timestamptz DEFAULT now(),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(business_id, user_id)
);

-- ============================================================================
-- HELPER: business membership check
-- ============================================================================
CREATE OR REPLACE FUNCTION is_business_member(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id
      AND user_id = auth.uid()
      AND is_active = true
  );
$$;

-- ============================================================================
-- HELPER: business write check
-- ============================================================================
CREATE OR REPLACE FUNCTION can_write_business(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id
      AND user_id = auth.uid()
      AND is_active = true
      AND role IN ('owner', 'admin', 'manager', 'accountant', 'sales_staff', 'purchase_staff', 'inventory_staff')
  );
$$;

-- ============================================================================
-- Enable RLS on businesses + business_members
-- ============================================================================
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "businesses_select" ON businesses;
CREATE POLICY "businesses_select" ON businesses FOR SELECT
  TO authenticated USING (is_business_member(businesses.id));

DROP POLICY IF EXISTS "businesses_insert" ON businesses;
CREATE POLICY "businesses_insert" ON businesses FOR INSERT
  TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "businesses_update" ON businesses;
CREATE POLICY "businesses_update" ON businesses FOR UPDATE
  TO authenticated USING (is_business_member(businesses.id))
  WITH CHECK (is_business_member(businesses.id));

ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_select" ON business_members;
CREATE POLICY "members_select" ON business_members FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "members_insert" ON business_members;
CREATE POLICY "members_insert" ON business_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  );

DROP POLICY IF EXISTS "members_update" ON business_members;
CREATE POLICY "members_update" ON business_members FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  );

-- ============================================================================
-- 3. SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, key)
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select" ON settings;
CREATE POLICY "settings_select" ON settings FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "settings_insert" ON settings;
CREATE POLICY "settings_insert" ON settings FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "settings_update" ON settings;
CREATE POLICY "settings_update" ON settings FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

-- ============================================================================
-- 4. CUSTOMERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  company_name text,
  phone text,
  email text,
  gstin text,
  pan text,
  address text,
  city text,
  state text,
  country text DEFAULT 'India',
  pincode text,
  opening_balance numeric(14,2) DEFAULT 0,
  current_balance numeric(14,2) DEFAULT 0,
  credit_limit numeric(14,2) DEFAULT 0,
  total_sales numeric(14,2) DEFAULT 0,
  total_paid numeric(14,2) DEFAULT 0,
  last_transaction_date timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select" ON customers;
CREATE POLICY "customers_select" ON customers FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY "customers_insert" ON customers FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY "customers_update" ON customers FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "customers_delete" ON customers;
CREATE POLICY "customers_delete" ON customers FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(business_id, name);

-- ============================================================================
-- 5. SUPPLIERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  company_name text,
  phone text,
  email text,
  gstin text,
  pan text,
  address text,
  city text,
  state text,
  country text DEFAULT 'India',
  pincode text,
  opening_balance numeric(14,2) DEFAULT 0,
  current_balance numeric(14,2) DEFAULT 0,
  total_purchases numeric(14,2) DEFAULT 0,
  total_paid numeric(14,2) DEFAULT 0,
  last_transaction_date timestamptz,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_select" ON suppliers;
CREATE POLICY "suppliers_select" ON suppliers FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "suppliers_insert" ON suppliers;
CREATE POLICY "suppliers_insert" ON suppliers FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "suppliers_update" ON suppliers;
CREATE POLICY "suppliers_update" ON suppliers FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "suppliers_delete" ON suppliers;
CREATE POLICY "suppliers_delete" ON suppliers FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers(business_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(business_id, name);

-- ============================================================================
-- 6. PRODUCT CATEGORIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select" ON product_categories;
CREATE POLICY "categories_select" ON product_categories FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "categories_insert" ON product_categories;
CREATE POLICY "categories_insert" ON product_categories FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "categories_update" ON product_categories;
CREATE POLICY "categories_update" ON product_categories FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "categories_delete" ON product_categories;
CREATE POLICY "categories_delete" ON product_categories FOR DELETE
  TO authenticated USING (can_write_business(business_id));

-- ============================================================================
-- 7. WAREHOUSES
-- ============================================================================
CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  city text,
  state text,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouses_select" ON warehouses;
CREATE POLICY "warehouses_select" ON warehouses FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "warehouses_insert" ON warehouses;
CREATE POLICY "warehouses_insert" ON warehouses FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "warehouses_update" ON warehouses;
CREATE POLICY "warehouses_update" ON warehouses FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "warehouses_delete" ON warehouses;
CREATE POLICY "warehouses_delete" ON warehouses FOR DELETE
  TO authenticated USING (can_write_business(business_id));

-- ============================================================================
-- 8. PRODUCTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  barcode text,
  type text DEFAULT 'product' CHECK (type IN ('product', 'service')),
  hsn_sac text,
  unit text DEFAULT 'PCS',
  purchase_price numeric(14,2) DEFAULT 0,
  selling_price numeric(14,2) DEFAULT 0,
  tax_rate numeric(5,2) DEFAULT 0,
  tax_inclusive boolean DEFAULT false,
  opening_stock numeric(14,2) DEFAULT 0,
  current_stock numeric(14,2) DEFAULT 0,
  minimum_stock numeric(14,2) DEFAULT 0,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  description text,
  image_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select" ON products;
CREATE POLICY "products_select" ON products FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "products_insert" ON products;
CREATE POLICY "products_insert" ON products FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "products_update" ON products;
CREATE POLICY "products_update" ON products FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "products_delete" ON products;
CREATE POLICY "products_delete" ON products FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(business_id, name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(business_id, sku);

-- ============================================================================
-- 9. STOCK MOVEMENTS (immutable audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('opening', 'purchase', 'sale', 'sale_return', 'purchase_return', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out')),
  quantity numeric(14,2) NOT NULL,
  balance_after numeric(14,2) DEFAULT 0,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "stock_movements_insert" ON stock_movements;
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_stock_movements_business ON stock_movements(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(business_id, created_at DESC);

-- ============================================================================
-- 10. SALES INVOICES
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  place_of_supply text,
  subtotal numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  paid_amount numeric(14,2) DEFAULT 0,
  balance_amount numeric(14,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'void')),
  payment_method text,
  notes text,
  terms text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, invoice_number)
);

ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_invoices_select" ON sales_invoices;
CREATE POLICY "sales_invoices_select" ON sales_invoices FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "sales_invoices_insert" ON sales_invoices;
CREATE POLICY "sales_invoices_insert" ON sales_invoices FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "sales_invoices_update" ON sales_invoices;
CREATE POLICY "sales_invoices_update" ON sales_invoices FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "sales_invoices_delete" ON sales_invoices;
CREATE POLICY "sales_invoices_delete" ON sales_invoices FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_sales_invoices_business ON sales_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_date ON sales_invoices(business_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(business_id, customer_id);

-- ============================================================================
-- 11. SALES INVOICE ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
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

ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_invoice_items_select" ON sales_invoice_items;
CREATE POLICY "sales_invoice_items_select" ON sales_invoice_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "sales_invoice_items_insert" ON sales_invoice_items;
CREATE POLICY "sales_invoice_items_insert" ON sales_invoice_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "sales_invoice_items_update" ON sales_invoice_items;
CREATE POLICY "sales_invoice_items_update" ON sales_invoice_items FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "sales_invoice_items_delete" ON sales_invoice_items;
CREATE POLICY "sales_invoice_items_delete" ON sales_invoice_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice ON sales_invoice_items(invoice_id);

-- ============================================================================
-- 12. PURCHASE BILLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  bill_number text NOT NULL,
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  paid_amount numeric(14,2) DEFAULT 0,
  balance_amount numeric(14,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'partially_paid', 'paid', 'cancelled')),
  payment_method text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, bill_number)
);

ALTER TABLE purchase_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_bills_select" ON purchase_bills;
CREATE POLICY "purchase_bills_select" ON purchase_bills FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "purchase_invoices_insert" ON purchase_bills;
CREATE POLICY "purchase_invoices_insert" ON purchase_bills FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "purchase_bills_update" ON purchase_bills;
CREATE POLICY "purchase_bills_update" ON purchase_bills FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "purchase_bills_delete" ON purchase_bills;
CREATE POLICY "purchase_bills_delete" ON purchase_bills FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_purchase_bills_business ON purchase_bills(business_id);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_date ON purchase_bills(business_id, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_bills_supplier ON purchase_bills(business_id, supplier_id);

-- ============================================================================
-- 13. PURCHASE BILL ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
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

ALTER TABLE purchase_bill_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_bill_items_select" ON purchase_bill_items;
CREATE POLICY "purchase_bill_items_select" ON purchase_bill_items FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "purchase_bill_items_insert" ON purchase_bill_items;
CREATE POLICY "purchase_bill_items_insert" ON purchase_bill_items FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "purchase_bill_items_update" ON purchase_bill_items;
CREATE POLICY "purchase_bill_items_update" ON purchase_bill_items FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "purchase_bill_items_delete" ON purchase_bill_items;
CREATE POLICY "purchase_bill_items_delete" ON purchase_bill_items FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_purchase_bill_items_bill ON purchase_bill_items(bill_id);

-- ============================================================================
-- 14. PAYMENTS (received + made)
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('received', 'made')),
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id uuid NOT NULL,
  invoice_id uuid REFERENCES sales_invoices(id) ON DELETE SET NULL,
  bill_id uuid REFERENCES purchase_bills(id) ON DELETE SET NULL,
  payment_number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL,
  payment_method text DEFAULT 'cash' CHECK (payment_method IN ('cash', 'upi', 'bank', 'card', 'credit', 'cheque')),
  reference text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, payment_number)
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "payments_delete" ON payments;
CREATE POLICY "payments_delete" ON payments FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_payments_business ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(business_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(business_id, party_id);

-- ============================================================================
-- 15. EXPENSE CATEGORIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_categories_select" ON expense_categories;
CREATE POLICY "expense_categories_select" ON expense_categories FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "expense_categories_insert" ON expense_categories;
CREATE POLICY "expense_categories_insert" ON expense_categories FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "expense_categories_update" ON expense_categories;
CREATE POLICY "expense_categories_update" ON expense_categories FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "expense_categories_delete" ON expense_categories;
CREATE POLICY "expense_categories_delete" ON expense_categories FOR DELETE
  TO authenticated USING (can_write_business(business_id));

-- ============================================================================
-- 16. EXPENSES
-- ============================================================================
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expense_number text NOT NULL,
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  payment_method text DEFAULT 'cash',
  reference text,
  notes text,
  attachment_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, expense_number)
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY "expenses_select" ON expenses FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "expenses_insert" ON expenses;
CREATE POLICY "expenses_insert" ON expenses FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "expenses_update" ON expenses;
CREATE POLICY "expenses_update" ON expenses FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "expenses_delete" ON expenses;
CREATE POLICY "expenses_delete" ON expenses FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(business_id, date DESC);

-- ============================================================================
-- 17. ACCOUNTS (Chart of Accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  group_name text NOT NULL DEFAULT 'Current Assets'
    CHECK (group_name IN ('Current Assets', 'Fixed Assets', 'Current Liabilities', 'Long-term Liabilities', 'Capital Account', 'Direct Income', 'Indirect Income', 'Direct Expense', 'Indirect Expense', 'Sundry Debtors', 'Sundry Creditors', 'Cash & Bank')),
  name text NOT NULL,
  code text,
  opening_balance numeric(14,2) DEFAULT 0,
  current_balance numeric(14,2) DEFAULT 0,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_select" ON accounts;
CREATE POLICY "accounts_select" ON accounts FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "accounts_insert" ON accounts;
CREATE POLICY "accounts_insert" ON accounts FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "accounts_update" ON accounts;
CREATE POLICY "accounts_update" ON accounts FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "accounts_delete" ON accounts;
CREATE POLICY "accounts_delete" ON accounts FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_accounts_business ON accounts(business_id);

-- ============================================================================
-- 18. JOURNAL ENTRIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entry_number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  reference_type text,
  reference_id uuid,
  narration text,
  total_debit numeric(14,2) DEFAULT 0,
  total_credit numeric(14,2) DEFAULT 0,
  status text DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, entry_number)
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "journal_entries_select" ON journal_entries;
CREATE POLICY "journal_entries_select" ON journal_entries FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "journal_entries_insert" ON journal_entries;
CREATE POLICY "journal_entries_insert" ON journal_entries FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "journal_entries_update" ON journal_entries;
CREATE POLICY "journal_entries_update" ON journal_entries FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "journal_entries_delete" ON journal_entries;
CREATE POLICY "journal_entries_delete" ON journal_entries FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_journal_entries_business ON journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(business_id, date DESC);

-- ============================================================================
-- 19. JOURNAL ENTRY LINES
-- ============================================================================
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  account_name text NOT NULL,
  debit_amount numeric(14,2) DEFAULT 0,
  credit_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "journal_entry_lines_select" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_select" ON journal_entry_lines FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "journal_entry_lines_insert" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_insert" ON journal_entry_lines FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "journal_entry_lines_update" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_update" ON journal_entry_lines FOR UPDATE
  TO authenticated USING (is_business_member(business_id))
  WITH CHECK (can_write_business(business_id));

DROP POLICY IF EXISTS "journal_entry_lines_delete" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_delete" ON journal_entry_lines FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines(entry_id);

-- ============================================================================
-- 20. AUDIT LOGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (is_business_member(business_id));

CREATE INDEX IF NOT EXISTS idx_audit_logs_business ON audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(business_id, created_at DESC);

-- ============================================================================
-- TRIGGER: update updated_at timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_businesses_updated') THEN
    CREATE TRIGGER trg_businesses_updated BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_updated') THEN
    CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_suppliers_updated') THEN
    CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_updated') THEN
    CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_invoices_updated') THEN
    CREATE TRIGGER trg_sales_invoices_updated BEFORE UPDATE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_purchase_bills_updated') THEN
    CREATE TRIGGER trg_purchase_bills_updated BEFORE UPDATE ON purchase_bills FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_updated') THEN
    CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_expenses_updated') THEN
    CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END
$$;
