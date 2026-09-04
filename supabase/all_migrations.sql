-- Disable mutation trigger temporarily for migration setup
ALTER TABLE IF EXISTS stock_movements DISABLE TRIGGER USER;
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
  currency_symbol text DEFAULT 'â‚¹',
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

/*
# Fix RLS deadlock on business creation

## Problem
When a new user creates their first business, the flow is:
1. INSERT into `businesses` (allowed by `businesses_insert` policy: `owner_id = auth.uid()`)
2. INSERT into `business_members` with role='owner'

Step 2 FAILS because `members_insert` policy requires an existing owner/admin
member in the business â€” but the business was just created and has no members
yet. This is a chicken-and-egg RLS deadlock that blocks all business creation.

## Fix
Create a SECURITY DEFINER function `create_business_with_owner` that:
- Inserts the business row
- Inserts the owner membership row
- Seeds default warehouse, accounts, and expense categories
- Returns the new business record

SECURITY DEFINER runs with the function owner's privileges (bypassing RLS),
so both inserts succeed atomically. The function validates `auth.uid()` itself
to ensure only the authenticated user becomes the owner.

## Security
- Function is SECURITY DEFINER with fixed `search_path = public`
- Only callable by `authenticated` role
- Validates that the caller is authenticated via `auth.uid()`
- Uses the caller's uid as owner_id â€” cannot create businesses for other users
- All RLS policies remain enabled and enforced for normal CRUD operations
*/

-- ============================================================================
-- Function: create_business_with_owner
-- Atomically creates a business + owner membership + seed data
-- ============================================================================
CREATE OR REPLACE FUNCTION create_business_with_owner(
  p_name text,
  p_legal_name text DEFAULT NULL,
  p_business_type text DEFAULT 'trading',
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT 'Maharashtra',
  p_gstin text DEFAULT NULL,
  p_pan text DEFAULT NULL,
  p_financial_year text DEFAULT '2026-27',
  p_currency text DEFAULT 'INR',
  p_currency_symbol text DEFAULT 'â‚¹',
  p_invoice_prefix text DEFAULT 'INV',
  p_gst_registered boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_owner_id uuid := auth.uid();
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the business
  INSERT INTO businesses (
    owner_id, name, legal_name, business_type, phone, email, address,
    city, state, gstin, pan, financial_year, currency, currency_symbol,
    invoice_prefix, gst_registered
  ) VALUES (
    v_owner_id, p_name, p_legal_name, p_business_type, p_phone, p_email, p_address,
    p_city, p_state, p_gstin, p_pan, p_financial_year, p_currency, p_currency_symbol,
    p_invoice_prefix, p_gst_registered
  )
  RETURNING id INTO v_business_id;

  -- Create owner membership
  INSERT INTO business_members (business_id, user_id, role, is_active)
  VALUES (v_business_id, v_owner_id, 'owner', true);

  -- Seed default warehouse
  INSERT INTO warehouses (business_id, name, is_default)
  VALUES (v_business_id, 'Main Warehouse', true);

  -- Seed default chart of accounts
  INSERT INTO accounts (business_id, group_name, name, is_system) VALUES
    (v_business_id, 'Cash & Bank', 'Cash In Hand', true),
    (v_business_id, 'Cash & Bank', 'Bank Account', true),
    (v_business_id, 'Direct Income', 'Sales Account', true),
    (v_business_id, 'Direct Expense', 'Purchase Account', true),
    (v_business_id, 'Indirect Expense', 'Rent Expense', true),
    (v_business_id, 'Indirect Expense', 'Salary Expense', true),
    (v_business_id, 'Indirect Expense', 'Electricity Expense', true);

  -- Seed default expense categories
  INSERT INTO expense_categories (business_id, name) VALUES
    (v_business_id, 'Rent'),
    (v_business_id, 'Electricity'),
    (v_business_id, 'Salary'),
    (v_business_id, 'Transport'),
    (v_business_id, 'Marketing'),
    (v_business_id, 'Office'),
    (v_business_id, 'Telephone'),
    (v_business_id, 'Internet'),
    (v_business_id, 'Other');

  RETURN v_business_id;
END;
$$;

-- Grant execute to authenticated only
GRANT EXECUTE ON FUNCTION create_business_with_owner TO authenticated;

/*
# Fix security advisor warnings

## Changes
1. Revoke EXECUTE from anon role on all SECURITY DEFINER functions
   - create_business_with_owner: only authenticated users should create businesses
   - is_business_member: only authenticated users need membership checks
   - can_write_business: only authenticated users need write checks
2. Fix search_path on update_updated_at trigger function
*/

-- Revoke anon execute on SECURITY DEFINER helper functions
REVOKE EXECUTE ON FUNCTION is_business_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION can_write_business(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION create_business_with_owner FROM anon;

-- Fix mutable search_path on update_updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

/*
# Fix function execute permissions

Functions default to PUBLIC execute. REVOKE FROM PUBLIC then GRANT only
to authenticated so anon and unauthenticated users cannot call them.
*/

REVOKE EXECUTE ON FUNCTION is_business_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION can_write_business(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_business_with_owner FROM PUBLIC;

GRANT EXECUTE ON FUNCTION is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_write_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION create_business_with_owner TO authenticated;

/*
# Double-Entry Accounting Engine

## Overview
Adds server-side enforcement for double-entry accounting rules and
balance recalculation. Keeps all existing RLS policies intact.

## New Database Objects

### Function: post_journal_entry(p_business_id, p_date, p_narration, p_reference_type, p_reference_id, p_lines)
SECURITY DEFINER function that atomically:
1. Validates the caller is a business member with write access
2. Validates total_debit = total_credit (balanced entry)
3. Validates every line has an account and at least one nonzero amount
4. Validates no line has both debit and credit > 0
5. Generates a sequential entry_number (JE/YYYY/NNNN)
6. Inserts the journal_entries row (status='posted')
7. Inserts all journal_entry_lines rows
8. Updates each affected account's current_balance by adding the net movement

### Function: get_trial_balance(p_business_id, p_to_date)
SECURITY DEFINER function that returns one row per account with:
- account id, name, group_name, code
- opening_balance
- total debit and credit movements in the period
- closing balance (opening + debit - credit for debit-natured groups,
  opening + credit - debit for credit-natured groups)
This is the single source of truth for trial balance and ledger closing.

## Security
- Both functions are SECURITY DEFINER with fixed search_path = public
- EXECUTE revoked from PUBLIC, granted only to authenticated
- post_journal_entry checks can_write_business() before posting
- get_trial_balance checks is_business_member() before returning data
- All existing RLS policies remain unchanged and enforced
- No service-role keys needed; runs as the caller's JWT-authenticated session
*/

-- ============================================================================
-- Helper: account nature (debit vs credit) by group
-- ============================================================================
CREATE OR REPLACE FUNCTION account_nature(p_group_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_group_name IN (
      'Current Assets', 'Fixed Assets', 'Direct Expense',
      'Indirect Expense', 'Sundry Debtors', 'Cash & Bank'
    ) THEN 'debit'
    WHEN p_group_name IN (
      'Current Liabilities', 'Long-term Liabilities', 'Capital Account',
      'Direct Income', 'Indirect Income', 'Sundry Creditors'
    ) THEN 'credit'
    ELSE 'debit'
  END;
$$;

-- ============================================================================
-- Function: post_journal_entry
-- Atomically posts a balanced journal entry and updates account balances
-- ============================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id uuid,
  p_date date,
  p_narration text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_seq int;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_line jsonb;
  v_account_id uuid;
  v_account_name text;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_nature text;
  v_movement numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Journal entry must have at least one line';
  END IF;

  -- Validate lines and compute totals
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_account_id := v_line->>'account_id';
    v_debit := COALESCE((v_line->>'debit_amount')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit_amount')::numeric, 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Every line must have an account';
    END IF;

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Amounts cannot be negative';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'A line cannot have both debit and credit amounts';
    END IF;

    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'Every line must have a nonzero amount';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  v_total_debit := round(v_total_debit, 2);
  v_total_credit := round(v_total_credit, 2);

  IF v_total_debit != v_total_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced. Total debit % does not equal total credit %', v_total_debit, v_total_credit;
  END IF;

  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'Journal entry must have a nonzero total';
  END IF;

  -- Generate sequential entry number
  SELECT COALESCE(max(
    CASE
      WHEN entry_number ~ '^JE/[0-9]{4}/[0-9]+$'
        THEN substring(entry_number from '[0-9]+$')::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM journal_entries
  WHERE business_id = p_business_id
    AND entry_number ~ ('^JE/' || extract(year from p_date)::text || '/[0-9]+$');

  v_entry_number := 'JE/' || extract(year from p_date)::text || '/' || lpad(v_seq::text, 4, '0');

  -- Insert the journal entry
  INSERT INTO journal_entries (
    business_id, entry_number, date, reference_type, reference_id,
    narration, total_debit, total_credit, status, created_by
  ) VALUES (
    p_business_id, v_entry_number, p_date, p_reference_type, p_reference_id,
    p_narration, v_total_debit, v_total_credit, 'posted', auth.uid()
  )
  RETURNING id INTO v_entry_id;

  -- Insert lines and update account balances
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_account_id := v_line->>'account_id';
    v_debit := COALESCE((v_line->>'debit_amount')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit_amount')::numeric, 0);

    SELECT name INTO v_account_name FROM accounts WHERE id = v_account_id;

    INSERT INTO journal_entry_lines (
      business_id, entry_id, account_id, account_name,
      debit_amount, credit_amount
    ) VALUES (
      p_business_id, v_entry_id, v_account_id, v_account_name,
      v_debit, v_credit
    );

    -- Update account current_balance
    -- For debit-natured accounts: debit increases, credit decreases
    -- For credit-natured accounts: credit increases, debit decreases
    SELECT account_nature(group_name) INTO v_nature FROM accounts WHERE id = v_account_id;

    IF v_nature = 'debit' THEN
      v_movement := v_debit - v_credit;
    ELSE
      v_movement := v_credit - v_debit;
    END IF;

    UPDATE accounts
    SET current_balance = round(COALESCE(current_balance, 0) + v_movement, 2)
    WHERE id = v_account_id;
  END LOOP;

  RETURN v_entry_id;
END;
$$;

-- ============================================================================
-- Function: get_trial_balance
-- Returns per-account opening, movements, and closing balances
-- ============================================================================
CREATE OR REPLACE FUNCTION get_trial_balance(
  p_business_id uuid,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  account_name text,
  group_name text,
  code text,
  opening_balance numeric,
  period_debit numeric,
  period_credit numeric,
  closing_balance numeric,
  nature text
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
  SELECT
    a.id,
    a.name,
    a.group_name,
    a.code,
    COALESCE(a.opening_balance, 0)::numeric AS opening_balance,
    COALESCE(mov.debit_sum, 0)::numeric AS period_debit,
    COALESCE(mov.credit_sum, 0)::numeric AS period_credit,
    (
      COALESCE(a.opening_balance, 0) +
      CASE
        WHEN account_nature(a.group_name) = 'debit'
          THEN COALESCE(mov.debit_sum, 0) - COALESCE(mov.credit_sum, 0)
        ELSE COALESCE(mov.credit_sum, 0) - COALESCE(mov.debit_sum, 0)
      END
    )::numeric AS closing_balance,
    account_nature(a.group_name) AS nature
  FROM accounts a
  LEFT JOIN LATERAL (
    SELECT
      sum(l.debit_amount) AS debit_sum,
      sum(l.credit_amount) AS credit_sum
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = a.id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
      AND (p_to_date IS NULL OR e.date <= p_to_date)
  ) mov ON true
  WHERE a.business_id = p_business_id
  ORDER BY a.group_name, a.name;
END;
$$;

-- Revoke public execute, grant to authenticated only
REVOKE EXECUTE ON FUNCTION post_journal_entry FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_trial_balance FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_nature(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION post_journal_entry TO authenticated;
GRANT EXECUTE ON FUNCTION get_trial_balance TO authenticated;

/*
# Revoke anon execute on accounting functions

The previous REVOKE FROM PUBLIC didn't fully remove anon access.
Explicitly revoke from the anon role directly.
*/

REVOKE EXECUTE ON FUNCTION post_journal_entry FROM anon;
REVOKE EXECUTE ON FUNCTION get_trial_balance FROM anon;
REVOKE EXECUTE ON FUNCTION account_nature(text) FROM anon;

/*
# Sales & Purchase Journal Integration

Adds two SECURITY DEFINER functions that post the accounting journal entry
for a sales invoice or purchase bill, atomically and duplicate-safe.

## post_sales_invoice_journal(p_invoice_id)
- Loads the invoice (must be status='issued')
- Checks no existing journal entry with reference_type='sales_invoice' + reference_id = invoice id
- Finds or creates a Sundry Debtors account named after the customer
- Finds or creates a Direct Income account named 'Sales'
- Posts a balanced journal entry: debit customer/receivable, credit sales
- Links via reference_type='sales_invoice', reference_id=invoice_id
- Returns the journal entry id

## post_purchase_bill_journal(p_bill_id)
- Loads the bill (must be status='confirmed')
- Checks no existing journal entry with reference_type='purchase_bill' + reference_id = bill id
- Finds or creates a Sundry Creditors account named after the supplier
- Finds or creates a Direct Expense account named 'Purchases'
- Posts a balanced journal entry: debit purchases, credit supplier/payable
- Links via reference_type='purchase_bill', reference_id=bill_id
- Returns the journal entry id

## Security
- Both functions SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

-- ============================================================================
-- Helper: find or create an account for a business
-- ============================================================================
CREATE OR REPLACE FUNCTION find_or_create_account(
  p_business_id uuid,
  p_name text,
  p_group_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id
  FROM accounts
  WHERE business_id = p_business_id AND name = p_name
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  INSERT INTO accounts (business_id, name, group_name, opening_balance, current_balance, is_system)
  VALUES (p_business_id, p_name, p_group_name, 0, 0, false)
  ON CONFLICT (business_id, name) DO NOTHING
  RETURNING id INTO v_account_id;

  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM accounts
    WHERE business_id = p_business_id AND name = p_name
    LIMIT 1;
  END IF;

  RETURN v_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION find_or_create_account FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_or_create_account FROM anon;
GRANT EXECUTE ON FUNCTION find_or_create_account TO authenticated;

-- ============================================================================
-- Function: post_sales_invoice_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_customer_name text;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft invoice';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_invoice.customer_id;

  -- Find or create receivable (Sundry Debtors) account for this customer
  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id,
    v_customer_name,
    'Sundry Debtors'
  );

  -- Find or create Sales income account
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id,
    'Sales',
    'Direct Income'
  );

  -- Post the journal entry using the existing post_journal_entry function
  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_receivable_account_id,
        'debit_amount', v_invoice.grand_total,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_sales_account_id,
        'debit_amount', 0,
        'credit_amount', v_invoice.grand_total
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

-- ============================================================================
-- Function: post_purchase_bill_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION post_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_supplier_name text;
  v_payable_account_id uuid;
  v_purchase_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft bill';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_bill.supplier_id;

  -- Find or create payable (Sundry Creditors) account for this supplier
  v_payable_account_id := find_or_create_account(
    v_bill.business_id,
    v_supplier_name,
    'Sundry Creditors'
  );

  -- Find or create Purchases expense account
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id,
    'Purchases',
    'Direct Expense'
  );

  -- Post the journal entry using the existing post_journal_entry function
  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_purchase_account_id,
        'debit_amount', v_bill.grand_total,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_payable_account_id,
        'debit_amount', 0,
        'credit_amount', v_bill.grand_total
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

-- Revoke and grant
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;

/*
# Payment Received Journal Integration

Adds a SECURITY DEFINER function that posts the accounting journal entry
for a customer payment received, atomically and duplicate-safe.

## post_payment_received_journal(p_payment_id)
- Loads the payment (must be type='received', party_type='customer')
- Checks no existing journal entry with reference_type='payment_received' + reference_id = payment id
- Finds or creates a Cash & Bank account ("Cash" for cash, "Bank" for all other methods)
- Finds or creates a Sundry Debtors account named after the customer
- Posts a balanced journal entry: debit Cash/Bank, credit customer receivable
- Links via reference_type='payment_received', reference_id=payment_id
- Returns the journal entry id

## Security
- SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

CREATE OR REPLACE FUNCTION post_payment_received_journal(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_customer_name text;
  v_cash_bank_account_id uuid;
  v_receivable_account_id uuid;
  v_cash_bank_name text;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.type != 'received' THEN
    RAISE EXCEPTION 'This function only handles received payments';
  END IF;

  IF v_payment.party_type != 'customer' THEN
    RAISE EXCEPTION 'This function only handles customer payments';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_payment.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_payment.business_id
    AND reference_type = 'payment_received'
    AND reference_id = p_payment_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_payment.party_id;

  -- Determine Cash/Bank account name based on payment method
  v_cash_bank_name := CASE WHEN v_payment.payment_method = 'cash' THEN 'Cash' ELSE 'Bank' END;

  -- Find or create Cash & Bank account
  v_cash_bank_account_id := find_or_create_account(
    v_payment.business_id,
    v_cash_bank_name,
    'Cash & Bank'
  );

  -- Find or create receivable (Sundry Debtors) account for this customer
  v_receivable_account_id := find_or_create_account(
    v_payment.business_id,
    v_customer_name,
    'Sundry Debtors'
  );

  -- Post the journal entry: debit Cash/Bank, credit customer receivable
  v_entry_id := post_journal_entry(
    v_payment.business_id,
    v_payment.date,
    'Payment received ' || v_payment.payment_number,
    'payment_received',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cash_bank_account_id,
        'debit_amount', v_payment.amount,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_receivable_account_id,
        'debit_amount', 0,
        'credit_amount', v_payment.amount
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_payment_received_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_payment_received_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_payment_received_journal TO authenticated;

/*
# Payment Made Journal Integration

Adds a SECURITY DEFINER function that posts the accounting journal entry
for a supplier payment made, atomically and duplicate-safe.

## post_payment_made_journal(p_payment_id)
- Loads the payment (must be type='made', party_type='supplier')
- Checks no existing journal entry with reference_type='payment_made' + reference_id = payment id
- Finds or creates a Cash & Bank account ("Cash" for cash, "Bank" for all other methods)
- Finds or creates a Sundry Creditors (payable) account named after the supplier
- Posts a balanced journal entry: debit supplier payable, credit Cash/Bank
- Links via reference_type='payment_made', reference_id=payment_id
- Returns the journal entry id

## Security
- SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

CREATE OR REPLACE FUNCTION post_payment_made_journal(p_payment_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_supplier_name text;
  v_cash_bank_account_id uuid;
  v_payable_account_id uuid;
  v_cash_bank_name text;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.type != 'made' THEN
    RAISE EXCEPTION 'This function only handles made payments';
  END IF;

  IF v_payment.party_type != 'supplier' THEN
    RAISE EXCEPTION 'This function only handles supplier payments';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_payment.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_payment.business_id
    AND reference_type = 'payment_made'
    AND reference_id = p_payment_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_payment.party_id;

  -- Determine Cash/Bank account name based on payment method
  v_cash_bank_name := CASE WHEN v_payment.payment_method = 'cash' THEN 'Cash' ELSE 'Bank' END;

  -- Find or create Cash & Bank account
  v_cash_bank_account_id := find_or_create_account(
    v_payment.business_id,
    v_cash_bank_name,
    'Cash & Bank'
  );

  -- Find or create payable (Sundry Creditors) account for this supplier
  v_payable_account_id := find_or_create_account(
    v_payment.business_id,
    v_supplier_name,
    'Sundry Creditors'
  );

  -- Post the journal entry: debit supplier payable, credit Cash/Bank
  v_entry_id := post_journal_entry(
    v_payment.business_id,
    v_payment.date,
    'Payment made ' || v_payment.payment_number,
    'payment_made',
    p_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_payable_account_id,
        'debit_amount', v_payment.amount,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id', v_cash_bank_account_id,
        'debit_amount', 0,
        'credit_amount', v_payment.amount
      )
    )
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_payment_made_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_payment_made_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_payment_made_journal TO authenticated;

/*
# Payment Allocation

Adds `allocated_amount` column to payments table and a SECURITY DEFINER
function `allocate_payment` that atomically allocates a payment to an
invoice or bill, preventing overpayment and tracking unapplied amounts.

## allocate_payment(p_payment_id, p_reference_type, p_reference_id, p_amount)
- p_reference_type: 'sales_invoice' or 'purchase_bill'
- p_reference_id: the invoice/bill id
- p_amount: amount to allocate (capped at payment's unapplied balance
  and the invoice/bill's outstanding balance)
- Updates the payment's allocated_amount
- Updates the invoice/bill's paid_amount, balance_amount, payment_status, status
- Returns the actual allocated amount

## Security
- SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- Caller must have write access (can_write_business)
- All existing RLS remains intact
*/

ALTER TABLE payments ADD COLUMN IF NOT EXISTS allocated_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE payments ADD CONSTRAINT payments_allocated_check
  CHECK (allocated_amount >= 0 AND allocated_amount <= amount);

CREATE OR REPLACE FUNCTION allocate_payment(
  p_payment_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_unapplied numeric;
  v_outstanding numeric;
  v_allocate numeric;
  v_new_paid numeric;
  v_new_balance numeric;
  v_pay_status text;
  v_new_status text;
  v_grand_total numeric;
  v_current_paid numeric;
  v_current_status text;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_payment.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Allocation amount must be positive';
  END IF;

  -- Unapplied = total payment amount minus already-allocated
  v_unapplied := v_payment.amount - v_payment.allocated_amount;

  IF v_unapplied <= 0 THEN
    RAISE EXCEPTION 'Payment has no unapplied balance';
  END IF;

  IF p_reference_type = 'sales_invoice' THEN
    IF v_payment.type != 'received' OR v_payment.party_type != 'customer' THEN
      RAISE EXCEPTION 'Payment type does not match sales invoice allocation';
    END IF;

    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM sales_invoices WHERE id = p_reference_id AND business_id = v_payment.business_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

    v_new_paid := v_current_paid + v_allocate;
    v_new_balance := v_grand_total - v_new_paid;
    v_pay_status := CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partial' END;
    v_new_status := CASE
      WHEN v_pay_status = 'paid' THEN 'paid'
      ELSE CASE WHEN v_current_status = 'issued' THEN 'partially_paid' ELSE v_current_status END
    END;

    UPDATE sales_invoices
      SET paid_amount = v_new_paid,
          balance_amount = v_new_balance,
          payment_status = v_pay_status,
          status = v_new_status
    WHERE id = p_reference_id;

  ELSIF p_reference_type = 'purchase_bill' THEN
    IF v_payment.type != 'made' OR v_payment.party_type != 'supplier' THEN
      RAISE EXCEPTION 'Payment type does not match purchase bill allocation';
    END IF;

    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM purchase_bills WHERE id = p_reference_id AND business_id = v_payment.business_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill not found';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

    v_new_paid := v_current_paid + v_allocate;
    v_new_balance := v_grand_total - v_new_paid;
    v_pay_status := CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partial' END;
    v_new_status := CASE
      WHEN v_pay_status = 'paid' THEN 'paid'
      ELSE CASE WHEN v_current_status = 'confirmed' THEN 'partially_paid' ELSE v_current_status END
    END;

    UPDATE purchase_bills
      SET paid_amount = v_new_paid,
          balance_amount = v_new_balance,
          payment_status = v_pay_status,
          status = v_new_status
    WHERE id = p_reference_id;

  ELSE
    RAISE EXCEPTION 'Invalid reference type';
  END IF;

  -- Update the payment's allocated amount and link it
  UPDATE payments
    SET allocated_amount = v_payment.allocated_amount + v_allocate,
        invoice_id = CASE WHEN p_reference_type = 'sales_invoice' THEN p_reference_id ELSE invoice_id END,
        bill_id = CASE WHEN p_reference_type = 'purchase_bill' THEN p_reference_id ELSE bill_id END
  WHERE id = p_payment_id;

  RETURN v_allocate;
END;
$$;

REVOKE EXECUTE ON FUNCTION allocate_payment FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allocate_payment FROM anon;
GRANT EXECUTE ON FUNCTION allocate_payment TO authenticated;

/*
# GST Accounting Engine

Updates the sales and purchase journal RPCs to post proper GST-aware
journal entries with separate Output/Input GST ledger accounts.

## Changes
1. account_nature: add 'GST Payable' and 'GST Receivable' groups (credit/debit)
2. find_or_create_gst_accounts: helper to ensure all 6 GST accounts exist
3. post_sales_invoice_journal: now posts multi-line entry splitting taxable
   value (Sales) and GST (Output CGST/SGST/IGST) â€” only when GST amounts > 0
4. post_purchase_bill_journal: now posts multi-line entry splitting taxable
   value (Purchases) and GST (Input CGST/SGST/IGST) â€” only when GST amounts > 0
5. calculate_gst: pure helper that computes CGST/SGST/IGST from taxable amount
   and tax rate, given inter-state flag â€” for validation and reporting

## Security
- All functions SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- can_write_business enforced on all posting functions
- All existing RLS remains intact
*/

-- ============================================================================
-- Update account_nature to recognize GST groups
-- ============================================================================
CREATE OR REPLACE FUNCTION account_nature(p_group_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_group_name IN (
      'Current Assets', 'Fixed Assets', 'Direct Expense',
      'Indirect Expense', 'Sundry Debtors', 'Cash & Bank',
      'GST Receivable'
    ) THEN 'debit'
    WHEN p_group_name IN (
      'Current Liabilities', 'Long-term Liabilities', 'Capital Account',
      'Direct Income', 'Indirect Income', 'Sundry Creditors',
      'GST Payable'
    ) THEN 'credit'
    ELSE 'debit'
  END;
$$;

REVOKE EXECUTE ON FUNCTION account_nature(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION account_nature(text) FROM anon;
GRANT EXECUTE ON FUNCTION account_nature(text) TO authenticated;

-- ============================================================================
-- Helper: ensure all 6 GST accounts exist for a business, return their ids
-- ============================================================================
CREATE OR REPLACE FUNCTION find_or_create_gst_accounts(p_business_id uuid)
RETURNS TABLE (
  output_cgst uuid, output_sgst uuid, output_igst uuid,
  input_cgst uuid, input_sgst uuid, input_igst uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oc uuid; v_os uuid; v_oi uuid;
  v_ic uuid; v_is uuid; v_ii uuid;
BEGIN
  v_oc := find_or_create_account(p_business_id, 'Output CGST', 'GST Payable');
  v_os := find_or_create_account(p_business_id, 'Output SGST', 'GST Payable');
  v_oi := find_or_create_account(p_business_id, 'Output IGST', 'GST Payable');
  v_ic := find_or_create_account(p_business_id, 'Input CGST', 'GST Receivable');
  v_is := find_or_create_account(p_business_id, 'Input SGST', 'GST Receivable');
  v_ii := find_or_create_account(p_business_id, 'Input IGST', 'GST Receivable');

  RETURN QUERY SELECT v_oc, v_os, v_oi, v_ic, v_is, v_ii;
END;
$$;

REVOKE EXECUTE ON FUNCTION find_or_create_gst_accounts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_or_create_gst_accounts FROM anon;
GRANT EXECUTE ON FUNCTION find_or_create_gst_accounts TO authenticated;

-- ============================================================================
-- Helper: calculate GST amounts from taxable + rate + inter-state flag
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_gst(
  p_taxable_amount numeric,
  p_tax_rate numeric,
  p_is_inter_state boolean DEFAULT false
)
RETURNS TABLE (
  cgst_amount numeric, sgst_amount numeric, igst_amount numeric,
  total_tax numeric
)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    CASE WHEN p_is_inter_state THEN 0
      ELSE round(p_taxable_amount * p_tax_rate / 200, 2) END,
    CASE WHEN p_is_inter_state THEN 0
      ELSE round(p_taxable_amount * p_tax_rate / 200, 2) END,
    CASE WHEN p_is_inter_state
      THEN round(p_taxable_amount * p_tax_rate / 100, 2) ELSE 0 END,
    round(p_taxable_amount * p_tax_rate / 100, 2);
$$;

REVOKE EXECUTE ON FUNCTION calculate_gst FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_gst FROM anon;
GRANT EXECUTE ON FUNCTION calculate_gst TO authenticated;

-- ============================================================================
-- Updated: post_sales_invoice_journal with GST split
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_customer_name text;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_gst RECORD;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft invoice';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_invoice.customer_id;

  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id, v_customer_name, 'Sundry Debtors'
  );
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id, 'Sales', 'Direct Income'
  );

  v_total_tax := COALESCE(v_invoice.cgst_amount, 0) + COALESCE(v_invoice.sgst_amount, 0) + COALESCE(v_invoice.igst_amount, 0);

  -- Build journal lines: debit receivable (full grand_total), credit sales (taxable) + GST
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_receivable_account_id,
      'debit_amount', v_invoice.grand_total,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_sales_account_id,
      'debit_amount', 0,
      'credit_amount', v_invoice.taxable_amount
    )
  );

  -- Add GST lines only if there is GST
  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_invoice.business_id);

    IF COALESCE(v_invoice.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_cgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.cgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_sgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.sgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_igst,
          'debit_amount', 0,
          'credit_amount', v_invoice.igst_amount
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

-- ============================================================================
-- Updated: post_purchase_bill_journal with GST split
-- ============================================================================
CREATE OR REPLACE FUNCTION post_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_supplier_name text;
  v_payable_account_id uuid;
  v_purchase_account_id uuid;
  v_gst RECORD;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft bill';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_bill.supplier_id;

  v_payable_account_id := find_or_create_account(
    v_bill.business_id, v_supplier_name, 'Sundry Creditors'
  );
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id, 'Purchases', 'Direct Expense'
  );

  v_total_tax := COALESCE(v_bill.cgst_amount, 0) + COALESCE(v_bill.sgst_amount, 0) + COALESCE(v_bill.igst_amount, 0);

  -- Build journal lines: debit purchases (taxable) + GST input, credit payable (full grand_total)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_purchase_account_id,
      'debit_amount', v_bill.taxable_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_payable_account_id,
      'debit_amount', 0,
      'credit_amount', v_bill.grand_total
    )
  );

  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_bill.business_id);

    IF COALESCE(v_bill.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_cgst,
          'debit_amount', v_bill.cgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_sgst,
          'debit_amount', v_bill.sgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_igst,
          'debit_amount', v_bill.igst_amount,
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;

/*
# Accounting Reversal for Cancelled/Voided Documents

Adds two SECURITY DEFINER functions that post a reversal journal entry
for a cancelled sales invoice or purchase bill. The reversal exactly
mirrors the original accounting entry with debits and credits swapped.

## reverse_sales_invoice_journal(p_invoice_id)
- Loads the invoice; must be status='cancelled' or 'void'
- Finds the original journal entry (reference_type='sales_invoice', reference_id=invoice_id)
- Prevents duplicate reversal entries (reference_type='sales_invoice_reversal')
- Loads the original lines, swaps debit/credit, posts a new balanced entry
- Links via reference_type='sales_invoice_reversal', reference_id=invoice_id
- Returns the reversal journal entry id

## reverse_purchase_bill_journal(p_bill_id)
- Loads the bill; must be status='cancelled'
- Finds the original journal entry (reference_type='purchase_bill', reference_id=bill_id)
- Prevents duplicate reversal entries (reference_type='purchase_bill_reversal')
- Loads the original lines, swaps debit/credit, posts a new balanced entry
- Links via reference_type='purchase_bill_reversal', reference_id=bill_id
- Returns the reversal journal entry id

## Security
- Both functions SECURITY DEFINER, fixed search_path = public
- EXECUTE revoked from PUBLIC and anon, granted to authenticated
- can_write_business enforced
- Original journal entry is never modified or deleted
- Reversal is a separate journal entry
- Existing payment allocations are not deleted
- Stock cancellation behavior is unchanged (handled by the caller)
*/

-- ============================================================================
-- Function: reverse_sales_invoice_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_original_entry_id uuid;
  v_reversal_exists uuid;
  v_lines jsonb := '[]'::jsonb;
  v_line RECORD;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status NOT IN ('cancelled', 'void') THEN
    RAISE EXCEPTION 'Only cancelled or void invoices can be reversed';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Find the original journal entry
  SELECT id INTO v_original_entry_id
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
    AND status = 'posted'
  LIMIT 1;

  IF v_original_entry_id IS NULL THEN
    RAISE EXCEPTION 'No posted journal entry found for this invoice';
  END IF;

  -- Prevent duplicate reversal
  SELECT id INTO v_reversal_exists
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice_reversal'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_reversal_exists IS NOT NULL THEN
    RETURN v_reversal_exists;
  END IF;

  -- Build reversal lines by swapping debit/credit from original
  FOR v_line IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_entry_lines
    WHERE entry_id = v_original_entry_id
  LOOP
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_line.account_id,
        'debit_amount', v_line.credit_amount,
        'credit_amount', v_line.debit_amount
      )
    );
  END LOOP;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Reversal: Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice_reversal',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION reverse_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reverse_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION reverse_sales_invoice_journal TO authenticated;

-- ============================================================================
-- Function: reverse_purchase_bill_journal
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_original_entry_id uuid;
  v_reversal_exists uuid;
  v_lines jsonb := '[]'::jsonb;
  v_line RECORD;
  v_entry_id uuid;
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status != 'cancelled' THEN
    RAISE EXCEPTION 'Only cancelled bills can be reversed';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Find the original journal entry
  SELECT id INTO v_original_entry_id
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
    AND status = 'posted'
  LIMIT 1;

  IF v_original_entry_id IS NULL THEN
    RAISE EXCEPTION 'No posted journal entry found for this bill';
  END IF;

  -- Prevent duplicate reversal
  SELECT id INTO v_reversal_exists
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill_reversal'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_reversal_exists IS NOT NULL THEN
    RETURN v_reversal_exists;
  END IF;

  -- Build reversal lines by swapping debit/credit from original
  FOR v_line IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_entry_lines
    WHERE entry_id = v_original_entry_id
  LOOP
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_line.account_id,
        'debit_amount', v_line.credit_amount,
        'credit_amount', v_line.debit_amount
      )
    );
  END LOOP;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Reversal: Purchase bill ' || v_bill.bill_number,
    'purchase_bill_reversal',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION reverse_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reverse_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION reverse_purchase_bill_journal TO authenticated;

/*
# 013a â€” GST group_name CHECK repair (BLOCKER B1)

## Problem
Migration 011 posts GST through ledger accounts created in groups
'GST Payable' / 'GST Receivable' (find_or_create_gst_accounts, 011:68-73),
but the accounts.group_name CHECK constraint added in 001 (line 763) never
listed those values. Every taxed sales invoice / purchase bill therefore
fails at posting time with:

  ERROR: new row for relation "accounts" violates check constraint
         "accounts_group_name_check"

Untaxed documents skip the GST lines entirely, which is why the breakage
stayed invisible until real taxed usage.

## Fix
Widen the CHECK to admit the two GST groups used by the 011 engine.
No existing row can violate the widened constraint (it is a strict
superset of the old value set), so no NOT VALID / revalidation dance is
needed.

Cess ledgers ('Output Cess' / 'Input Cess', introduced by 013b) are
homed INSIDE these two groups, so no further group values are required.

Existing behaviour for untaxed docs: unchanged (this migration touches
only the constraint, not any function or row).
*/

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_group_name_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_group_name_check
  CHECK (group_name IN (
    'Current Assets',
    'Fixed Assets',
    'Current Liabilities',
    'Long-term Liabilities',
    'Capital Account',
    'Direct Income',
    'Indirect Income',
    'Direct Expense',
    'Indirect Expense',
    'Sundry Debtors',
    'Sundry Creditors',
    'Cash & Bank',
    'GST Payable',
    'GST Receivable'
  ));

/*
# 013b â€” Balanced journals (round_off + cess) & canonical cash/bank names

Fixes audit findings Â§3.2 (unbalanced JEs) and Â§3.3 (duplicate cash ledgers).

## Part A/B â€” round_off + cess journaled (post_sales_invoice_journal,
              post_purchase_bill_journal re-emitted from 011 verbatim plus
              the new lines)

Canonical balancing identity enforced by the posting engine:

  grand_total = taxable_amount + cgst_amount + sgst_amount + igst_amount
              + COALESCE(cess_amount,0) + COALESCE(round_off,0)

- Sales: debit receivable grand_total; credit taxable, output GST, output
  cess; 'Round Off' credited when positive, debited at |amount| when
  negative (it is the plugging figure).
- Purchase: mirror image â€” debit taxable, input GST, input cess and
  Round Off (positive case); credit payable grand_total.
- Cess homes: 'Output Cess' in group 'GST Payable', 'Input Cess' in group
  'GST Receivable' (both legalised by 013a; account_nature already maps
  these groups credit/debit respectively).
- 'Round Off' ledger home: group 'Indirect Income' (debits when negative
  act as the expense side of rounding within one ledger).
- Untaxed / unrounded documents take exactly the same two-line path as
  before â€” every new line is behind an IF guard, behaviour preserved.

## Part C â€” ONE canonical cash/bank pair ('Cash' / 'Bank')

Decision taken ONCE, per dispatch: canonical names are 'Cash' and 'Bank'
(the names every payment JE already looks up). Seeds are renamed to match;
no payment RPC is edited.

1. Data backfill for existing businesses: legacy seeds 'Cash In Hand' /
   'Bank Account' are merged into 'Cash' / 'Bank' â€” balances folded,
   journal_entry_lines re-pointed, legacy rows deleted.
2. Forward fix WITHOUT rewriting 002 (forbidden): BEFORE INSERT OR UPDATE
   trigger renames any account called 'Cash In Hand'/'Bank Account' to
   the canonical name at the gate, so newly seeded businesses land on the
   canonical pair from day one and future splits are impossible.
*/

-- ============================================================================
-- Part C.2 first (gate): normalise seed names on write
-- ============================================================================
CREATE OR REPLACE FUNCTION normalize_cash_bank_seed_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.name = 'Cash In Hand' THEN
    NEW.name := 'Cash';
  ELSIF NEW.name = 'Bank Account' THEN
    NEW.name := 'Bank';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION normalize_cash_bank_seed_names() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION normalize_cash_bank_seed_names() FROM anon;

DROP TRIGGER IF EXISTS trg_accounts_normalize_cash_bank ON public.accounts;

CREATE TRIGGER trg_accounts_normalize_cash_bank
  BEFORE INSERT OR UPDATE OF name ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION normalize_cash_bank_seed_names();

-- ============================================================================
-- Part C.1 â€” backfill/merge legacy seeds into canonical pair
-- ============================================================================
-- Map used by every step below:
--   'Cash In Hand' -> 'Cash'      'Bank Account' -> 'Bank'

-- 1) Create the canonical account where a business has only the legacy seed
INSERT INTO public.accounts (business_id, name, group_name, opening_balance, current_balance, is_system)
SELECT l.business_id,
       m.canonical,
       l.group_name,
       0,
       0,
       true
FROM public.accounts l
JOIN (VALUES ('Cash In Hand', 'Cash'),
             ('Bank Account', 'Bank')) AS m(legacy, canonical)
  ON l.name = m.legacy
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts c
  WHERE c.business_id = l.business_id AND c.name = m.canonical
);

-- 2) Fold legacy opening/current balances into the canonical account
UPDATE public.accounts c
SET opening_balance = c.opening_balance + l.opening_balance,
    current_balance = c.current_balance + l.current_balance
FROM public.accounts l
JOIN (VALUES ('Cash In Hand', 'Cash'),
             ('Bank Account', 'Bank')) AS m(legacy, canonical)
  ON l.name = m.legacy
WHERE c.business_id = l.business_id
  AND c.name = m.canonical
  AND (l.opening_balance <> 0 OR l.current_balance <> 0);

-- 3) Re-point journal entry lines onto the canonical account
UPDATE public.journal_entry_lines lin
SET account_id = c.id
FROM public.accounts l
JOIN (VALUES ('Cash In Hand', 'Cash'),
             ('Bank Account', 'Bank')) AS m(legacy, canonical)
  ON l.name = m.legacy
JOIN public.accounts c
  ON c.business_id = l.business_id AND c.name = m.canonical
WHERE lin.account_id = l.id;

-- 4) Drop the legacy accounts (lines re-pointed above, FK no longer blocks)
DELETE FROM public.accounts l
USING (VALUES ('Cash In Hand'), ('Bank Account')) AS m(legacy)
WHERE l.name = m.legacy;

-- ============================================================================
-- Part A â€” post_sales_invoice_journal: + cess line, + signed round_off line
--          (otherwise byte-identical to migration 011)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_customer_name text;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_gst RECORD;
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft invoice';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_invoice.customer_id;

  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id, v_customer_name, 'Sundry Debtors'
  );
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id, 'Sales', 'Direct Income'
  );

  v_total_tax := COALESCE(v_invoice.cgst_amount, 0) + COALESCE(v_invoice.sgst_amount, 0) + COALESCE(v_invoice.igst_amount, 0);

  -- Build journal lines: debit receivable (full grand_total), credit sales (taxable) + GST
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_receivable_account_id,
      'debit_amount', v_invoice.grand_total,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_sales_account_id,
      'debit_amount', 0,
      'credit_amount', v_invoice.taxable_amount
    )
  );

  -- Add GST lines only if there is GST
  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_invoice.business_id);

    IF COALESCE(v_invoice.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_cgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.cgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_sgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.sgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_igst,
          'debit_amount', 0,
          'credit_amount', v_invoice.igst_amount
        )
      );
    END IF;
  END IF;

  -- Cess liability line (group home legalised by 013a)
  IF COALESCE(v_invoice.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_invoice.business_id, 'Output Cess', 'GST Payable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', 0,
        'credit_amount', v_invoice.cess_amount
      )
    );
  END IF;

  -- Rounding plug: credit when positive, debit |amount| when negative
  IF COALESCE(v_invoice.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_invoice.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_invoice.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', v_invoice.round_off
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', abs(v_invoice.round_off),
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

-- ============================================================================
-- Part B â€” post_purchase_bill_journal: + input cess line, + signed round_off
--          (otherwise byte-identical to migration 011)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_supplier_name text;
  v_payable_account_id uuid;
  v_purchase_account_id uuid;
  v_gst RECORD;
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry for a draft bill';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_bill.supplier_id;

  v_payable_account_id := find_or_create_account(
    v_bill.business_id, v_supplier_name, 'Sundry Creditors'
  );
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id, 'Purchases', 'Direct Expense'
  );

  v_total_tax := COALESCE(v_bill.cgst_amount, 0) + COALESCE(v_bill.sgst_amount, 0) + COALESCE(v_bill.igst_amount, 0);

  -- Build journal lines: debit purchases (taxable) + GST input, credit payable (full grand_total)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_purchase_account_id,
      'debit_amount', v_bill.taxable_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_payable_account_id,
      'debit_amount', 0,
      'credit_amount', v_bill.grand_total
    )
  );

  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_bill.business_id);

    IF COALESCE(v_bill.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_cgst,
          'debit_amount', v_bill.cgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_sgst,
          'debit_amount', v_bill.sgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_igst,
          'debit_amount', v_bill.igst_amount,
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  -- Input cess asset line (group home legalised by 013a)
  IF COALESCE(v_bill.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_bill.business_id, 'Input Cess', 'GST Receivable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', v_bill.cess_amount,
        'credit_amount', 0
      )
    );
  END IF;

  -- Rounding plug (mirror of sales): debit when positive (adds to cost),
  -- credit |amount| when negative
  IF COALESCE(v_bill.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_bill.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_bill.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', v_bill.round_off,
          'credit_amount', 0
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', abs(v_bill.round_off)
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;

/*
# 014 â€” Accounting engine hardening (T11)

Closes audit risks R1-R4. Fixes only; behaviour preserved for valid flows.

## R1 â€” cross-business account validation
post_journal_entry now resolves every line account with
`WHERE id = ? AND business_id = p_business_id` and raises when missing.
Members of two businesses can no longer post lines against another
business's accounts (previously corrupted their current_balance and leaked
names into lines).

## R2 â€” table-level double-entry enforcement + DML lockdown
- Six RLS policies removed (insert/update/delete on journal_entries and
  journal_entry_lines). Clients keep SELECT; writes go through the
  SECURITY DEFINER RPCs which bypass RLS â€” the RPC path becomes the only
  door.
- Statement-level AFTER triggers on journal_entry_lines (insert / update /
  delete, transition tables) verify every affected entry satisfies
  sum(debit)=sum(credit) and total != 0. Defence in depth for definer-side
  bugs and future code paths.
- NOTE: post_journal_entry is reworked to bulk-insert its lines in ONE
  statement so the insert trigger validates the COMPLETE entry, not a
  half-posted intermediate state.

## R3 â€” race-free entry numbering
max()+1 numbering now runs under pg_advisory_xact_lock keyed by
(business_id, financial year), serialising concurrent postings per
business-year. Keeps the existing JE/YYYY/NNNN format and UNIQUE
constraint as backstop. Proper per-doc-type sequences arrive with T13.

## R4 â€” status guards on document posting wrappers
post_sales_invoice_journal / post_purchase_bill_journal (as delivered in
013b, cess+round_off intact) now accept ONLY live documents:
sales 'issued'/'partially_paid'/'paid', purchase 'confirmed'/
'partially_paid'/'paid' (schema reality per master Â§J2 ENUM REALITY â€”
no 'posted' value exists yet; normalisation is future work). Draft,
cancelled and void documents are rejected with explicit messages, closing
the re-post-after-cancel hole.

Untaxed/valid flows behave exactly as before. Statics: paired $$ bodies,
balanced IF/END IF throughout.
*/

-- ============================================================================
-- R2a â€” revoke direct client DML on journal tables (RPCs become the only door)
-- ============================================================================
DROP POLICY IF EXISTS "journal_entries_insert" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entries_update" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entries_delete" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entry_lines_insert" ON public.journal_entry_lines;
DROP POLICY IF EXISTS "journal_entry_lines_update" ON public.journal_entry_lines;
DROP POLICY IF EXISTS "journal_entry_lines_delete" ON public.journal_entry_lines;

-- ============================================================================
-- R2b â€” shared checker: every listed entry must be balanced and non-zero
-- ============================================================================
CREATE OR REPLACE FUNCTION assert_journal_entries_balanced(p_entry_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF cardinality(p_entry_ids) = 0 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT e.id,
           round(COALESCE(sum(l.debit_amount), 0), 2)  AS tot_dr,
           round(COALESCE(sum(l.credit_amount), 0), 2) AS tot_cr
    FROM journal_entries e
    LEFT JOIN journal_entry_lines l ON l.entry_id = e.id
    WHERE e.id = ANY (p_entry_ids)
    GROUP BY e.id
  LOOP
    IF r.tot_dr <> r.tot_cr THEN
      RAISE EXCEPTION 'Journal entry % is not balanced: debit % != credit %',
        r.id, r.tot_dr, r.tot_cr;
    END IF;
    IF r.tot_dr = 0 THEN
      RAISE EXCEPTION 'Journal entry % has no lines or a zero total', r.id;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION assert_journal_entries_balanced(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_journal_entries_balanced(uuid[]) FROM anon;

-- ============================================================================
-- R2c â€” statement-level enforcement triggers (transition tables)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_lines_balance_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_journal_entries_balanced(
    ARRAY(SELECT DISTINCT entry_id FROM new_lines)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_lines_balance_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_journal_entries_balanced(
    ARRAY(SELECT DISTINCT entry_id FROM (
      SELECT entry_id FROM new_lines
      UNION
      SELECT entry_id FROM old_lines
    ) s)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trg_lines_balance_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_journal_entries_balanced(
    ARRAY(SELECT DISTINCT entry_id FROM old_lines)
  );
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_insert() FROM anon;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_update() FROM anon;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trg_lines_balance_on_delete() FROM anon;

DROP TRIGGER IF EXISTS trg_lines_balance_ins ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS trg_lines_balance_upd ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS trg_lines_balance_del ON public.journal_entry_lines;

CREATE TRIGGER trg_lines_balance_ins
  AFTER INSERT ON public.journal_entry_lines
  REFERENCING NEW TABLE AS new_lines
  FOR EACH STATEMENT EXECUTE FUNCTION trg_lines_balance_on_insert();

CREATE TRIGGER trg_lines_balance_upd
  AFTER UPDATE ON public.journal_entry_lines
  REFERENCING OLD TABLE AS old_lines NEW TABLE AS new_lines
  FOR EACH STATEMENT EXECUTE FUNCTION trg_lines_balance_on_update();

CREATE TRIGGER trg_lines_balance_del
  AFTER DELETE ON public.journal_entry_lines
  REFERENCING OLD TABLE AS old_lines
  FOR EACH STATEMENT EXECUTE FUNCTION trg_lines_balance_on_delete();

-- ============================================================================
-- R1 + R3 + R2 â€” hardened post_journal_entry
--   (bulk line insert so the balance trigger sees the whole entry;
--    business-scoped account resolution; advisory-locked numbering)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_journal_entry(
  p_business_id uuid,
  p_date date,
  p_narration text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_seq int;
  v_total_debit numeric(14,2) := 0;
  v_total_credit numeric(14,2) := 0;
  v_line jsonb;
  v_account_id uuid;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_movement numeric(14,2);
  v_mov RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Journal entry must have at least one line';
  END IF;

  -- Validate lines and compute totals
  FOR v_line IN SELECT jsonb_array_elements(p_lines) LOOP
    v_account_id := v_line->>'account_id';
    v_debit := COALESCE((v_line->>'debit_amount')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit_amount')::numeric, 0);

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Every line must have an account';
    END IF;

    -- R1: account must belong to THIS business
    IF NOT EXISTS (
      SELECT 1 FROM accounts
      WHERE id = v_account_id AND business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'Account % does not belong to this business', v_account_id;
    END IF;

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION 'Amounts cannot be negative';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION 'A line cannot have both debit and credit amounts';
    END IF;

    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'Every line must have a nonzero amount';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  v_total_debit := round(v_total_debit, 2);
  v_total_credit := round(v_total_credit, 2);

  IF v_total_debit != v_total_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced. Total debit % does not equal total credit %', v_total_debit, v_total_credit;
  END IF;

  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'Journal entry must have a nonzero total';
  END IF;

  -- R3: serialise number generation per business + year
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || extract(year from p_date)::text, 42)
  );

  -- Generate sequential entry number
  SELECT COALESCE(max(
    CASE
      WHEN entry_number ~ '^JE/[0-9]{4}/[0-9]+$'
        THEN substring(entry_number from '[0-9]+$')::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_seq
  FROM journal_entries
  WHERE business_id = p_business_id
    AND entry_number ~ ('^JE/' || extract(year from p_date)::text || '/[0-9]+$');

  v_entry_number := 'JE/' || extract(year from p_date)::text || '/' || lpad(v_seq::text, 4, '0');

  -- Insert the journal entry
  INSERT INTO journal_entries (
    business_id, entry_number, date, reference_type, reference_id,
    narration, total_debit, total_credit, status, created_by
  ) VALUES (
    p_business_id, v_entry_number, p_date, p_reference_type, p_reference_id,
    p_narration, v_total_debit, v_total_credit, 'posted', auth.uid()
  )
  RETURNING id INTO v_entry_id;

  -- Bulk-insert lines (single statement -> balance trigger sees full entry).
  -- R1 enforced again by the INNER JOIN: foreign accounts cannot slip in.
  INSERT INTO journal_entry_lines (
    business_id, entry_id, account_id, account_name,
    debit_amount, credit_amount
  )
  SELECT
    p_business_id,
    v_entry_id,
    a.id,
    a.name,
    COALESCE((ln->>'debit_amount')::numeric, 0),
    COALESCE((ln->>'credit_amount')::numeric, 0)
  FROM jsonb_array_elements(p_lines) AS ln
  JOIN accounts a
    ON a.id = (ln->>'account_id')::uuid
   AND a.business_id = p_business_id;

  -- Apply net movements per account
  FOR v_mov IN
    WITH mov_lines AS (
      SELECT
        (ln->>'account_id')::uuid AS account_id,
        COALESCE((ln->>'debit_amount')::numeric, 0)  AS dr,
        COALESCE((ln->>'credit_amount')::numeric, 0) AS cr
      FROM jsonb_array_elements(p_lines) AS ln
    )
    SELECT ml.account_id,
           SUM(CASE WHEN account_nature(a.group_name) = 'debit'
                    THEN ml.dr - ml.cr
                    ELSE ml.cr - ml.dr END)::numeric(14,2) AS mov
    FROM mov_lines ml
    JOIN accounts a ON a.id = ml.account_id
    GROUP BY ml.account_id
  LOOP
    UPDATE accounts
    SET current_balance = round(COALESCE(current_balance, 0) + v_mov.mov, 2)
    WHERE id = v_mov.account_id;
  END LOOP;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_journal_entry FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_journal_entry FROM anon;
GRANT EXECUTE ON FUNCTION post_journal_entry TO authenticated;

-- ============================================================================
-- R4 â€” posting wrappers reject anything but live documents
--      (bodies identical to 013b delivery except the status guard)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_sales_invoice_journal(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_customer_name text;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_gst RECORD;
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_invoice FROM sales_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- R4: only live documents may receive their original journal
  IF v_invoice.status NOT IN ('issued', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'Cannot post journal for invoice in status %', v_invoice.status;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_invoice.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_invoice.business_id
    AND reference_type = 'sales_invoice'
    AND reference_id = p_invoice_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_customer_name FROM customers WHERE id = v_invoice.customer_id;

  v_receivable_account_id := find_or_create_account(
    v_invoice.business_id, v_customer_name, 'Sundry Debtors'
  );
  v_sales_account_id := find_or_create_account(
    v_invoice.business_id, 'Sales', 'Direct Income'
  );

  v_total_tax := COALESCE(v_invoice.cgst_amount, 0) + COALESCE(v_invoice.sgst_amount, 0) + COALESCE(v_invoice.igst_amount, 0);

  -- Build journal lines: debit receivable (full grand_total), credit sales (taxable) + GST
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_receivable_account_id,
      'debit_amount', v_invoice.grand_total,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_sales_account_id,
      'debit_amount', 0,
      'credit_amount', v_invoice.taxable_amount
    )
  );

  -- Add GST lines only if there is GST
  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_invoice.business_id);

    IF COALESCE(v_invoice.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_cgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.cgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_sgst,
          'debit_amount', 0,
          'credit_amount', v_invoice.sgst_amount
        )
      );
    END IF;

    IF COALESCE(v_invoice.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.output_igst,
          'debit_amount', 0,
          'credit_amount', v_invoice.igst_amount
        )
      );
    END IF;
  END IF;

  -- Cess liability line (group home legalised by 013a)
  IF COALESCE(v_invoice.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_invoice.business_id, 'Output Cess', 'GST Payable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', 0,
        'credit_amount', v_invoice.cess_amount
      )
    );
  END IF;

  -- Rounding plug: credit when positive, debit |amount| when negative
  IF COALESCE(v_invoice.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_invoice.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_invoice.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', v_invoice.round_off
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', abs(v_invoice.round_off),
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_invoice.business_id,
    v_invoice.invoice_date,
    'Sales invoice ' || v_invoice.invoice_number,
    'sales_invoice',
    p_invoice_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_sales_invoice_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_sales_invoice_journal TO authenticated;

CREATE OR REPLACE FUNCTION post_purchase_bill_journal(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_supplier_name text;
  v_payable_account_id uuid;
  v_purchase_account_id uuid;
  v_gst RECORD;
  v_cess_account_id uuid;
  v_round_off_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total_tax numeric(14,2);
BEGIN
  SELECT * INTO v_bill FROM purchase_bills WHERE id = p_bill_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  -- R4: only live documents may receive their original journal
  IF v_bill.status NOT IN ('confirmed', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'Cannot post journal for bill in status %', v_bill.status;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_bill.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Prevent duplicate journal entries
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_bill.business_id
    AND reference_type = 'purchase_bill'
    AND reference_id = p_bill_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT name INTO v_supplier_name FROM suppliers WHERE id = v_bill.supplier_id;

  v_payable_account_id := find_or_create_account(
    v_bill.business_id, v_supplier_name, 'Sundry Creditors'
  );
  v_purchase_account_id := find_or_create_account(
    v_bill.business_id, 'Purchases', 'Direct Expense'
  );

  v_total_tax := COALESCE(v_bill.cgst_amount, 0) + COALESCE(v_bill.sgst_amount, 0) + COALESCE(v_bill.igst_amount, 0);

  -- Build journal lines: debit purchases (taxable) + GST input, credit payable (full grand_total)
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_purchase_account_id,
      'debit_amount', v_bill.taxable_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_payable_account_id,
      'debit_amount', 0,
      'credit_amount', v_bill.grand_total
    )
  );

  IF v_total_tax > 0 THEN
    SELECT * INTO v_gst FROM find_or_create_gst_accounts(v_bill.business_id);

    IF COALESCE(v_bill.cgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_cgst,
          'debit_amount', v_bill.cgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.sgst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_sgst,
          'debit_amount', v_bill.sgst_amount,
          'credit_amount', 0
        )
      );
    END IF;

    IF COALESCE(v_bill.igst_amount, 0) > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_gst.input_igst,
          'debit_amount', v_bill.igst_amount,
          'credit_amount', 0
        )
      );
    END IF;
  END IF;

  -- Input cess asset line (group home legalised by 013a)
  IF COALESCE(v_bill.cess_amount, 0) > 0 THEN
    v_cess_account_id := find_or_create_account(
      v_bill.business_id, 'Input Cess', 'GST Receivable'
    );
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cess_account_id,
        'debit_amount', v_bill.cess_amount,
        'credit_amount', 0
      )
    );
  END IF;

  -- Rounding plug (mirror of sales): debit when positive, credit |amount|
  IF COALESCE(v_bill.round_off, 0) <> 0 THEN
    v_round_off_account_id := find_or_create_account(
      v_bill.business_id, 'Round Off', 'Indirect Income'
    );
    IF v_bill.round_off > 0 THEN
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', v_bill.round_off,
          'credit_amount', 0
        )
      );
    ELSE
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'account_id', v_round_off_account_id,
          'debit_amount', 0,
          'credit_amount', abs(v_bill.round_off)
        )
      );
    END IF;
  END IF;

  v_entry_id := post_journal_entry(
    v_bill.business_id,
    v_bill.bill_date,
    'Purchase bill ' || v_bill.bill_number,
    'purchase_bill',
    p_bill_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_purchase_bill_journal FROM anon;
GRANT EXECUTE ON FUNCTION post_purchase_bill_journal TO authenticated;

/*
# 015 â€” Payment allocation integrity (T12)

Hardens allocate_payment against audit risk R5. Contract per master Â§J2:
payments may allocate ONLY against LIVE documents with outstanding > 0;
under-allocation is an ERROR, never a silent partial success.

## Changes (behaviour preserved for valid, fully-covering allocations)
1. Row locking: the payment AND the target document are SELECT ... FOR
   UPDATE, so two concurrent allocations of one payment or against one
   document serialise instead of double-spending unapplied/outstanding.
   Lock order is always payment -> document (single entry point), so no
   lock-cycle deadlock is reachable through this RPC.
2. Status guard: sales invoices must be 'issued'/'partially_paid';
   purchase bills 'confirmed'/'partially_paid' (schema reality per Â§J2
   ENUM REALITY). Draft / cancelled / void / already-paid documents are
   rejected by name.
3. Explicit under-allocation: previously LEAST(p_amount, unapplied,
   outstanding) silently allocated less while callers toasted success.
   Now any shortfall RAISEs with requested/unapplied/outstanding figures,
   and a fully-settled document gets its own message. Callers finally get
   a real error to surface (client surfacing is Stanley's T-batch).
4. Zero/negative outstanding guard before arithmetic.

Return value remains numeric (now always equals p_amount on success).
Statics: single $$ body, IF/END IF balanced.
*/

CREATE OR REPLACE FUNCTION allocate_payment(
  p_payment_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_unapplied numeric;
  v_outstanding numeric;
  v_allocate numeric;
  v_new_paid numeric;
  v_new_balance numeric;
  v_pay_status text;
  v_new_status text;
  v_grand_total numeric;
  v_current_paid numeric;
  v_current_status text;
BEGIN
  -- Lock the payment row first (fixed lock order: payment -> document)
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_payment.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Allocation amount must be positive';
  END IF;

  -- Unapplied = total payment amount minus already-allocated
  v_unapplied := v_payment.amount - v_payment.allocated_amount;

  IF v_unapplied <= 0 THEN
    RAISE EXCEPTION 'Payment has no unapplied balance';
  END IF;

  IF p_reference_type = 'sales_invoice' THEN
    IF v_payment.type != 'received' OR v_payment.party_type != 'customer' THEN
      RAISE EXCEPTION 'Payment type does not match sales invoice allocation';
    END IF;

    -- Lock the document row against concurrent allocations
    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM sales_invoices WHERE id = p_reference_id AND business_id = v_payment.business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found';
    END IF;

    -- J2: only live, unsettled invoices may receive allocations
    IF v_current_status NOT IN ('issued', 'partially_paid') THEN
      RAISE EXCEPTION 'Cannot allocate against invoice in status %', v_current_status;
    END IF;

    IF v_outstanding <= 0 THEN
      RAISE EXCEPTION 'Invoice has no outstanding balance';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

    -- R5: never allocate silently less than requested
    IF v_allocate < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance for allocation: requested %, payment unapplied %, invoice outstanding %',
        p_amount, v_unapplied, v_outstanding;
    END IF;

    v_new_paid := v_current_paid + v_allocate;
    v_new_balance := v_grand_total - v_new_paid;
    v_pay_status := CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partial' END;
    v_new_status := CASE
      WHEN v_pay_status = 'paid' THEN 'paid'
      ELSE CASE WHEN v_current_status = 'issued' THEN 'partially_paid' ELSE v_current_status END
    END;

    UPDATE sales_invoices
      SET paid_amount = v_new_paid,
          balance_amount = v_new_balance,
          payment_status = v_pay_status,
          status = v_new_status
    WHERE id = p_reference_id;

  ELSIF p_reference_type = 'purchase_bill' THEN
    IF v_payment.type != 'made' OR v_payment.party_type != 'supplier' THEN
      RAISE EXCEPTION 'Payment type does not match purchase bill allocation';
    END IF;

    -- Lock the document row against concurrent allocations
    SELECT grand_total, paid_amount, balance_amount, status
      INTO v_grand_total, v_current_paid, v_outstanding, v_current_status
    FROM purchase_bills WHERE id = p_reference_id AND business_id = v_payment.business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill not found';
    END IF;

    -- J2: only live, unsettled bills may receive allocations
    IF v_current_status NOT IN ('confirmed', 'partially_paid') THEN
      RAISE EXCEPTION 'Cannot allocate against bill in status %', v_current_status;
    END IF;

    IF v_outstanding <= 0 THEN
      RAISE EXCEPTION 'Bill has no outstanding balance';
    END IF;

    v_allocate := LEAST(p_amount, v_unapplied, v_outstanding);

    -- R5: never allocate silently less than requested
    IF v_allocate < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance for allocation: requested %, payment unapplied %, bill outstanding %',
        p_amount, v_unapplied, v_outstanding;
    END IF;

    v_new_paid := v_current_paid + v_allocate;
    v_new_balance := v_grand_total - v_new_paid;
    v_pay_status := CASE WHEN v_new_balance <= 0 THEN 'paid' ELSE 'partial' END;
    v_new_status := CASE
      WHEN v_pay_status = 'paid' THEN 'paid'
      ELSE CASE WHEN v_current_status = 'confirmed' THEN 'partially_paid' ELSE v_current_status END
    END;

    UPDATE purchase_bills
      SET paid_amount = v_new_paid,
          balance_amount = v_new_balance,
          payment_status = v_pay_status,
          status = v_new_status
    WHERE id = p_reference_id;

  ELSE
    RAISE EXCEPTION 'Invalid reference type';
  END IF;

  -- Update the payment's allocated amount and link it
  UPDATE payments
    SET allocated_amount = v_payment.allocated_amount + v_allocate,
        invoice_id = CASE WHEN p_reference_type = 'sales_invoice' THEN p_reference_id ELSE invoice_id END,
        bill_id = CASE WHEN p_reference_type = 'purchase_bill' THEN p_reference_id ELSE bill_id END
  WHERE id = p_payment_id;

  RETURN v_allocate;
END;
$$;

REVOKE EXECUTE ON FUNCTION allocate_payment FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allocate_payment FROM anon;
GRANT EXECUTE ON FUNCTION allocate_payment TO authenticated;

/*
# 016 â€” Document numbering service (T13, arbitration Â§J3)

Per-business, per-doc-type atomic sequences behind a SECURITY DEFINER RPC.
Retires client-side Date.now() slicing (SalesInvoiceCreatePage.tsx:165,
PaymentsReceivedPage.tsx:77, PaymentsMadePage.tsx:69) once Stanley rewires
flows onto these RPCs (T15).

## Design
- document_sequences: counter row per (business_id, doc_type). Allocation
  is a single INSERT..ON CONFLICT DO UPDATE ... RETURNING â€” Postgres row
  locking makes concurrent calls strictly serial and gap-free per row.
- document_numbers: registry of every issued number with
  UNIQUE(business_id, doc_type, number) per arbitration. Explicitly
  supplied numbers (legacy clients mid-transition) hit this UNIQUE and
  fail loudly instead of colliding silently.
- Formats (year label taken from p_date, cosmetic; counters do NOT reset
  per year â€” continuous, audit-friendly):
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

/*
# 017 â€” Transactional document save & cancel RPCs (T14, arbitration Â§J4)

One-call, one-transaction replacements for the 3-5 request client chains
(R6) with server-side stock RMW (R11). Clients keep identical payload
shapes to today's pages, minus the manual numbering and follow-up writes.

## create_sales_invoice(p_business_id uuid, p_invoice jsonb, p_items jsonb)
RETURNS TABLE (invoice_id uuid, journal_entry_id uuid)
1. Guards: authenticated; can_write_business; >=1 item; every item has
   product_name and quantity > 0; p_invoice->>'status' must be 'issued'
   (draft flow intentionally out of scope until a draft lifecycle task).
2. Numbering: explicit number registered via register_document_number
   (UNIQUE backstop), otherwise next_document_number('INV/...').
3. Insert sales_invoices row (status 'issued', payment_status 'unpaid',
   balance_amount = grand_total, created_by = caller).
4. Insert all items.
5. Stock per item with a product of type='product': lock product row,
   single UPDATE current_stock = old - qty, write stock_movements
   ('sale', signed -qty, balance_after from RETURNING). Behaviour parity:
   negative stock still allowed (floor policy is a later task).
   Service products never touch stock. Products of another business are
   rejected by the scoped SELECT, not silently skipped.
6. audit_logs row 'invoice_created' (parity with today's client write).
7. post_sales_invoice_journal in the same transaction â€” any failure above
   rolls back EVERYTHING (fixes issued-without-JE / stock-without-invoice).

## create_purchase_bill(...) mirror: type 'purchase', +qty, BILL numbers,
   status 'confirmed' (schema's live state for bills).

## cancel_sales_invoice(p_invoice_id uuid) RETURNS uuid (reversal JE id)
Â§J2 machine: draft â†’ cancelled (no JE to reverse, returns NULL);
issued â†’ cancelled + reverse_sales_invoice_journal; anything paid /
partially_paid / cancelled / void is rejected â€” refunds belong to the
future CN flow. cancel_purchase_bill mirrors with 'confirmed'.
Amounts are left untouched on cancel (history reads by status).

All functions SECURITY DEFINER, search_path pinned, grants hardened.
*/

-- ============================================================================
-- Transactional sales invoice creation
-- ============================================================================
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

  IF COALESCE(p_invoice->>'status', 'issued') <> 'issued' THEN
    RAISE EXCEPTION 'Only status ''issued'' is supported by this RPC';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_name', '') = '' THEN
      RAISE EXCEPTION 'Every item needs a product name';
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % needs a positive quantity', v_item->>'product_name';
    END IF;
  END LOOP;

  v_grand_total := COALESCE((p_invoice->>'grand_total')::numeric, 0);

  -- Numbering: explicit wins (registered, UNIQUE-guarded), else service
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
    'issued',
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

    -- Server-side stock movement (R11): no client read-modify-write
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
  END LOOP;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p_business_id, auth.uid(), 'invoice_created', 'sales_invoice', v_invoice_id,
    'Invoice ' || v_invoice_number || ' created via transactional RPC'
  );

  v_je_id := post_sales_invoice_journal(v_invoice_id);

  RETURN QUERY SELECT v_invoice_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_sales_invoice(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- Transactional purchase bill creation (mirror)
-- ============================================================================
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

  IF COALESCE(p_bill->>'status', 'confirmed') NOT IN ('confirmed') THEN
    RAISE EXCEPTION 'Only status ''confirmed'' is supported by this RPC';
  END IF;

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
    'confirmed',
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

    -- Purchase brings stock IN (server-side RMW)
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
  END LOOP;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p_business_id, auth.uid(), 'bill_created', 'purchase_bill', v_bill_id,
    'Bill ' || v_bill_number || ' created via transactional RPC'
  );

  v_je_id := post_purchase_bill_journal(v_bill_id);

  RETURN QUERY SELECT v_bill_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_purchase_bill(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================================
-- Â§J2 cancel flows
-- ============================================================================
CREATE OR REPLACE FUNCTION cancel_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_existing_reversal uuid;
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

  -- Â§J2: money moved => cancellation blocked, refund via CN path
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
    UPDATE sales_invoices SET status = 'cancelled' WHERE id = p_invoice_id;
    RETURN NULL;  -- nothing was ever posted
  END IF;

  -- Live (issued): flip first â€” the reversal engine requires it â€” then reverse
  UPDATE sales_invoices SET status = 'cancelled' WHERE id = p_invoice_id;

  RETURN reverse_sales_invoice_journal(p_invoice_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_sales_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_sales_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_sales_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_purchase_bill(p_bill_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill RECORD;
  v_existing_reversal uuid;
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

  -- Â§J2: money moved => cancellation blocked, refund via debit-note path
  IF v_bill.paid_amount > 0 OR v_bill.payment_status <> 'unpaid' THEN
    RAISE EXCEPTION 'Paid or partially paid bills cannot be cancelled; use the debit-note flow';
  END IF;

  IF v_bill.status = 'cancelled' THEN
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

  RETURN reverse_purchase_bill_journal(p_bill_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_purchase_bill(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_purchase_bill(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_purchase_bill(uuid) TO authenticated;

/*
# 018 â€” Bookkeeping completeness (T18)

## (a) post_expense_journal(p_expense_id uuid) RETURNS uuid
Expenses finally hit the books (were invisible to TB/P&L before).
- Debit: ledger named after the expense category (find-or-create,
  group 'Indirect Expense'; missing category -> 'Miscellaneous Expense').
- Credit side honours R9 and canonical cash names:
    payment_method 'cash'                      -> 'Cash'   (Cash & Bank)
    'bank'/'upi'/'card'/'cheque'               -> 'Bank'   (Cash & Bank)
    'credit' or anything else                  -> 'Expense Payable'
                                                 (Current Liabilities)
  Money only moved when it moved: 'credit' expenses post against a
  payables ledger, never against cash/bank.
- Amount = COALESCE(total_amount, amount + tax_amount); must be > 0.
- Duplicate-safe via reference_type 'expense' + reference_id (returns the
  existing entry id instead of double-posting).
- Note: expenses.payment_method has no CHECK constraint (schema reality);
  anything unrecognised lands on the payables ledger, never on cash.

## (b) post_stock_adjustment_journal(
         p_business_id uuid, p_product_id uuid, p_quantity_change numeric,
         p_reference_id uuid, p_notes text DEFAULT NULL,
         p_date date DEFAULT CURRENT_DATE) RETURNS uuid
Inventory valuation moves with adjustments (still invisible to books
today). p_reference_id (the stock_movement id driving the change) is
REQUIRED -> duplicate-safe.
- Valuation basis: abs(quantity_change) * products.selling_price â€” RETAIL
  basis, flagged until T41 introduces cost layers (FIFO/WAC).
- increase: Dr Inventory / Cr 'Stock Adjustments' (Indirect Expense)
  decrease: Dr 'Stock Adjustments' / Cr Inventory
  One plug ledger both directions keeps P&L net effect correct.
- Zero-valued adjustments raise (the engine forbids zero JEs anyway).

## (c) CoA seed completion â€” idempotent backfill
Adds the four missing system ledgers to EVERY business (existing ones get
them here; future businesses are covered lazily by find_or_create_account
on first use, since migration 002 may not be edited):
  Inventory              Current Assets
  Duties & Taxes         Current Liabilities   (GST liability home)
  Opening Balance Equity Capital Account       (counterweight for T19's
                                                opening-balance workflow)
  Capital                Capital Account

Boundaries respected: additive only, no client files, no enum changes,
taxed-doc posting bodies untouched. Statics: paired $$ bodies, IF/END IF
balanced.
*/

-- ============================================================================
-- (c) Backfill system ledgers for every business (idempotent)
-- ============================================================================
INSERT INTO public.accounts (business_id, name, group_name, opening_balance, current_balance, is_system)
SELECT b.id, s.name, s.group_name, 0, 0, true
FROM public.businesses b
CROSS JOIN (VALUES
  ('Inventory', 'Current Assets'),
  ('Duties & Taxes', 'Current Liabilities'),
  ('Opening Balance Equity', 'Capital Account'),
  ('Capital', 'Capital Account')
) AS s(name, group_name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts x
  WHERE x.business_id = b.id AND x.name = s.name
);

-- ============================================================================
-- (a) Expense journal path
-- ============================================================================
CREATE OR REPLACE FUNCTION post_expense_journal(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense RECORD;
  v_category_name text;
  v_expense_account_id uuid;
  v_credit_account_id uuid;
  v_entry_id uuid;
  v_existing uuid;
  v_lines jsonb;
  v_amount numeric(14,2);
BEGIN
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(v_expense.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Duplicate-safe: one journal per expense
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = v_expense.business_id
    AND reference_type = 'expense'
    AND reference_id = p_expense_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_amount := round(COALESCE(v_expense.total_amount,
                             COALESCE(v_expense.amount, 0) + COALESCE(v_expense.tax_amount, 0)), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Expense has no postable amount';
  END IF;

  SELECT name INTO v_category_name
  FROM expense_categories
  WHERE id = v_expense.category_id AND business_id = v_expense.business_id;

  v_expense_account_id := find_or_create_account(
    v_expense.business_id,
    COALESCE(v_category_name, 'Miscellaneous Expense'),
    'Indirect Expense'
  );

  -- R9: money moved vs money owed
  v_credit_account_id := CASE v_expense.payment_method
    WHEN 'cash' THEN find_or_create_account(v_expense.business_id, 'Cash', 'Cash & Bank')
    WHEN 'bank' THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    WHEN 'upi'  THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    WHEN 'card' THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    WHEN 'cheque' THEN find_or_create_account(v_expense.business_id, 'Bank', 'Cash & Bank')
    ELSE find_or_create_account(v_expense.business_id, 'Expense Payable', 'Current Liabilities')
  END;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_expense_account_id,
      'debit_amount', v_amount,
      'credit_amount', 0
    ),
    jsonb_build_object(
      'account_id', v_credit_account_id,
      'debit_amount', 0,
      'credit_amount', v_amount
    )
  );

  v_entry_id := post_journal_entry(
    v_expense.business_id,
    v_expense.date,
    'Expense ' || v_expense.expense_number || COALESCE(' - ' || v_expense.description, ''),
    'expense',
    p_expense_id,
    v_lines
  );

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_expense_journal(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_expense_journal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION post_expense_journal(uuid) TO authenticated;

-- ============================================================================
-- (b) Stock adjustment journal path (retail valuation until T41)
-- ============================================================================
CREATE OR REPLACE FUNCTION post_stock_adjustment_journal(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity_change numeric,
  p_reference_id uuid,
  p_notes text DEFAULT NULL,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_existing uuid;
  v_value numeric(14,2);
  v_inventory_account_id uuid;
  v_plug_account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF COALESCE(p_quantity_change, 0) = 0 THEN
    RAISE EXCEPTION 'Quantity change must be non-zero';
  END IF;

  IF p_reference_id IS NULL THEN
    RAISE EXCEPTION 'reference_id (stock_movement id) is required';
  END IF;

  -- Duplicate-safe: one journal per adjustment movement
  SELECT id INTO v_existing
  FROM journal_entries
  WHERE business_id = p_business_id
    AND reference_type = 'stock_adjustment'
    AND reference_id = p_reference_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = p_business_id AND type = 'product'
  ) THEN
    RAISE EXCEPTION 'Product % not found in this business', p_product_id;
  END IF;

  SELECT round(COALESCE(selling_price, 0) * abs(p_quantity_change), 2)
  INTO v_value
  FROM products
  WHERE id = p_product_id;

  IF v_value <= 0 THEN
    RAISE EXCEPTION 'Adjustment value is zero (selling price x quantity); nothing to journal';
  END IF;

  v_inventory_account_id := find_or_create_account(p_business_id, 'Inventory', 'Current Assets');
  v_plug_account_id := find_or_create_account(p_business_id, 'Stock Adjustments', 'Indirect Expense');

  IF p_quantity_change > 0 THEN
    -- stock came in: inventory up
    v_entry_id := post_journal_entry(
      p_business_id,
      p_date,
      'Stock adjustment ' || COALESCE(p_notes, ''),
      'stock_adjustment',
      p_reference_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_inventory_account_id, 'debit_amount', v_value, 'credit_amount', 0),
        jsonb_build_object('account_id', v_plug_account_id, 'debit_amount', 0, 'credit_amount', v_value)
      )
    );
  ELSE
    -- stock went out: inventory down
    v_entry_id := post_journal_entry(
      p_business_id,
      p_date,
      'Stock adjustment ' || COALESCE(p_notes, ''),
      'stock_adjustment',
      p_reference_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_plug_account_id, 'debit_amount', v_value, 'credit_amount', 0),
        jsonb_build_object('account_id', v_inventory_account_id, 'debit_amount', 0, 'credit_amount', v_value)
      )
    );
  END IF;

  RETURN v_entry_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION post_stock_adjustment_journal(uuid, uuid, numeric, uuid, text, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_stock_adjustment_journal(uuid, uuid, numeric, uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION post_stock_adjustment_journal(uuid, uuid, numeric, uuid, text, date) TO authenticated;

/*
# 019 â€” Ledger / Trial Balance correctness (T19)

## get_trial_balance(p_business_id, p_to_date DEFAULT NULL, p_from_date DEFAULT NULL)
Signature EXTENDED backwards-compatibly: the new period parameter is
appended last, every existing caller (as-of mode) keeps working untouched.
- As-of mode (p_from_date IS NULL): byte-for-byte today's semantics.
- Period mode (both bounds): opening_balance becomes the BROUGHT-FORWARD
  figure = stored opening + nature-signed posted movements strictly before
  p_from_date; period movements cover [from .. to]; closing = bf-opening +
  signed period movement. Global identity unchanged: closing == column
  opening + ALL signed movements up to to-date. Fixes Â§2.3.

## get_ledger(p_business_id, p_account_id, p_from_date DEFAULT NULL, p_to_date DEFAULT NULL)
RETURNS TABLE(entry_date date, entry_number text, narration text,
              debit_amount numeric, credit_amount numeric,
              running_balance numeric, is_brought_forward boolean)
The correct data shape for LedgerPage (consumption rewire is Stanley's):
- First row is a synthetic BROUGHT-FORWARD row (is_brought_forward = true)
  carrying the nature-adjusted opening as a debit/credit split, dated at
  p_from_date (else first movement date, else today).
- Rows then flow CHRONOLOGICALLY (e.date, e.created_at, e.id) â€” fixes the
  anti-chronological ordering bug of accounting.ts:198 / Â§2.2.
- running_balance is NATURE-SIGNED (TB-consistent): it starts at the
  signed brought-forward value on the BF row and advances by
  +(debit-credit) on debit-natured accounts, +(credit-debit) on
  credit-natured ones. Clients consume the provided column directly; no
  client-side nature math needed.
- Posted entries only, business-scoped, unknown account raises.

## set_account_opening_balance(p_business_id, p_account_id, p_opening_balance)
RETURNS numeric (the new opening)
Sanctioned opening-balance workflow with automatic Opening Balance Equity
counter-entry (Â§2.3 "out-of-balance TB is easy to produce"):
- Locks the account row; must belong to the business; targeting the OBE
  account itself is forbidden (it is the counterweight, not a subject).
- Sets opening_balance AND moves current_balance by the same delta â€”
  kills the R8 stale-current_balance drift in one stroke.
- Adjusts the business's 'Opening Balance Equity' ledger (auto-created,
  Capital Account group) by delta x nature-sign(target), keeping total
  Dr openings == total Cr openings so the TB stays globally balanced.
  Openings are positions, not transactions â€” deliberately NO journal here.
*/

-- ============================================================================
-- Extended trial balance (as-of kept intact; period mode added)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_trial_balance(
  p_business_id uuid,
  p_to_date date DEFAULT NULL,
  p_from_date date DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  account_name text,
  group_name text,
  code text,
  opening_balance numeric,
  period_debit numeric,
  period_credit numeric,
  closing_balance numeric,
  nature text
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
  SELECT
    a.id,
    a.name,
    a.group_name,
    a.code,
    (
      COALESCE(a.opening_balance, 0) +
      CASE WHEN p_from_date IS NOT NULL
        THEN CASE WHEN account_nature(a.group_name) = 'debit'
                   THEN COALESCE(mov.pre_debit, 0) - COALESCE(mov.pre_credit, 0)
                   ELSE COALESCE(mov.pre_credit, 0) - COALESCE(mov.pre_debit, 0) END
        ELSE 0 END
    )::numeric AS opening_balance,
    COALESCE(mov.per_debit, 0)::numeric AS period_debit,
    COALESCE(mov.per_credit, 0)::numeric AS period_credit,
    (
      COALESCE(a.opening_balance, 0) +
      CASE WHEN p_from_date IS NOT NULL
        THEN CASE WHEN account_nature(a.group_name) = 'debit'
                   THEN COALESCE(mov.pre_debit, 0) - COALESCE(mov.pre_credit, 0)
                   ELSE COALESCE(mov.pre_credit, 0) - COALESCE(mov.pre_debit, 0) END
        ELSE 0 END
      +
      CASE WHEN account_nature(a.group_name) = 'debit'
             THEN COALESCE(mov.per_debit, 0) - COALESCE(mov.per_credit, 0)
             ELSE COALESCE(mov.per_credit, 0) - COALESCE(mov.per_debit, 0) END
    )::numeric AS closing_balance,
    account_nature(a.group_name) AS nature
  FROM accounts a
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(l.debit_amount) FILTER (WHERE e.date < p_from_date), 0)  AS pre_debit,
      COALESCE(sum(l.credit_amount) FILTER (WHERE e.date < p_from_date), 0) AS pre_credit,
      COALESCE(sum(l.debit_amount) FILTER (
        WHERE (p_from_date IS NULL OR e.date >= p_from_date)
          AND (p_to_date IS NULL OR e.date <= p_to_date)), 0)               AS per_debit,
      COALESCE(sum(l.credit_amount) FILTER (
        WHERE (p_from_date IS NULL OR e.date >= p_from_date)
          AND (p_to_date IS NULL OR e.date <= p_to_date)), 0)               AS per_credit
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = a.id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
  ) mov ON true
  WHERE a.business_id = p_business_id
  ORDER BY a.group_name, a.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_trial_balance(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_trial_balance(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_trial_balance(uuid, date, date) TO authenticated;

-- ============================================================================
-- Correct ledger shape: brought-forward + chronological + signed running
-- ============================================================================
CREATE OR REPLACE FUNCTION get_ledger(
  p_business_id uuid,
  p_account_id uuid,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  entry_date date,
  entry_number text,
  narration text,
  debit_amount numeric,
  credit_amount numeric,
  running_balance numeric,
  is_brought_forward boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct RECORD;
  v_sign int;
  v_bf numeric;
  v_running numeric;
  v_split_dr numeric(14,2);
  v_split_cr numeric(14,2);
  v_bf_date date;
  r RECORD;
BEGIN
  SELECT * INTO v_acct
  FROM accounts
  WHERE id = p_account_id AND business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found in this business';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_sign := CASE WHEN account_nature(v_acct.group_name) = 'debit' THEN 1 ELSE -1 END;

  -- Brought forward: stored opening + nature-signed posted movements before from-date
  IF p_from_date IS NULL THEN
    v_bf := COALESCE(v_acct.opening_balance, 0);
  ELSE
    SELECT COALESCE(v_acct.opening_balance, 0) + v_sign * COALESCE(sum(l.debit_amount - l.credit_amount), 0)
    INTO v_bf
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = p_account_id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date < p_from_date;
  END IF;

  -- Display split of the BF position onto raw debit/credit cells
  IF v_bf >= 0 THEN
    v_split_dr := round(v_bf, 2);
    v_split_cr := 0;
  ELSE
    v_split_dr := 0;
    v_split_cr := round(-v_bf, 2);
  END IF;

  SELECT COALESCE(min(e.date), COALESCE(p_from_date, CURRENT_DATE))
  INTO v_bf_date
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  WHERE l.account_id = p_account_id
    AND l.business_id = p_business_id
    AND e.status = 'posted';

  v_running := v_bf;

  entry_date         := v_bf_date;
  entry_number       := NULL;
  narration          := 'Brought forward';
  debit_amount       := v_split_dr;
  credit_amount      := v_split_cr;
  running_balance    := round(v_running, 2);
  is_brought_forward := true;
  RETURN NEXT;

  FOR r IN
    SELECT e.date AS e_date, e.entry_number, e.narration,
           l.debit_amount, l.credit_amount
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = p_account_id
      AND l.business_id = p_business_id
      AND e.status = 'posted'
      AND (p_from_date IS NULL OR e.date >= p_from_date)
      AND (p_to_date IS NULL OR e.date <= p_to_date)
    ORDER BY e.date ASC, e.created_at ASC, e.id ASC
  LOOP
    v_running := v_running + v_sign * (COALESCE(r.debit_amount, 0) - COALESCE(r.credit_amount, 0));

    entry_date         := r.e_date;
    entry_number       := r.entry_number;
    narration          := r.narration;
    debit_amount       := r.debit_amount;
    credit_amount      := r.credit_amount;
    running_balance    := round(v_running, 2);
    is_brought_forward := false;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_ledger(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ledger(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_ledger(uuid, uuid, date, date) TO authenticated;

-- ============================================================================
-- Opening-balance workflow with automatic OBE counterweight (R8 fix)
-- ============================================================================
CREATE OR REPLACE FUNCTION set_account_opening_balance(
  p_business_id uuid,
  p_account_id uuid,
  p_opening_balance numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct RECORD;
  v_delta numeric(14,2);
  v_sign int;
  v_obe_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_acct
  FROM accounts
  WHERE id = p_account_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found in this business';
  END IF;

  IF v_acct.name = 'Opening Balance Equity' THEN
    RAISE EXCEPTION 'Opening Balance Equity is the counterweight account; adjust a real account instead';
  END IF;

  v_delta := round(COALESCE(p_opening_balance, 0), 2) - COALESCE(v_acct.opening_balance, 0);

  IF v_delta = 0 THEN
    RETURN COALESCE(v_acct.opening_balance, 0);
  END IF;

  v_sign := CASE WHEN account_nature(v_acct.group_name) = 'debit' THEN 1 ELSE -1 END;

  UPDATE accounts
  SET opening_balance = round(COALESCE(p_opening_balance, 0), 2),
      current_balance = round(COALESCE(current_balance, 0) + v_delta, 2)
  WHERE id = p_account_id;

  -- Counterweight moves opposite in stored terms via nature sign
  v_obe_id := find_or_create_account(p_business_id, 'Opening Balance Equity', 'Capital Account');

  UPDATE accounts
  SET opening_balance = round(COALESCE(opening_balance, 0) + v_delta * v_sign, 2),
      current_balance = round(COALESCE(current_balance, 0) + v_delta * v_sign, 2)
  WHERE id = v_obe_id;

  RETURN round(COALESCE(p_opening_balance, 0), 2);
END;
$$;

REVOKE EXECUTE ON FUNCTION set_account_opening_balance(uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_account_opening_balance(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION set_account_opening_balance(uuid, uuid, numeric) TO authenticated;

/*
# 020 â€” Reporting core: KPIs, P&L, Balance Sheet, cashflow, day-book, aging BASES (T20)

Read-only reporting layer. VIEWS are created WITH (security_invoker = on) so
RLS keeps applying through them (Supabase PG15+); RPCs are SECURITY DEFINER
with the standard auth/business guards.

STABLE COLUMN CONTRACTS (FE binds against these; do not rename):

- v_dashboard_kpis: ONE ROW PER BUSINESS
    business_id, sales_total, sales_count, purchases_total, purchases_count,
    expenses_total, receivables_outstanding, receivables_overdue,
    payables_outstanding, payables_overdue, cash_in_hand, bank_balance,
    collections_today, payouts_today
  Live docs only (sales: issued/partially_paid/paid; purchases:
  confirmed/partially_paid/paid). Overdue = unpaid portion past due_date.
  This view is the SINGLE SOURCE for dashboard numbers: accrual totals
  (docs) and realized cash (collections/payouts) come from the same query
  surface â€” absorbs the T45 accrual-vs-balance-history delta wish.

- v_cashflow_daily: business_id, flow_date, inflow, outflow
  Journal lines hitting the canonical Cash/Bank ledgers (post-013b names),
  posted entries only. Debit = money in, credit = money out.

- v_day_book: business_id, entry_date, doc_type, doc_id, doc_number,
    party_name, description, debit_ledger, credit_ledger, amount
  Legs: sale, purchase, expense, payment_received, payment_made, journal.
  Manual/posted journals appear once per entry (aggregated sides).

- v_receivables_aging_base / v_payables_aging_base: one row per LIVE doc
    (business_id, doc_id, doc_number, party_id, party_name, doc_date,
     due_date, grand_total, paid_amount, outstanding,
     days_outstanding, days_overdue)
  outstanding is COMPUTED (grand_total - paid_amount), never trusted from
  balance_amount. T28 buckets build strictly on these.

RPCs:
- get_profit_and_loss(biz, from, to) -> section, group_name, account_id,
    account_name, amount  [amount nature-signed positive within section;
    final row section='Summary', account_name='Net Profit']
- get_balance_sheet(biz, as_of DEFAULT NULL) -> group_name, account_id,
    account_name, closing_balance (nature-signed), nature; plus synthetic
    'Retained Earnings (P&L to date)' row under Capital Account so assets
    == liabilities + capital + P&L-to-date ties arithmetically.
*/

-- ============================================================================
-- DASHBOARD KPIs (single source)
-- ============================================================================
CREATE OR REPLACE VIEW v_dashboard_kpis WITH (security_invoker = on) AS
SELECT
  b.id AS business_id,
  COALESCE(s.total, 0)::numeric          AS sales_total,
  COALESCE(s.cnt, 0)                     AS sales_count,
  COALESCE(pu.total, 0)::numeric         AS purchases_total,
  COALESCE(pu.cnt, 0)                    AS purchases_count,
  COALESCE(ex.total, 0)::numeric         AS expenses_total,
  COALESCE(s.outstanding, 0)::numeric    AS receivables_outstanding,
  COALESCE(s.overdue, 0)::numeric        AS receivables_overdue,
  COALESCE(pu.outstanding, 0)::numeric   AS payables_outstanding,
  COALESCE(pu.overdue, 0)::numeric       AS payables_overdue,
  COALESCE(cash.bal, 0)::numeric         AS cash_in_hand,
  COALESCE(bank.bal, 0)::numeric         AS bank_balance,
  COALESCE(coll.today_amt, 0)::numeric   AS collections_today,
  COALESCE(pay.today_amt, 0)::numeric    AS payouts_today
FROM businesses b
LEFT JOIN LATERAL (
  SELECT
    sum(si.grand_total)                                        AS total,
    count(*)                                                   AS cnt,
    sum(GREATEST(si.grand_total - si.paid_amount, 0))
      FILTER (WHERE si.payment_status <> 'paid')               AS outstanding,
    sum(GREATEST(si.grand_total - si.paid_amount, 0))
      FILTER (WHERE si.payment_status <> 'paid'
               AND si.due_date < CURRENT_DATE)                 AS overdue
  FROM sales_invoices si
  WHERE si.business_id = b.id
    AND si.status IN ('issued', 'partially_paid', 'paid')
) s ON true
LEFT JOIN LATERAL (
  SELECT
    sum(pb.grand_total)                                        AS total,
    count(*)                                                   AS cnt,
    sum(GREATEST(pb.grand_total - pb.paid_amount, 0))
      FILTER (WHERE pb.payment_status <> 'paid')               AS outstanding,
    sum(GREATEST(pb.grand_total - pb.paid_amount, 0))
      FILTER (WHERE pb.payment_status <> 'paid'
               AND pb.due_date < CURRENT_DATE)                 AS overdue
  FROM purchase_bills pb
  WHERE pb.business_id = b.id
    AND pb.status IN ('confirmed', 'partially_paid', 'paid')
) pu ON true
LEFT JOIN LATERAL (
  SELECT sum(e.total_amount) AS total
  FROM expenses e
  WHERE e.business_id = b.id
) ex ON true
LEFT JOIN LATERAL (
  SELECT sum(a.current_balance) AS bal
  FROM accounts a
  WHERE a.business_id = b.id AND a.name = 'Cash'
) cash ON true
LEFT JOIN LATERAL (
  SELECT sum(a.current_balance) AS bal
  FROM accounts a
  WHERE a.business_id = b.id AND a.name = 'Bank'
) bank ON true
LEFT JOIN LATERAL (
  SELECT sum(pm.amount) AS today_amt
  FROM payments pm
  WHERE pm.business_id = b.id AND pm.type = 'received'
    AND pm.date = CURRENT_DATE
) coll ON true
LEFT JOIN LATERAL (
  SELECT sum(pm.amount) AS today_amt
  FROM payments pm
  WHERE pm.business_id = b.id AND pm.type = 'made'
    AND pm.date = CURRENT_DATE
) pay ON true;

-- ============================================================================
-- DAILY CASHFLOW (canonical Cash/Bank ledger lines)
-- ============================================================================
CREATE OR REPLACE VIEW v_cashflow_daily WITH (security_invoker = on) AS
SELECT
  l.business_id,
  e.date AS flow_date,
  COALESCE(sum(l.debit_amount), 0)::numeric  AS inflow,
  COALESCE(sum(l.credit_amount), 0)::numeric AS outflow
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.entry_id
JOIN accounts a ON a.id = l.account_id
WHERE e.status = 'posted'
  AND a.name IN ('Cash', 'Bank')
GROUP BY l.business_id, e.date;

-- ============================================================================
-- DAY BOOK (unified document feed)
-- ============================================================================
CREATE OR REPLACE VIEW v_day_book WITH (security_invoker = on) AS
SELECT si.business_id, si.invoice_date AS entry_date, 'sale'::text AS doc_type,
       si.id AS doc_id, si.invoice_number AS doc_number, c.name AS party_name,
       'Sales invoice'::text AS description,
       'Accounts Receivable'::text AS debit_ledger,
       'Sales Revenue'::text AS credit_ledger,
       si.grand_total::numeric AS amount
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
UNION ALL
SELECT pb.business_id, pb.bill_date, 'purchase'::text, pb.id, pb.bill_number,
       sp.name, 'Purchase bill'::text,
       'Purchases'::text, 'Accounts Payable'::text, pb.grand_total::numeric
FROM purchase_bills pb
JOIN suppliers sp ON sp.id = pb.supplier_id
WHERE pb.status IN ('confirmed', 'partially_paid', 'paid')
UNION ALL
SELECT ex.business_id, ex.date, 'expense'::text, ex.id, ex.expense_number,
       NULL::text, COALESCE(ec.name, 'Miscellaneous') || ' expense',
       COALESCE(ec.name, 'Miscellaneous Expense') AS debit_ledger,
       CASE ex.payment_method
         WHEN 'cash' THEN 'Cash'
         WHEN 'bank' THEN 'Bank'
         WHEN 'upi' THEN 'Bank'
         WHEN 'card' THEN 'Bank'
         WHEN 'cheque' THEN 'Bank'
         ELSE 'Expense Payable'
       END::text, ex.total_amount::numeric
FROM expenses ex
LEFT JOIN expense_categories ec ON ec.id = ex.category_id
UNION ALL
SELECT pm.business_id, pm.date, 'payment_received'::text, pm.id, pm.payment_number,
       cu.name, 'Payment received'::text,
       CASE pm.payment_method WHEN 'cash' THEN 'Cash' ELSE 'Bank' END,
       'Accounts Receivable'::text, pm.amount::numeric
FROM payments pm
JOIN customers cu ON cu.id = pm.party_id AND pm.party_type = 'customer'
WHERE pm.type = 'received'
UNION ALL
SELECT pm.business_id, pm.date, 'payment_made'::text, pm.id, pm.payment_number,
       su.name, 'Payment made'::text,
       'Accounts Payable'::text,
       CASE pm.payment_method WHEN 'cash' THEN 'Cash' ELSE 'Bank' END,
       pm.amount::numeric
FROM payments pm
JOIN suppliers su ON su.id = pm.party_id AND pm.party_type = 'supplier'
WHERE pm.type = 'made';

-- ============================================================================
-- AGING BASES (consumed verbatim by 021 buckets/statements)
-- ============================================================================
CREATE OR REPLACE VIEW v_receivables_aging_base WITH (security_invoker = on) AS
SELECT
  si.business_id,
  si.id            AS doc_id,
  si.invoice_number AS doc_number,
  si.customer_id   AS party_id,
  c.name           AS party_name,
  si.invoice_date  AS doc_date,
  COALESCE(si.due_date, si.invoice_date) AS due_date,
  si.grand_total::numeric AS grand_total,
  si.paid_amount::numeric AS paid_amount,
  GREATEST(si.grand_total - si.paid_amount, 0)::numeric AS outstanding,
  GREATEST(CURRENT_DATE - si.invoice_date, 0) AS days_outstanding,
  GREATEST(CURRENT_DATE - COALESCE(si.due_date, si.invoice_date), 0) AS days_overdue
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.status IN ('issued', 'partially_paid', 'paid');

CREATE OR REPLACE VIEW v_payables_aging_base WITH (security_invoker = on) AS
SELECT
  pb.business_id,
  pb.id            AS doc_id,
  pb.bill_number   AS doc_number,
  pb.supplier_id   AS party_id,
  sp.name          AS party_name,
  pb.bill_date     AS doc_date,
  COALESCE(pb.due_date, pb.bill_date) AS due_date,
  pb.grand_total::numeric AS grand_total,
  pb.paid_amount::numeric AS paid_amount,
  GREATEST(pb.grand_total - pb.paid_amount, 0)::numeric AS outstanding,
  GREATEST(CURRENT_DATE - pb.bill_date, 0) AS days_outstanding,
  GREATEST(CURRENT_DATE - COALESCE(pb.due_date, pb.bill_date), 0) AS days_overdue
FROM purchase_bills pb
JOIN suppliers sp ON sp.id = pb.supplier_id
WHERE pb.status IN ('confirmed', 'partially_paid', 'paid');

-- ============================================================================
-- PROFIT & LOSS (windowed, nature-signed amounts per account)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_profit_and_loss(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS TABLE (
  section text,
  group_name text,
  account_id uuid,
  account_name text,
  amount numeric
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
  WITH mov AS (
    SELECT l.account_id,
           COALESCE(sum(l.debit_amount), 0)  AS dr,
           COALESCE(sum(l.credit_amount), 0) AS cr
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date >= p_from_date
      AND e.date <= p_to_date
    GROUP BY l.account_id
  ),
  classified AS (
    SELECT
      CASE
        WHEN a.group_name LIKE 'Income%' THEN 'Income'
        WHEN a.group_name = 'Direct Expense' THEN 'Direct Expense'
        WHEN a.group_name LIKE 'Indirect Expense%' THEN 'Indirect Expense'
      END AS c_section,
      a.group_name AS c_group,
      a.id AS c_account_id,
      a.name AS c_account_name,
      CASE WHEN a.group_name LIKE 'Income%'
        THEN COALESCE(m.cr, 0) - COALESCE(m.dr, 0)
        ELSE COALESCE(m.dr, 0) - COALESCE(m.cr, 0)
      END AS c_amt
    FROM accounts a
    LEFT JOIN mov m ON m.account_id = a.id
    WHERE a.business_id = p_business_id
      AND (a.group_name LIKE 'Income%'
           OR a.group_name = 'Direct Expense'
           OR a.group_name LIKE 'Indirect Expense%')
  )
  SELECT c_section AS section, c_group AS group_name,
         c_account_id AS account_id, c_account_name AS account_name,
         round(c_amt, 2) AS amount
  FROM classified
  WHERE c_section IS NOT NULL AND c_amt <> 0
  UNION ALL
  SELECT 'Summary', 'Net Profit'::text, NULL::uuid, 'Net Profit'::text,
         round(COALESCE(sum(CASE WHEN c_section = 'Income' THEN c_amt
                                 ELSE -c_amt END), 0), 2)
  FROM classified
  WHERE c_section IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_profit_and_loss(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_profit_and_loss(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_profit_and_loss(uuid, date, date) TO authenticated;

-- ============================================================================
-- BALANCE SHEET (as-of, incl. synthetic retained earnings so it ties)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_balance_sheet(
  p_business_id uuid,
  p_as_of date DEFAULT NULL
)
RETURNS TABLE (
  group_name text,
  account_id uuid,
  account_name text,
  closing_balance numeric,
  nature text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_as_of := COALESCE(p_as_of, CURRENT_DATE);

  RETURN QUERY
  WITH mov AS (
    SELECT l.account_id,
           COALESCE(sum(l.debit_amount), 0)  AS dr,
           COALESCE(sum(l.credit_amount), 0) AS cr
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date <= v_as_of
    GROUP BY l.account_id
  ),
  bs_accounts AS (
    SELECT
      a.group_name,
      a.id AS account_id2,
      a.name AS account_name2,
      COALESCE(a.opening_balance, 0) +
        CASE WHEN account_nature(a.group_name) = 'debit'
          THEN COALESCE(m.dr, 0) - COALESCE(m.cr, 0)
          ELSE COALESCE(m.cr, 0) - COALESCE(m.dr, 0)
        END AS closing_balance2,
      account_nature(a.group_name) AS nature2
    FROM accounts a
    LEFT JOIN mov m ON m.account_id = a.id
    WHERE a.business_id = p_business_id
      AND (a.group_name LIKE '%Asset%'
           OR a.group_name IN ('Current Liabilities', 'Long Term Liabilities',
                               'Capital Account'))
  ),
  pnl_to_date AS (
    SELECT
      COALESCE(sum(CASE WHEN a.group_name LIKE 'Income%'
        THEN COALESCE(m.cr, 0) - COALESCE(m.dr, 0)
        ELSE -(COALESCE(m.dr, 0) - COALESCE(m.cr, 0)) END), 0) AS net
    FROM accounts a
    LEFT JOIN mov m ON m.account_id = a.id
    WHERE a.business_id = p_business_id
      AND (a.group_name LIKE 'Income%'
           OR a.group_name = 'Direct Expense'
           OR a.group_name LIKE 'Indirect Expense%')
  )
  SELECT b.group_name, b.account_id2, b.account_name2,
         round(b.closing_balance2, 2), b.nature2
  FROM bs_accounts b
  UNION ALL
  SELECT 'Capital Account', NULL::uuid,
         'Retained Earnings (P&L to date)', round(pl.net, 2), 'credit'
  FROM pnl_to_date pl;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_balance_sheet(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_balance_sheet(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_balance_sheet(uuid, date) TO authenticated;

/*
# 021 â€” AR/AP aging reports + party statements (T28)

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
  <= p_as_of) â€” NOT the live paid_amount column, so past-date runs are
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

/*
# 022 â€” Credit/Debit Notes: schema + reversal-integrated RPCs (T26) + expense numbering (T50)

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
  Output/Input GST ledgers, Round Off same-sign convention as 013b) â€”
  internally balanced by construction. If restock: per-item RMW stock
  restore/return with insufficient-stock guard (sale_return / purchase_return).
- apply_credit_note(biz, credit_note_id, p_refund_method DEFAULT 'bank') /
  apply_debit_note(...)
  issued -> applied against the parent doc. Offset part reduces the live
  doc's outstanding (memo allocation â€” AR/AP already moved at issue).
  Paid-doc rule: any portion beyond current outstanding routes through a
  payments row (type='refund' / 'refund_received', numbered via the
  service RCV/PAY counters) plus its cash JE. Partially-paid parents get
  the split automatically.
- cancel_credit_note(biz, credit_note_id) / cancel_debit_note(...)
  draft: status flip only. issued: mirror-cancellation JE (reads the
  actually-posted lines and swaps them â€” cannot drift) + opposite stock
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

/*
# 023 â€” Stock integrity: recompute + append-only triggers (T52)

1. trg_stock_recompute â€” statement-level AFTER INSERT OR DELETE
   on stock_movements; recomputes products.current_stock as SUM(signed
   quantity) over ALL movements of each touched product via transition
   tables. Self-heals any RMW drift; composes with existing RPC row-lock
   flows (their own current_stock writes happen before the movement insert;
   this trigger then runs last-in-txn and wins with the canonical figure).
   Sign convention verified against actual writers: 'sale' stores -qty,
   'purchase'/'opening'/'sale_return'/'adjustment_in' store +qty,
   'purchase_return'/'transfer_out'/'adjustment_out' store -qty.
2. trg_stock_append_only â€” BEFORE UPDATE OR DELETE on stock_movements,
   RAISEs unconditionally. History becomes immutable; corrections are new
   compensating movements (the cancel-RPC pattern from 022).

Both functions SECURITY DEFINER (search_path pinned) so the recompute
bypasses products RLS regardless of invoker, matching m003 hardening.
*/

CREATE OR REPLACE FUNCTION recompute_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products p
  SET current_stock = round(COALESCE(agg.qty, 0), 2)
  FROM (
    SELECT sm.product_id, SUM(sm.quantity) AS qty
    FROM stock_movements sm
    WHERE sm.product_id IN (
      SELECT product_id FROM nt
      UNION
      SELECT product_id FROM ot
    )
    GROUP BY sm.product_id
  ) agg
  WHERE p.id = agg.product_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_recompute ON stock_movements;
-- Split problematic combined trigger into two dedicated triggers
DROP TRIGGER IF EXISTS trg_stock_recompute ON stock_movements;
DROP TRIGGER IF EXISTS trg_stock_recompute_ins ON stock_movements;
DROP TRIGGER IF EXISTS trg_stock_recompute_del ON stock_movements;

CREATE TRIGGER trg_stock_recompute_ins
AFTER INSERT ON stock_movements
REFERENCING NEW TABLE AS nt
FOR EACH STATEMENT
EXECUTE FUNCTION recompute_product_stock();

CREATE TRIGGER trg_stock_recompute_del
AFTER DELETE ON stock_movements
REFERENCING OLD TABLE AS ot
FOR EACH STATEMENT
EXECUTE FUNCTION recompute_product_stock();

-- ============================================================================
CREATE OR REPLACE FUNCTION forbid_stock_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only; post a compensating movement instead';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_append_only ON stock_movements;
CREATE TRIGGER trg_stock_append_only
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH STATEMENT
EXECUTE FUNCTION forbid_stock_movement_mutation();



/*
# 024 â€” RLS tightening (T29)

1. businesses_update: any-member -> owner/admin only (is_business_admin).
   Profile edits are a governance action, not a daily-use one.
2. NEW helper is_business_admin(b_id): active member with role
   owner/admin. SECURITY DEFINER, pinned search_path, EXECUTE to
   authenticated only (m004 regime).
3. audit_logs: permissive INSERT policy DROPPED. The audit trail is now
   server-written ONLY â€” inserts happen inside SECURITY DEFINER RPCs
   (017/022 flows already do); direct client inserts will be denied.
   FE paths still writing audit rows client-side must route through the
   document RPCs instead.
4. business_members DELETE: policy added (owner/admin gated) + companion
   remove_business_member(biz, target_user_id) RPC with guards:
   caller must be owner/admin; an owner row can only be removed by its
   own owner or when another owner remains (never leaves a headless
   business); self-removal allowed for non-owner roles; audit row written.
*/

-- ============================================================================
-- Admin helper
-- ============================================================================
CREATE OR REPLACE FUNCTION is_business_admin(b_id uuid)
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
      AND role IN ('owner', 'admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION is_business_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_business_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_business_admin(uuid) TO authenticated;

-- ============================================================================
-- businesses_update tightened
-- ============================================================================
DROP POLICY IF EXISTS "businesses_update" ON businesses;
CREATE POLICY "businesses_update" ON businesses FOR UPDATE
  TO authenticated USING (is_business_admin(businesses.id))
  WITH CHECK (is_business_admin(businesses.id));

-- ============================================================================
-- audit_logs: server-write only
-- ============================================================================
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;

-- ============================================================================
-- business_members: delete policy + removal RPC
-- ============================================================================
DROP POLICY IF EXISTS "members_delete" ON business_members;
CREATE POLICY "members_delete" ON business_members FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  );

CREATE OR REPLACE FUNCTION remove_business_member(
  p_business_id uuid,
  p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target RECORD;
  v_caller_is_owner boolean;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can remove members';
  END IF;

  SELECT * INTO v_target FROM business_members
  WHERE business_id = p_business_id AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found in this business';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = auth.uid()
      AND role = 'owner' AND is_active = true
  ) INTO v_caller_is_owner;

  IF v_target.role = 'owner' THEN
    IF NOT v_caller_is_owner THEN
      RAISE EXCEPTION 'Only an owner can remove another owner';
    END IF;

    SELECT count(*) INTO v_owner_count
    FROM business_members
    WHERE business_id = p_business_id
      AND role = 'owner' AND is_active = true;

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of a business';
    END IF;
  END IF;

  DELETE FROM business_members
  WHERE business_id = p_business_id AND user_id = p_target_user_id;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'member_removed', 'business_member', p_target_user_id,
          'Removed member with role ' || v_target.role);

  RETURN p_target_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_business_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION remove_business_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION remove_business_member(uuid, uuid) TO authenticated;

/*
# 025 â€” GST summary aggregation surface (T53)

get_gst_summary(biz, from, to) RETURNS TABLE(
  section        text,   -- 'Outward' | 'Inward' | 'Summary'
  ledger_name    text,   -- component ledger ('Output CGST', ...) or label
  taxable_amount numeric,
  cgst           numeric,
  sgst           numeric,
  igst           numeric,
  cess           numeric,
  net_amount     numeric -- signed position of THIS row
)

Built FROM JOURNAL LINES on the GST account groups per instruction:
- Outward = accounts in group 'GST Payable': liability grows on credit;
  amount = SUM(credit - debit) over posted entries in [from..to].
  Credit-notes naturally REDUCE outward (they debit Output GST).
- Inward = accounts in group 'GST Receivable': credit grows on debit;
  amount = SUM(debit - credit). Debit notes reduce inward symmetrically.
- Component classification by ledger-name suffix (CGST/SGST/IGST/Cess),
  so m011's original cess naming and 022's Output/Input Cess both land
  correctly regardless of which name a business actually uses.
- taxable_outward = signed movement on the canonical 'Sales' ledger
  (Direct Income); taxable_inward = signed movement on 'Purchases'
  (Direct Expense). Journal-truth, not doc-table truth â€” matches the JE
  posting engine single-source doctrine.
- Final row section='Summary', ledger_name='Net GST Payable':
  per-component outward-minus-inward plus net_position total; negative
  means refund/credit carried forward.

RPC chosen over view (period params required). SECURITY DEFINER +
standard guards so FE binds immediately.
*/

CREATE OR REPLACE FUNCTION get_gst_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS TABLE (
  section text,
  ledger_name text,
  taxable_amount numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric,
  net_amount numeric
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
  WITH mov AS (
    SELECT a.name, a.group_name,
           COALESCE(SUM(l.credit_amount - l.debit_amount), 0) AS c_bal,
           COALESCE(SUM(l.debit_amount - l.credit_amount), 0) AS d_bal
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.business_id = p_business_id
      AND e.status = 'posted'
      AND e.date >= p_from_date
      AND e.date <= p_to_date
      AND (
        a.group_name IN ('GST Payable', 'GST Receivable')
        OR (a.group_name = 'Direct Income' AND a.name = 'Sales')
        OR (a.group_name = 'Direct Expense' AND a.name = 'Purchases')
      )
    GROUP BY a.name, a.group_name
  ),
  comp AS (
    SELECT
      CASE WHEN m.group_name = 'GST Payable' THEN 'Outward'
           WHEN m.group_name = 'GST Receivable' THEN 'Inward'
      END AS sec,
      m.name AS lname,
      CASE WHEN m.name LIKE '%CGST%' THEN m.c_bal ELSE 0 END AS c_cg,
      CASE WHEN m.name LIKE '%SGST%' THEN m.c_bal ELSE 0 END AS c_sg,
      CASE WHEN m.name LIKE '%IGST%' THEN m.c_bal ELSE 0 END AS c_ig,
      CASE WHEN m.name LIKE '%Cess%' THEN m.c_bal ELSE 0 END AS c_ce,
      CASE WHEN m.name LIKE '%CGST%' THEN m.d_bal ELSE 0 END AS d_cg,
      CASE WHEN m.name LIKE '%SGST%' THEN m.d_bal ELSE 0 END AS d_sg,
      CASE WHEN m.name LIKE '%IGST%' THEN m.d_bal ELSE 0 END AS d_ig,
      CASE WHEN m.name LIKE '%Cess%' THEN m.d_bal ELSE 0 END AS d_ce
    FROM mov m
    WHERE m.group_name IN ('GST Payable', 'GST Receivable')
  ),
  taxable AS (
    SELECT
      round(COALESCE(SUM(m.c_bal) FILTER (WHERE m.group_name = 'Direct Income'), 0), 2) AS out_tax,
      round(COALESCE(SUM(m.d_bal) FILTER (WHERE m.group_name = 'Direct Expense'), 0), 2) AS in_tax
    FROM mov m
  )
  SELECT
    c.sec,
    c.lname,
    CASE WHEN c.sec = 'Outward' THEN t.out_tax ELSE t.in_tax END,
    round(c.c_cg + c.d_cg, 2),
    round(c.c_sg + c.d_sg, 2),
    round(c.c_ig + c.d_ig, 2),
    round(c.c_ce + c.d_ce, 2),
    round(c.c_cg + c.d_cg + c.c_sg + c.d_sg + c.c_ig + c.d_ig + c.c_ce + c.d_ce, 2)
  FROM comp c
  CROSS JOIN taxable t
  UNION ALL
  SELECT
    'Summary',
    'Net GST Payable',
    round(t.out_tax - t.in_tax, 2),
    round(SUM(c.c_cg + c.d_cg), 2),
    round(SUM(c.c_sg + c.d_sg), 2),
    round(SUM(c.c_ig + c.d_ig), 2),
    round(SUM(c.c_ce + c.d_ce), 2),
    round(SUM(c.c_cg + c.d_cg + c.c_sg + c.d_sg + c.c_ig + c.d_ig + c.c_ce + c.d_ce), 2)
  FROM comp c
  CROSS JOIN taxable t;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_gst_summary(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_gst_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_gst_summary(uuid, date, date) TO authenticated;

/*
# 026 â€” Quotes / Sales Orders / Purchase Orders schema (T33)

Numbering: document_sequences doc_type CHECK extended with
'quotation','sales_order','purchase_order' (dynamic constraint discovery);
next_document_number re-emitted body-identical plus prefixes
QT / SO / PO. NO stock impact anywhere on this card â€” conversion RPCs are
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
header block, per-item original structure with product refs (nullable â€”
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

/*
# 027 â€” Fiscal year close (T31)

SCHEMA: fiscal_year_closes â€” one row per (business, fy_label) closure.
businesses.financial_year (text label, m001) is used AS-IS; the close
ledger lives here instead of widening the businesses table. Update/Delete
policies deliberately OMITTED: closures are append-only history (reopen
marks the row, never rewrites it).

CONTRACTS (both admin-only via is_business_admin):

close_fiscal_year(p_business_id) RETURNS uuid (closing JE id)
- Locks the business row, reads financial_year label.
- Idempotency: RAISES if an UN-reopened close already exists for that
  label; after a reopen, the year may be closed again.
- Computes ALL-TIME-to-date nature-signed balances per account across
  Income groups (credit-positive) and Expense groups (debit-positive),
  posted entries only. Zero balances excluded. RAISES if there is
  nothing to close.
- Posts ONE balanced closing JE (reference_type 'fiscal_close'):
    Dr each income ledger (its balance)
    Cr each expense ledger (its balance)
    Cr 'Retained Earnings' / Capital Account by net (income - expenses)
  Debits == Credits by construction (expenses + net == income).
  This realizes 020's synthetic retained-earnings row into actual
  ledgers; afterwards the P&L groups sit at zero and the BS ties through
  Retained Earnings. Numbering: JE-FYCLOSE-<label>.
- Writes an audit_logs row. Returns the JE id.

reopen_fiscal_year(p_business_id) RETURNS uuid (reversal JE id)
- Finds the active close for the CURRENT label (RAISES if none/reopened).
- House-pattern reversal: READS the actually-posted close-JE lines and
  swaps sides into a mirror JE (reference_type 'fiscal_reopen'),
  numbered JE-FYREOPEN-<label>; marks the close row reopened_at=now().
- Audit row written. Returns the reversal JE id.
*/

-- ============================================================================
-- A. CLOSE LEDGER TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS fiscal_year_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fy_label text NOT NULL,
  close_date date NOT NULL DEFAULT CURRENT_DATE,
  closing_je_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopening_je_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- One ACTIVE closure per business at a time; historical (reopened) rows kept
CREATE UNIQUE INDEX IF NOT EXISTS uq_fyc_active_per_business
  ON fiscal_year_closes(business_id)
  WHERE reopened_at IS NULL;

ALTER TABLE fiscal_year_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fiscal_year_closes_select" ON fiscal_year_closes;
CREATE POLICY "fiscal_year_closes_select" ON fiscal_year_closes FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "fiscal_year_closes_insert" ON fiscal_year_closes;
CREATE POLICY "fiscal_year_closes_insert" ON fiscal_year_closes FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_fyc_business ON fiscal_year_closes(business_id);

-- ============================================================================
-- B. CLOSE
-- ============================================================================
CREATE OR REPLACE FUNCTION close_fiscal_year(
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy text;
  v_je uuid;
  v_close_id uuid;
  v_income_total numeric(14,2);
  v_expense_total numeric(14,2);
  v_net numeric(14,2);
  v_dr_sum numeric(14,2);
  v_cr_sum numeric(14,2);
  v_re uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can close a fiscal year';
  END IF;

  SELECT financial_year INTO v_fy
  FROM businesses
  WHERE id = p_business_id
  FOR UPDATE;

  IF v_fy IS NULL THEN
    RAISE EXCEPTION 'Business has no financial year label set';
  END IF;

  IF EXISTS (
    SELECT 1 FROM fiscal_year_closes
    WHERE business_id = p_business_id AND fy_label = v_fy
      AND reopened_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Fiscal year % is already closed', v_fy;
  END IF;

  -- Nature-signed all-time balances per P&L account
  SELECT
    COALESCE(SUM(CASE WHEN a.group_name LIKE '%Income%'
      THEN l.credit_amount - l.debit_amount END), 0),
    COALESCE(SUM(CASE WHEN a.group_name LIKE '%Expense%'
      THEN l.debit_amount - l.credit_amount END), 0)
  INTO v_income_total, v_expense_total
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id
    AND e.status = 'posted'
    AND (a.group_name LIKE '%Income%' OR a.group_name LIKE '%Expense%');

  v_net := round(v_income_total - v_expense_total, 2);

  IF v_income_total = 0 AND v_expense_total = 0 THEN
    RAISE EXCEPTION 'No open profit-and-loss balances to close';
  END IF;

  -- Per-account ROUNDED arm sums; header totals are derived from THESE so
  -- total_debit/credit equal the actual line sums to the penny.
  WITH acct AS (
    SELECT a.id, a.group_name AS g,
      CASE WHEN a.group_name LIKE '%Income%'
        THEN round(COALESCE(SUM(l.credit_amount - l.debit_amount), 0), 2)
        ELSE round(COALESCE(SUM(l.debit_amount - l.credit_amount), 0), 2)
      END AS bal
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.business_id = p_business_id AND e.status = 'posted'
      AND (a.group_name LIKE '%Income%' OR a.group_name LIKE '%Expense%')
    GROUP BY a.id, a.group_name
  )
  SELECT
    round(COALESCE(SUM(CASE WHEN g LIKE '%Income%'   AND bal > 0 THEN bal END), 0), 2)
      + round(COALESCE(SUM(CASE WHEN g LIKE '%Expense%' AND bal < 0 THEN -bal END), 0), 2)
      + round(GREATEST(-v_net, 0), 2),
    round(COALESCE(SUM(CASE WHEN g LIKE '%Expense%'  AND bal > 0 THEN bal END), 0), 2)
      + round(COALESCE(SUM(CASE WHEN g LIKE '%Income%'  AND bal < 0 THEN -bal END), 0), 2)
      + round(GREATEST(v_net, 0), 2)
  INTO v_dr_sum, v_cr_sum
  FROM acct;

  INSERT INTO fiscal_year_closes (business_id, fy_label, closed_by)
  VALUES (p_business_id, v_fy, auth.uid())
  RETURNING id INTO v_close_id;

  v_re := find_or_create_account(p_business_id, 'Retained Earnings', 'Capital Account');

  -- Four-arm line build keeps every amount non-negative even when an
  -- account carries a reversed-sign balance (e.g. debit-heavy income).
  INSERT INTO journal_entries (business_id, entry_number, date, narration,
    total_debit, total_credit, status, reference_type, reference_id, created_by)
  VALUES (p_business_id, 'JE-FYCLOSE-' || v_fy, CURRENT_DATE,
    'Fiscal year close ' || v_fy,
    v_dr_sum, v_cr_sum,
    'posted', 'fiscal_close', v_close_id, auth.uid())
  RETURNING id INTO v_je;

  INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
  SELECT p_business_id, v_je, a.id,
         round(COALESCE(SUM(l.credit_amount - l.debit_amount), 0), 2), 0
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Income%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.credit_amount - l.debit_amount), 0) > 0
  UNION ALL
  SELECT p_business_id, v_je, a.id, 0,
         round(-COALESCE(SUM(l.credit_amount - l.debit_amount), 0), 2)
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Income%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.credit_amount - l.debit_amount), 0) < 0
  UNION ALL
  SELECT p_business_id, v_je, a.id, 0,
         round(COALESCE(SUM(l.debit_amount - l.credit_amount), 0), 2)
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Expense%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.debit_amount - l.credit_amount), 0) > 0
  UNION ALL
  SELECT p_business_id, v_je, a.id,
         round(-COALESCE(SUM(l.debit_amount - l.credit_amount), 0), 2), 0
  FROM journal_entry_lines l
  JOIN journal_entries e ON e.id = l.entry_id
  JOIN accounts a ON a.id = l.account_id
  WHERE l.business_id = p_business_id AND e.status = 'posted'
    AND a.group_name LIKE '%Expense%'
  GROUP BY a.id
  HAVING COALESCE(SUM(l.debit_amount - l.credit_amount), 0) < 0;

  -- Counterweight: Retained Earnings absorbs the residual either direction
  IF v_net >= 0 THEN
    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_re, 0, v_net);
  ELSE
    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_re, -v_net, 0);
  END IF;

  UPDATE fiscal_year_closes
  SET closing_je_id = v_je
  WHERE id = v_close_id;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'fiscal_year_closed', 'fiscal_year_close', v_close_id,
          'FY ' || v_fy || ' closed; net ' || v_net::text || ' moved to Retained Earnings');

  RETURN v_je;
END;
$$;

REVOKE EXECUTE ON FUNCTION close_fiscal_year(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION close_fiscal_year(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION close_fiscal_year(uuid) TO authenticated;

-- ============================================================================
-- C. REOPEN
-- ============================================================================
CREATE OR REPLACE FUNCTION reopen_fiscal_year(
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy text;
  v_close RECORD;
  v_src RECORD;
  v_je uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can reopen a fiscal year';
  END IF;

  SELECT financial_year INTO v_fy
  FROM businesses
  WHERE id = p_business_id;

  SELECT * INTO v_close
  FROM fiscal_year_closes
  WHERE business_id = p_business_id AND fy_label = v_fy
  FOR UPDATE;

  IF NOT FOUND OR v_close.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fiscal year % is not currently closed', v_fy;
  END IF;

  -- House pattern: mirror the ACTUAL posted close lines, sides swapped
  INSERT INTO journal_entries (business_id, entry_number, date, narration,
    total_debit, total_credit, status, reference_type, reference_id, created_by)
  SELECT business_id, 'JE-FYREOPEN-' || v_close.fy_label, CURRENT_DATE,
    'Fiscal year reopen ' || v_close.fy_label,
    sum(debit_amount), sum(credit_amount), 'posted',
    'fiscal_reopen', v_close.id, auth.uid()
  FROM journal_entry_lines
  WHERE entry_id = v_close.closing_je_id
  GROUP BY business_id
  RETURNING id INTO v_je;

  FOR v_src IN
    SELECT account_id, debit_amount, credit_amount
    FROM journal_entry_lines
    WHERE entry_id = v_close.closing_je_id
  LOOP
    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_src.account_id, v_src.credit_amount, v_src.debit_amount);
  END LOOP;

  UPDATE fiscal_year_closes
  SET reopened_at = now(), reopening_je_id = v_je
  WHERE id = v_close.id;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'fiscal_year_reopened', 'fiscal_year_close', v_close.id,
          'FY ' || v_close.fy_label || ' reopened');

  RETURN v_je;
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_fiscal_year(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reopen_fiscal_year(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION reopen_fiscal_year(uuid) TO authenticated;

/*
# 028 â€” GST settlement flow (T32)

record_gst_settlement(p_business_id, p_from_date, p_to_date,
                      p_payment_date DEFAULT CURRENT_DATE,
                      p_mode DEFAULT 'bank') RETURNS uuid (JE id)

- ADMIN-GATED; serialized per business via pg_advisory_xact_lock.
- SINGLE SOURCE OF TRUTH FOR THE MATH: calls get_gst_summary() itself and
  works from its rows â€” the settlement can never disagree with the report
  FE displays. Component classification/naming quirks inherit 025's rules.
- OVERLAP GUARD: RAISES if [from..to] intersects any recorded settlement.
- ZERO-ACTIVITY GUARD: RAISES if both sides are nil (nothing settled).
- POSITIVE NET (liability payable): ONE balanced JE ref_type 'gst_settlement':
    Dr each Output ledger with credit balance (amount = its net)
    Dr each Input ledger with debit-side reversal (negative net rows mirror)
    Cr each Input ledger with credit balance
    Cr Cash|Bank by NET (mode: 'cash' -> Cash, anything else -> Bank)
  Four-arm non-negative build (house pattern, 027-exemplar): reversed-sign
  rows mirror instead of going negative; header totals derived from the
  SAME rounded row sums -> header == sum(lines) to the penny.
- ZERO NET WITH ACTIVITY: offsetting JE only, no cash leg (mode ignored).
- NEGATIVE NET (credit carry-forward): HONEST MEMO â€” NO journal is posted
  (a cash-free JE that moves nothing is noise and would falsely zero the
  input ledgers whose balances ARE the carried credit). The settlement is
  recorded with carry_forward=true, net stored, audit_logs row written;
  FE surfaces carry-forward from this table (matches 025's labeling).
- Entry number: JE-GSTSET-<from>-<to> (unique by construction: identical
  windows cannot coexist due to the overlap guard).
*/

-- ============================================================================
-- A. SETTLEMENT LEDGER
-- ============================================================================
CREATE TABLE IF NOT EXISTS gst_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  net_liability numeric(14,2) NOT NULL DEFAULT 0,
  output_total numeric(14,2) NOT NULL DEFAULT 0,
  input_total numeric(14,2) NOT NULL DEFAULT 0,
  settle_cgst numeric(14,2) NOT NULL DEFAULT 0,
  settle_sgst numeric(14,2) NOT NULL DEFAULT 0,
  settle_igst numeric(14,2) NOT NULL DEFAULT 0,
  settle_cess numeric(14,2) NOT NULL DEFAULT 0,
  carry_forward boolean NOT NULL DEFAULT false,
  payment_date date,
  mode text,
  je_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE gst_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gst_settlements_select" ON gst_settlements;
CREATE POLICY "gst_settlements_select" ON gst_settlements FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "gst_settlements_insert" ON gst_settlements;
CREATE POLICY "gst_settlements_insert" ON gst_settlements FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_gst_settlements_business ON gst_settlements(business_id, period_from);

-- ============================================================================
-- B. SETTLEMENT RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION record_gst_settlement(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_mode text DEFAULT 'bank'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_out numeric(14,2);
  v_in numeric(14,2);
  v_net numeric(14,2);
  v_dr_sum numeric(14,2);
  v_cr_sum numeric(14,2);
  v_je uuid;
  v_cash uuid;
  v_acct uuid;
  v_grp text;
  v_carry boolean;
  v_sgid uuid;
  v_cg numeric(14,2);
  v_sg numeric(14,2);
  v_ig numeric(14,2);
  v_ce numeric(14,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can record GST settlements';
  END IF;

  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Settlement window is inverted';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('gst_settle:' || p_business_id::text));

  IF EXISTS (
    SELECT 1 FROM gst_settlements
    WHERE business_id = p_business_id
      AND period_from <= p_to_date
      AND period_to >= p_from_date
  ) THEN
    RAISE EXCEPTION 'Settlement window overlaps an existing settlement';
  END IF;

  -- Single source of truth: the summary RPC's own numbers
  SELECT
    COALESCE(SUM(net_amount) FILTER (WHERE section = 'Outward'), 0),
    COALESCE(SUM(net_amount) FILTER (WHERE section = 'Inward'), 0),
    COALESCE(MAX(cgst) FILTER (WHERE section = 'Summary'), 0),
    COALESCE(MAX(sgst) FILTER (WHERE section = 'Summary'), 0),
    COALESCE(MAX(igst) FILTER (WHERE section = 'Summary'), 0),
    COALESCE(MAX(cess) FILTER (WHERE section = 'Summary'), 0)
  INTO v_out, v_in, v_cg, v_sg, v_ig, v_ce
  FROM get_gst_summary(p_business_id, p_from_date, p_to_date);

  v_net := round(v_out - v_in, 2);

  IF v_out = 0 AND v_in = 0 THEN
    RAISE EXCEPTION 'No GST activity in the selected window';
  END IF;

  v_carry := v_net < 0;

  IF NOT v_carry THEN
    -- Pre-compute header totals from the same rounded row sums
    v_dr_sum := 0;
    v_cr_sum := 0;
    FOR r IN
      SELECT section, net_amount
      FROM get_gst_summary(p_business_id, p_from_date, p_to_date)
      WHERE section IN ('Outward', 'Inward')
    LOOP
      IF r.section = 'Outward' THEN
        IF r.net_amount > 0 THEN v_dr_sum := v_dr_sum + round(r.net_amount, 2);
        ELSE v_cr_sum := v_cr_sum + round(-r.net_amount, 2); END IF;
      ELSE
        IF r.net_amount > 0 THEN v_cr_sum := v_cr_sum + round(r.net_amount, 2);
        ELSE v_dr_sum := v_dr_sum + round(-r.net_amount, 2); END IF;
      END IF;
    END LOOP;

    IF v_net > 0 THEN
      v_cr_sum := v_cr_sum + v_net;
      IF p_mode = 'cash' THEN
        v_cash := find_or_create_account(p_business_id, 'Cash', 'Cash & Bank');
      ELSE
        v_cash := find_or_create_account(p_business_id, 'Bank', 'Cash & Bank');
      END IF;
    END IF;

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id,
      'JE-GSTSET-' || to_char(p_from_date, 'YYMMDD') || '-' || to_char(p_to_date, 'YYMMDD'),
      COALESCE(p_payment_date, CURRENT_DATE),
      'GST settlement ' || p_from_date || ' to ' || p_to_date ||
        CASE WHEN v_net > 0 THEN ' (paid)' ELSE ' (offset)' END,
      v_dr_sum, v_cr_sum,
      'posted', 'gst_settlement', NULL, auth.uid())
    RETURNING id INTO v_je;

    FOR r IN
      SELECT section, ledger_name, net_amount
      FROM get_gst_summary(p_business_id, p_from_date, p_to_date)
      WHERE section IN ('Outward', 'Inward')
    LOOP
      IF r.section = 'Outward' THEN v_grp := 'GST Payable'; ELSE v_grp := 'GST Receivable'; END IF;
      v_acct := find_or_create_account(p_business_id, r.ledger_name, v_grp);

      IF r.section = 'Outward' AND r.net_amount > 0 THEN
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, round(r.net_amount, 2), 0);
      ELSIF r.section = 'Outward' THEN
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, 0, round(-r.net_amount, 2));
      ELSIF r.net_amount > 0 THEN
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, 0, round(r.net_amount, 2));
      ELSE
        INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
        VALUES (p_business_id, v_je, v_acct, round(-r.net_amount, 2), 0);
      END IF;
    END LOOP;

    IF v_net > 0 THEN
      INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
      VALUES (p_business_id, v_je, v_cash, 0, v_net);
    END IF;
  END IF;

  INSERT INTO gst_settlements (business_id, period_from, period_to,
    net_liability, output_total, input_total,
    settle_cgst, settle_sgst, settle_igst, settle_cess,
    carry_forward, payment_date, mode, je_id, created_by)
  VALUES (p_business_id, p_from_date, p_to_date,
    v_net, round(v_out, 2), round(v_in, 2),
    round(v_cg, 2), round(v_sg, 2), round(v_ig, 2), round(v_ce, 2),
    v_carry,
    CASE WHEN v_carry OR v_net <= 0 THEN NULL ELSE COALESCE(p_payment_date, CURRENT_DATE) END,
    CASE WHEN v_carry OR v_net <= 0 THEN NULL ELSE p_mode END,
    v_je, auth.uid())
  RETURNING id INTO v_sgid;

  IF v_je IS NOT NULL THEN
    UPDATE gst_settlements SET je_id = v_je WHERE id = v_sgid;
  END IF;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'gst_settlement_recorded', 'gst_settlement', v_sgid,
          CASE WHEN v_carry
            THEN 'Credit carry-forward ' || (-v_net)::text || ' recorded for ' || p_from_date || '..' || p_to_date
            ELSE 'GST settled net ' || v_net::text || ' for ' || p_from_date || '..' || p_to_date
          END);

  RETURN COALESCE(v_je, v_sgid);
END;
$$;

REVOKE EXECUTE ON FUNCTION record_gst_settlement(uuid, date, date, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_gst_settlement(uuid, date, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_gst_settlement(uuid, date, date, date, text) TO authenticated;

/*
# 029 â€” Atomic payment-with-allocation RPC (T48)

create_payment_with_allocation(biz, type, party_id, amount,
    payment_date DEFAULT CURRENT_DATE, method DEFAULT 'cash',
    reference DEFAULT NULL, notes DEFAULT NULL)
RETURNS TABLE(payment_id uuid, journal_entry_id uuid, allocated_total numeric)

ONE TRANSACTION replaces Stanley's crash-prone 3-call client chain:
payment row + auto-allocation + JE + audit, committed or rolled back whole.

Semantics preserved EXACTLY from 015 by delegation:
- The payment row is inserted first and locked (fixed lock order:
  payment -> documents), documents then locked in deterministic
  (date, id) order â€” deadlock-safe under concurrency.
- Allocation walks the party's LIVE unsettled documents OLDEST-FIRST
  (sales: issued/partially_paid; purchases: confirmed/partially_paid),
  delegating each slice to 015's allocate_payment() itself â€” its J2
  guards, R5 shortfall RAISE, status/payment_status recompute and
  allocated_amount bookkeeping apply verbatim, zero logic drift.
- STRICT FULL-ALLOCATION: any remainder after all eligible docs RAISES
  (advances/on-account are not a silent fallback â€” matches 015's
  never-silently-less doctrine).
- JE mirrors m008/m009 conventions at full payment amount:
  received -> Dr Cash|Bank / Cr customer ledger (Sundry Debtors);
  made     -> Dr supplier ledger (Sundry Creditors) / Cr Cash|Bank.
  Numbering: next_document_number('payment_received'|'payment_made'),
  JE number = 'JE-' || payment_number (house pattern).
- Audit row written. Returns ids + total allocated (= amount).
*/

CREATE OR REPLACE FUNCTION create_payment_with_allocation(
  p_business_id uuid,
  p_type text,
  p_party_id uuid,
  p_amount numeric,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_method text DEFAULT 'cash',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  payment_id uuid,
  journal_entry_id uuid,
  allocated_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid;
  v_pay_no text;
  v_je uuid;
  v_cash_bank uuid;
  v_party_ledger uuid;
  v_party_name text;
  v_party_type text;
  v_ref_type text;
  v_remaining numeric(14,2);
  v_alloc numeric(14,2);
  r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_type NOT IN ('received', 'made') THEN
    RAISE EXCEPTION 'Payment type must be received or made';
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  IF p_method NOT IN ('cash', 'upi', 'bank', 'card', 'cheque') THEN
    RAISE EXCEPTION 'Unsupported payment method %', p_method;
  END IF;

  IF p_type = 'received' THEN
    v_party_type := 'customer';
    v_ref_type := 'sales_invoice';
    SELECT name INTO v_party_name FROM customers
    WHERE id = p_party_id AND business_id = p_business_id;
  ELSE
    v_party_type := 'supplier';
    v_ref_type := 'purchase_bill';
    SELECT name INTO v_party_name FROM suppliers
    WHERE id = p_party_id AND business_id = p_business_id;
  END IF;

  IF v_party_name IS NULL THEN
    RAISE EXCEPTION 'Party not found in this business';
  END IF;

  -- Payment row first: establishes 015's fixed lock order anchor
  v_pay_no := next_document_number(
    p_business_id,
    CASE WHEN p_type = 'received' THEN 'payment_received' ELSE 'payment_made' END,
    COALESCE(p_payment_date, CURRENT_DATE)
  );

  INSERT INTO payments (business_id, type, party_type, party_id,
    payment_number, date, amount, allocated_amount, payment_method,
    reference, notes, created_by)
  VALUES (p_business_id, p_type, v_party_type, p_party_id,
    v_pay_no, COALESCE(p_payment_date, CURRENT_DATE), round(p_amount, 2), 0,
    p_method, p_reference, p_notes, auth.uid())
  RETURNING id INTO v_pid;

  SELECT * INTO r FROM payments WHERE id = v_pid FOR UPDATE;

  -- Oldest-first walk over live unsettled documents, 015-delegated slices
  v_remaining := round(p_amount, 2);

  IF p_type = 'received' THEN
    FOR r IN
      SELECT id, GREATEST(balance_amount, 0) AS outstanding
      FROM sales_invoices
      WHERE business_id = p_business_id
        AND customer_id = p_party_id
        AND status IN ('issued', 'partially_paid')
        AND balance_amount > 0
      ORDER BY due_date ASC NULLS LAST, invoice_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := LEAST(v_remaining, r.outstanding);
      IF v_alloc > 0 THEN
        PERFORM allocate_payment(v_pid, 'sales_invoice', r.id, v_alloc);
        v_remaining := v_remaining - v_alloc;
      END IF;
    END LOOP;
  ELSE
    FOR r IN
      SELECT id, GREATEST(balance_amount, 0) AS outstanding
      FROM purchase_bills
      WHERE business_id = p_business_id
        AND supplier_id = p_party_id
        AND status IN ('confirmed', 'partially_paid')
        AND balance_amount > 0
      ORDER BY due_date ASC NULLS LAST, bill_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_alloc := LEAST(v_remaining, r.outstanding);
      IF v_alloc > 0 THEN
        PERFORM allocate_payment(v_pid, 'purchase_bill', r.id, v_alloc);
        v_remaining := v_remaining - v_alloc;
      END IF;
    END LOOP;
  END IF;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Shortfall: % of payment could not be allocated to open documents',
      v_remaining;
  END IF;

  -- Journal at full payment amount (house m008/m009 conventions)
  IF p_type = 'received' THEN
    v_party_ledger := find_or_create_account(p_business_id, v_party_name, 'Sundry Debtors');
    v_cash_bank := find_or_create_account(p_business_id,
      CASE WHEN p_method = 'cash' THEN 'Cash' ELSE 'Bank' END, 'Cash & Bank');

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id, 'JE-' || v_pay_no, COALESCE(p_payment_date, CURRENT_DATE),
      'Payment received ' || v_pay_no || ' from ' || v_party_name,
      round(p_amount, 2), round(p_amount, 2),
      'posted', 'payment_received', v_pid, auth.uid())
    RETURNING id INTO v_je;

    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_cash_bank, round(p_amount, 2), 0),
           (p_business_id, v_je, v_party_ledger, 0, round(p_amount, 2));
  ELSE
    v_party_ledger := find_or_create_account(p_business_id, v_party_name, 'Sundry Creditors');
    v_cash_bank := find_or_create_account(p_business_id,
      CASE WHEN p_method = 'cash' THEN 'Cash' ELSE 'Bank' END, 'Cash & Bank');

    INSERT INTO journal_entries (business_id, entry_number, date, narration,
      total_debit, total_credit, status, reference_type, reference_id, created_by)
    VALUES (p_business_id, 'JE-' || v_pay_no, COALESCE(p_payment_date, CURRENT_DATE),
      'Payment made ' || v_pay_no || ' to ' || v_party_name,
      round(p_amount, 2), round(p_amount, 2),
      'posted', 'payment_made', v_pid, auth.uid())
    RETURNING id INTO v_je;

    INSERT INTO journal_entry_lines (business_id, entry_id, account_id, debit_amount, credit_amount)
    VALUES (p_business_id, v_je, v_party_ledger, round(p_amount, 2), 0),
           (p_business_id, v_je, v_cash_bank, 0, round(p_amount, 2));
  END IF;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(),
    CASE WHEN p_type = 'received' THEN 'payment_received_created' ELSE 'payment_made_created' END,
    'payment', v_pid,
    'Payment ' || v_pay_no || ' of ' || round(p_amount, 2)::text || ' fully allocated and posted');

  RETURN QUERY SELECT v_pid, v_je, round(p_amount, 2);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_payment_with_allocation(uuid, text, uuid, numeric, date, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_payment_with_allocation(uuid, text, uuid, numeric, date, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION create_payment_with_allocation(uuid, text, uuid, numeric, date, text, text, text) TO authenticated;

/*
# 030 â€” Draft lifecycle for documents (T47)

1. create_sales_invoice / create_purchase_bill EXTENDED with an appended
   p_status parameter (DEFAULT 'issued' / 'confirmed' -> existing 3-arg
   callers unaffected; 4-arg overload carries the new signature). Accepted
   values: the live default, or 'draft'.
   DRAFTS ARE PAPERWORK, NOT EVENTS (J2): the draft branch skips stock
   movements AND journal posting entirely; status/payment/balance columns
   are stored identically so promotion is purely additive.
   NUMBERING POLICY (deviation from 'placeholder' idea, documented):
   numbers are assigned AT CREATION even for drafts â€” invoice_number/
   bill_number are NOT NULL and registry-backed, and placeholder states
   would need nullable-UNIQUE gymnastics. A hard-deleted draft burns its
   number (registry keeps it) â€” accepted, serial counters tolerate gaps.
2. issue_document(biz, doc_type, doc_id) RETURNS uuid (JE id): promotes
   draft -> issued/confirmed. Applies EXACTLY what the save path applies
   at live time: per-item product RMW stock movements ('sale' -qty /
   'purchase' +qty) then post_*_journal wrapper, flips status. Guards:
   doc must belong to biz, must BE draft (strict RAISE if already live â€”
   explicit idempotency refusal per dispatch), >=1 item required.
3. cancel_draft(biz, doc_type, doc_id): HARD DELETE allowed only from
   draft â€” nothing was ever posted, so no cancellation JEs are needed
   (J2-legal simplicity). Anything else RAISES pointing at the proper
   cancel RPC. Items go via ON DELETE CASCADE.
4. LEGACY-DRAFT POLICY (documented, NON-destructive): m001 defaulted new
   rows to 'draft', so pre-017 client-era rows may exist as drafts. They
   are FIRST-CLASS: promotable via issue_document, deletable via
   cancel_draft. NO cleanup statement runs â€” deleting user financial
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

/*
# 031 â€” Member directory surface (T54)

Fixes Phyllis's honest short-user-id placeholders in Members management:
the FE could only see business_members.user_id (a uuid); display names and
emails live in auth.users, which RLS'd callers cannot read directly.

Design:
1. auth_user_profile(p_uid) RETURNS TABLE(email, full_name) â€” SECURITY
   DEFINER helper that reads auth.users as the owner and exposes ONLY two
   display fields (minimal leak surface; no ids/phones/last_sign_in).
   full_name falls back raw_user_meta_data full_name -> name -> email
   local-part, so it is never null.
2. v_member_directory â€” security_invoker=on VIEW over business_members,
   CROSS JOIN LATERAL auth_user_profile(user_id). Because the view runs
   with the CALLER's rights, business_members RLS applies unchanged: a
   caller sees exactly the businesses they are a member of â€” same rows
   they can already read, now with human names attached.
3. Grants: helper + view to authenticated only.
*/

CREATE OR REPLACE FUNCTION auth_user_profile(p_uid uuid)
RETURNS TABLE (email text, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email::text,
         COALESCE(
           NULLIF(u.raw_user_meta_data->>'full_name', ''),
           NULLIF(u.raw_user_meta_data->>'name', ''),
           split_part(u.email::text, '@', 1)
         ) AS full_name
  FROM auth.users u
  WHERE u.id = p_uid;
$$;

REVOKE EXECUTE ON FUNCTION auth_user_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_user_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION auth_user_profile(uuid) TO authenticated;

CREATE OR REPLACE VIEW v_member_directory WITH (security_invoker = on) AS
SELECT bm.business_id,
       bm.id AS membership_id,
       bm.user_id,
       p.email,
       p.full_name,
       bm.role,
       bm.is_active,
       bm.invited_at,
       bm.joined_at
FROM business_members bm
CROSS JOIN LATERAL auth_user_profile(bm.user_id) p;

GRANT SELECT ON v_member_directory TO authenticated;

/*
# 032 â€” Product delete guard / archive pattern (T39)

Problem (card T39): m001 wires stock_movements.product_id ON DELETE
CASCADE (:408), so deleting a product silently destroys immutable stock
history. Since 023 the append-only trigger on stock_movements already
blocks that cascade â€” but as a cryptic low-level error fired from the
wrong table, and only by accident of ordering.

Chosen option (simpler J2-legal one per dispatch): BLOCK deletes when
movement history exists, RAISE actionable guidance to ARCHIVE instead.
No new archive column needed â€” products.is_active (m001:374) already IS
the archive flag; adding a second flag would split the truth.

Behaviour after this migration:
- Product WITH any stock_movements row -> hard DELETE rejected with an
  explicit message naming the product and the archive action.
- Product with NO movements (typo/duplicate never used) -> deletes
  cleanly (nothing historical exists to lose).
- Doc lines are unaffected either way: invoice/bill/CN/DN/QT/SO/PO item
  FKs are SET NULL and every line carries its own product_name snapshot.
- 023's append-only trigger stays as defence-in-depth on movements.

FE implication for Stanley: product lists should default-filter
is_active=true; the destructive "Delete" button becomes "Archive"
(UPDATE is_active=false) once a product has been transacted; plain
delete remains available only for never-moved products (the RPC-free
table delete will simply succeed there).

RLS note: guard runs INVOKER â€” writers pass can_write_business and
stock_movements SELECT policy is member-scoped, so EXISTS resolves
within the caller's visible rows (a product row itself is already
business-scoped, so no cross-business leak is possible).
*/

CREATE OR REPLACE FUNCTION trg_products_protect_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_move_count bigint;
BEGIN
  SELECT count(*) INTO v_move_count
  FROM stock_movements
  WHERE product_id = OLD.id;

  IF v_move_count > 0 THEN
    RAISE EXCEPTION 'Product % has % stock movement(s) and cannot be deleted - archive it instead (UPDATE products SET is_active = false WHERE id = ''%'')',
      OLD.name, v_move_count, OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_no_delete_history ON products;
CREATE TRIGGER trg_products_no_delete_history
BEFORE DELETE ON products
FOR EACH ROW EXECUTE FUNCTION trg_products_protect_history();

/*
# 033 â€” Stock valuation: FIFO cost layers (T41)

Replaces retail-price valuation with COST-based valuation built on the
immutable movement ledger.

## Cost capture
stock_movements had no cost column (m001). Added unit_cost numeric(14,4):
- BACKFILL: 'purchase' movements linked to a bill (reference_type
  'purchase_bill') inherit that bill-item rate; any remaining NULL-cost
  inbound movement falls back to its product's current purchase_price
  (best effort for client-era rows; documented approximation).
- FORWARD: BEFORE INSERT trigger fills unit_cost at capture time â€”
  purchase movements from the referenced bill item, openings from the
  product's purchase_price. Sales/outbound stay cost-free (they CONSUME
  layers, they don't create them).

## get_stock_valuation(biz) -> per-product rows + totals row
Per product of type='product': walk movements chronologically building a
FIFO layer queue â€” positive-qty movements push (qty, unit_cost) layers,
negative-qty movements consume from the oldest layer first. Remaining
layers x cost = inventory value; also reports weighted-average cost
(value / net quantity) since dispatch named WAC as acceptable company.
Returns (product_id, product_name, quantity, total_value, avg_cost);
final row has product_id NULL and product_name '(All products)'.
Oversold histories (net negative) contribute zero further value and are
reported honestly through quantity.

SECURITY DEFINER + member guard per reporting-fn house pattern (020).
Gotchas applied: dedicated scalar accumulators (#3), no out-param name
collisions (#1/#2), no FILTER-in-narrowed-CTE (#4).
*/

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4);

-- Backfill 1: bill-linked purchase movements take their bill-item rate
UPDATE stock_movements sm
SET unit_cost = pbi.rate
FROM purchase_bills pb
JOIN purchase_bill_items pbi ON pbi.bill_id = pb.id
WHERE sm.type = 'purchase'
  AND sm.reference_type = 'purchase_bill'
  AND sm.reference_id = pb.id
  AND sm.product_id = pbi.product_id
  AND sm.unit_cost IS NULL;

-- Backfill 2: remaining inbound movements fall back to product cost price
UPDATE stock_movements sm
SET unit_cost = p.purchase_price
FROM products p
WHERE sm.product_id = p.id
  AND sm.unit_cost IS NULL
  AND sm.quantity > 0;

CREATE OR REPLACE FUNCTION trg_stock_capture_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF NEW.unit_cost IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'purchase' AND NEW.reference_type = 'purchase_bill' THEN
    SELECT rate INTO v_rate
    FROM purchase_bill_items
    WHERE bill_id = NEW.reference_id AND product_id = NEW.product_id
    LIMIT 1;
    NEW.unit_cost := v_rate;
  END IF;

  IF NEW.unit_cost IS NULL AND NEW.quantity > 0 THEN
    SELECT purchase_price INTO v_rate
    FROM products
    WHERE id = NEW.product_id;
    NEW.unit_cost := v_rate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_capture_cost_tg ON stock_movements;
CREATE TRIGGER trg_stock_capture_cost_tg
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_stock_capture_cost();

-- ============================================================================
-- FIFO valuation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_stock_valuation(p_business_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  quantity numeric,
  total_value numeric,
  avg_cost numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_prod RECORD;
  r_move RECORD;
  v_layers_q numeric[];
  v_layers_c numeric[];
  v_head int;
  v_len int;
  v_n int;
  v_take numeric;
  v_rem numeric;
  v_val numeric;
  v_net numeric;
  g_val numeric := 0;
  g_qty numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  FOR r_prod IN
    SELECT id, name FROM products
    WHERE business_id = p_business_id AND type = 'product'
    ORDER BY name
  LOOP
    v_layers_q := ARRAY[]::numeric[];
    v_layers_c := ARRAY[]::numeric[];
    v_head := 1;
    v_val := 0;
    v_net := 0;

    FOR r_move IN
      SELECT type, quantity, unit_cost
      FROM stock_movements
      WHERE product_id = r_prod.id
      ORDER BY created_at, id
    LOOP
      v_net := v_net + r_move.quantity;

      IF r_move.quantity > 0 THEN
        v_layers_q := array_append(v_layers_q, r_move.quantity);
        v_layers_c := array_append(v_layers_c, COALESCE(r_move.unit_cost, 0));
      ELSIF r_move.quantity < 0 THEN
        v_rem := -r_move.quantity;
        WHILE v_rem > 0 LOOP
          v_len := COALESCE(array_length(v_layers_q, 1), 0);
          EXIT WHEN v_head > v_len;  -- oversold remainder: no value impact
          v_take := least(v_layers_q[v_head], v_rem);
          v_layers_q[v_head] := v_layers_q[v_head] - v_take;
          v_rem := v_rem - v_take;
          IF v_layers_q[v_head] <= 0 THEN
            v_head := v_head + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    v_val := 0;
    v_len := COALESCE(array_length(v_layers_q, 1), 0);
    FOR v_n IN v_head .. v_len LOOP
      v_val := v_val + v_layers_q[v_n] * v_layers_c[v_n];
    END LOOP;
    -- zero-width head entries contribute exactly 0, safe to include

    g_val := g_val + v_val;
    g_qty := g_qty + v_net;

    RETURN QUERY SELECT
      r_prod.id,
      r_prod.name,
      v_net,
      round(v_val, 2),
      CASE WHEN v_net > 0 THEN round(v_val / v_net, 4) ELSE 0 END;
  END LOOP;

  RETURN QUERY SELECT
    NULL::uuid,
    '(All products)'::text,
    g_qty,
    round(g_val, 2),
    CASE WHEN g_qty > 0 THEN round(g_val / g_qty, 4) ELSE 0 END;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_stock_valuation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_stock_valuation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_stock_valuation(uuid) TO authenticated;

/*
# 034 â€” Admin control panel: member lifecycle RPCs + audit hardening (T60)

Reconciles the T60 audit-log contract with the EXISTING audit_logs table
(m001:873, server-write-only since 024 dropped its INSERT policy) instead
of creating a second log: additive columns only, legacy writers (024/027/
028) keep working untouched.

DEVIATION FROM CONTRACT (flagged to god): id stays uuid â€” converting a
live audited table's pk to bigint generated buys nothing and risks
Stanley's already-coded hooks reading string ids.

A. business_members evolution: status ('pending'|'active'|'revoked'),
   nullable user_id (pending rows carry invite_email instead), CHECK
   tying them together, dedupe index on pending invites.
B. Helpers tightened: revoked/pending rows grant NOTHING (status='active'
   added to is_business_member / can_write_business / is_business_admin).
C. audit_logs gains actor / actor_email / meta / ip / device (+ backfill).
D. write_audit() internal definer helper capturing invoker identity.
E. Frozen-signature member RPCs: invite / change-role / revoke /
   transfer-ownership â€” all owner/admin-gated per THAT business,
   last-owner guarded, every mutation audited.
F. GST settings change trigger on businesses (security-sensitive field).
*/

-- ============================================================================
-- A. business_members: pending/revoked lifecycle
-- ============================================================================
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS status text
  NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'revoked'));

ALTER TABLE business_members ADD COLUMN IF NOT EXISTS invite_email text;

ALTER TABLE business_members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE business_members DROP CONSTRAINT IF EXISTS bm_lifecycle_shape;
ALTER TABLE business_members ADD CONSTRAINT bm_lifecycle_shape CHECK (
  (status = 'pending' AND user_id IS NULL AND invite_email IS NOT NULL)
  OR (status <> 'pending' AND user_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bm_pending_email_per_biz
  ON business_members(business_id, lower(invite_email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bm_status ON business_members(business_id, status);

-- ============================================================================
-- B. Membership helpers: only ACTIVE members count
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
      AND status = 'active'
      AND is_active = true
  );
$$;

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
      AND status = 'active'
      AND is_active = true
      AND role IN ('owner', 'admin', 'manager', 'accountant', 'sales_staff', 'purchase_staff', 'inventory_staff')
  );
$$;

CREATE OR REPLACE FUNCTION is_business_admin(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND is_active = true
      AND role IN ('owner', 'admin')
  );
$$;

-- ============================================================================
-- C. audit_logs: extend toward T60 contract + backfill
-- ============================================================================
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_email text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device text;

UPDATE audit_logs SET actor = user_id WHERE actor IS NULL AND user_id IS NOT NULL;

UPDATE audit_logs a
SET actor_email = u.email
FROM auth.users u
WHERE a.actor = u.id AND a.actor_email IS NULL;

-- ============================================================================
-- D. Audit writer (definer-internal)
-- ============================================================================
CREATE OR REPLACE FUNCTION write_audit(
  p_business_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_meta jsonb DEFAULT '{}',
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_email text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  INSERT INTO audit_logs (business_id, user_id, actor, actor_email, action,
    entity_type, entity_id, meta, description)
  VALUES (p_business_id, v_actor, v_actor, COALESCE(v_email, 'unknown'),
    p_action, p_entity_type, p_entity_id, p_meta, p_description);
END;
$$;

REVOKE EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb, text) FROM authenticated;

-- ============================================================================
-- E. Member management RPCs (frozen signatures)
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_invite_member(
  p_business_id uuid,
  p_email text,
  p_role text
)
RETURNS business_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_row business_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can invite members';
  END IF;

  v_clean := lower(trim(p_email));
  IF v_clean !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;
  IF p_role NOT IN ('admin', 'manager', 'accountant', 'sales_staff', 'purchase_staff', 'inventory_staff', 'viewer') THEN
    RAISE EXCEPTION 'Role % cannot be granted via invite', p_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM business_members bm
    JOIN auth.users u ON u.id = bm.user_id
    WHERE bm.business_id = p_business_id
      AND bm.status <> 'revoked'
      AND lower(u.email) = v_clean
  ) OR EXISTS (
    SELECT 1 FROM business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.status = 'pending'
      AND lower(bm.invite_email) = v_clean
  ) THEN
    RAISE EXCEPTION 'That email is already a member or has a pending invitation';
  END IF;

  INSERT INTO business_members (business_id, user_id, role, status, is_active, invited_at, invite_email)
  VALUES (p_business_id, NULL, p_role, 'pending', true, now(), v_clean)
  RETURNING * INTO v_row;

  PERFORM write_audit(p_business_id, 'member_invited', 'business_member',
    v_row.id::text, jsonb_build_object('email', v_clean, 'role', p_role),
    'Invitation created for ' || v_clean || ' as ' || p_role);

  RETURN v_row;
END;
$$;

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
  IF p_new_role NOT IN ('owner','admin','manager','accountant','sales_staff','purchase_staff','inventory_staff','viewer') THEN
    RAISE EXCEPTION 'Unknown role %', p_new_role;
  END IF;

  IF v_target.role = 'owner' AND p_new_role <> 'owner' THEN
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
    IF v_target.user_id = auth.uid() AND v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of a business';
    END IF;
    IF v_target.user_id <> auth.uid() AND v_owner_count <= 1 THEN
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

CREATE OR REPLACE FUNCTION admin_revoke_member(
  p_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target business_members%ROWTYPE;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_target FROM business_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target.status = 'revoked' THEN
    RAISE EXCEPTION 'Member is already revoked';
  END IF;
  IF NOT is_business_admin(v_target.business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can revoke members';
  END IF;
  IF v_target.role = 'owner' THEN
    IF v_target.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Cannot revoke yourself as the only owner - transfer ownership first';
    END IF;
    SELECT count(*) INTO v_owner_count
    FROM business_members
    WHERE business_id = v_target.business_id
      AND role = 'owner' AND status = 'active' AND is_active = true;
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot revoke the last owner of a business';
    END IF;
  END IF;

  UPDATE business_members
  SET status = 'revoked', is_active = false
  WHERE id = p_member_id;

  PERFORM write_audit(v_target.business_id, 'member_revoked', 'business_member',
    p_member_id::text, jsonb_build_object('role', v_target.role, 'was_pending', v_target.status = 'pending'),
    'Membership revoked (soft delete - row preserved for audit integrity)');

  RETURN p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_transfer_ownership(
  p_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target business_members%ROWTYPE;
  v_caller business_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_target FROM business_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'Ownership can only transfer to an active member';
  END IF;

  SELECT * INTO v_caller FROM business_members
  WHERE business_id = v_target.business_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_caller.role <> 'owner' OR v_caller.status <> 'active' OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'Only the current owner can transfer ownership';
  END IF;
  IF v_target.id = v_caller.id THEN
    RAISE EXCEPTION 'You already own this business';
  END IF;

  UPDATE business_members SET role = 'owner'
  WHERE id = v_target.id;

  UPDATE business_members SET role = 'admin'
  WHERE id = v_caller.id;

  PERFORM write_audit(v_target.business_id, 'ownership_transferred', 'business_member',
    v_target.id::text, jsonb_build_object('new_owner_member', v_target.id, 'previous_owner_user', v_caller.user_id),
    'Ownership transferred; previous owner demoted to admin');

  RETURN v_target.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_invite_member(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_invite_member(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_invite_member(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_change_member_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_change_member_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_change_member_role(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_revoke_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_revoke_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_revoke_member(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_transfer_ownership(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_transfer_ownership(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_transfer_ownership(uuid) TO authenticated;

-- ============================================================================
-- F. GST settings change hook (security-sensitive)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_businesses_audit_gst()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.gst_registered IS DISTINCT FROM NEW.gst_registered
     OR OLD.gstin IS DISTINCT FROM NEW.gstin
     OR OLD.pan IS DISTINCT FROM NEW.pan THEN
    PERFORM write_audit(NEW.id, 'gst_settings_changed', 'business', NEW.id::text,
      jsonb_build_object(
        'gst_registered', NEW.gst_registered,
        'gstin_was', OLD.gstin, 'gstin_now', NEW.gstin,
        'pan_was', OLD.pan, 'pan_now', NEW.pan
      ),
      'GST registration details changed');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_gst_audit_tg ON businesses;
CREATE TRIGGER trg_businesses_gst_audit_tg
AFTER UPDATE ON businesses
FOR EACH ROW EXECUTE FUNCTION trg_businesses_audit_gst();

/*
# 035 â€” Fiscal year lock enforcement (T60 item 3)

027 provides close/reopen but NOTHING blocks backdated documents into a
closed year. This migration adds minimal enforcement WITHOUT editing any
existing migration: BEFORE triggers at the date-validation point of the
three core transactional paths (m017's save targets).

Semantics: while an UN-reopened close exists for label L, new/edited
documents dated INSIDE L's bounds are rejected. Open years unaffected.
Bounds derive from businesses.financial_year labels of the form
'FY 2025-26' / 'FY 2025-2026' (Apr 1 - Mar 31, Indian FY). Unparsable
labels are skipped open â€” never false-block real work.

SCOPE HONESTY: journal_entries + sales_invoices + purchase_bills only.
CN/DN/QT/SO/PO date paths and direct client INSERTs to those tables
(where policies allow) are NOT yet gated; noted as gap in T60 report.
*/

CREATE OR REPLACE FUNCTION fy_label_bounds(p_label text)
RETURNS table(fy_start date, fy_end date)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_m1 text;
  v_m2 text;
  y1 int;
  y2 int;
BEGIN
  v_m1 := substring(p_label from '\d{4}-(\d{2,4})');
  v_m2 := substring(p_label from '(\d{4})');
  IF v_m1 IS NULL OR v_m2 IS NULL THEN
    RETURN;
  END IF;
  y1 := v_m2::int;
  IF length(v_m1) = 4 THEN
    y2 := v_m1::int;
  ELSE
    y2 := (y1 / 100 * 100) + v_m1::int;
    IF y2 <= y1 THEN
      y2 := y2 + 100;
    END IF;
  END IF;
  IF y2 <> y1 + 1 THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT make_date(y1, 4, 1), make_date(y2, 3, 31);
END;
$$;

CREATE OR REPLACE FUNCTION enforce_fy_lock_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  r_bounds RECORD;
BEGIN
  -- System-generated close/reopen journals must never self-block (027 dates them CURRENT_DATE)
  IF NEW.reference_type IN ('fiscal_close', 'fiscal_reopen') THEN
    RETURN NEW;
  END IF;

  SELECT financial_year INTO v_label FROM businesses WHERE id = NEW.business_id;
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.date >= r_bounds.fy_start AND NEW.date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = NEW.business_id AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - documents dated % through % cannot be created or edited',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_fy_lock_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  r_bounds RECORD;
BEGIN
  SELECT financial_year INTO v_label FROM businesses WHERE id = NEW.business_id;
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.invoice_date >= r_bounds.fy_start AND NEW.invoice_date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = NEW.business_id AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - invoices dated % through % cannot be created or edited',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_fy_lock_bill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  r_bounds RECORD;
BEGIN
  SELECT financial_year INTO v_label FROM businesses WHERE id = NEW.business_id;
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.bill_date >= r_bounds.fy_start AND NEW.bill_date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = NEW.business_id AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - bills dated % through % cannot be created or edited',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fy_lock_journal ON journal_entries;
CREATE TRIGGER trg_fy_lock_journal
BEFORE INSERT OR UPDATE OF date ON journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_journal();

DROP TRIGGER IF EXISTS trg_fy_lock_invoices ON sales_invoices;
CREATE TRIGGER trg_fy_lock_invoices
BEFORE INSERT OR UPDATE OF invoice_date ON sales_invoices
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_invoice();

DROP TRIGGER IF EXISTS trg_fy_lock_bills ON purchase_bills;
CREATE TRIGGER trg_fy_lock_bills
BEFORE INSERT OR UPDATE OF bill_date ON purchase_bills
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_bill();

/*
# 036 â€” Business stamp & digital signature images (owner direct order)

Two additive nullable text columns on businesses. Values are image URLs
or base64 data-URLs (client caps uploads at ~500KB each for v1; Supabase
Storage can take over later without a column change since the contract
is 'URL or data-URL string').

Rendered by the shared InvoiceSheet signatory block (live preview, print
and PDF capture all use <img src>, which data-URLs satisfy). No RLS
change needed: businesses rows already member-readable / admin-writable.
*/

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stamp_url text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS signature_url text;

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

-- ============================================================================
-- # 039 â€” Stock transfers between warehouses (T65) [oscar]
--
-- Feasibility verdict recorded in hive: clean design EXISTS because m001
-- already anticipated multi-location stock:
--   * stock_movements.warehouse_id + types 'transfer_in'/'transfer_out'
--   * 023 recompute groups by PRODUCT only -> paired +/- legs net to zero
--     on products.current_stock (total conserved across warehouses)
--   * 023 append-only is insert-compatible; 033 cost-capture trigger leaves
--     explicitly-set unit_cost untouched -> FIFO value preservable.
--
-- ## Schema
-- stock_transfers header: business-scoped, from/to warehouse (RESTRICT keeps
-- route provenance; distinctness enforced), one-way status machine
-- completed -> cancelled (cancelled terminal + immutable), numbering unique
-- per business. Lines: one row per product, qty > 0.
-- RLS: SELECT/INSERT for members only; NO update/delete policies (status
-- transitions happen exclusively inside the SECURITY DEFINER cancel RPC).
--
-- ## Numbering
-- document_sequences CHECK widened (dynamic conname lookup, 022 pattern)
-- + next_document_number re-emitted with 'stock_transfer' => 'TRF'.
--
-- ## Semantics
-- NO financial journal entry â€” moving stock between own warehouses is not a
-- financial event. Both movement legs carry the FIFO-consumption cost of the
-- outgoing quantity so inventory VALUE is exactly preserved (get_stock_
-- valuation walk converges regardless of same-timestamp leg tie-break:
-- consume-then-repush == push-then-consume-oldest).
--
-- ## Availability honesty
-- Origin check sums movements attributed to the from-warehouse ONLY. Legacy
-- rows with NULL warehouse (pre-transfer-era data) are unattributable and
-- deliberately EXCLUDED; the RAISE reports what was found at origin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Tables + RLS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  transfer_number text NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_distinct_wh CHECK (from_warehouse_id <> to_warehouse_id),
  CONSTRAINT stock_transfers_number_unique UNIQUE (business_id, transfer_number)
);

CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4),
  CONSTRAINT stock_transfer_lines_unique_product UNIQUE (transfer_id, product_id)
);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_select" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "stock_transfers_insert" ON public.stock_transfers;
CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT TO authenticated WITH CHECK (is_business_member(business_id));

-- Deliberately NO update/delete policies: corrections flow through the
-- cancel RPC (definer) + compensating movements, mirroring 023 philosophy.

DROP POLICY IF EXISTS "stock_transfer_lines_select" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_select" ON public.stock_transfer_lines
  FOR SELECT TO authenticated USING (
    is_business_member((
      SELECT t.business_id FROM public.stock_transfers t WHERE t.id = transfer_id
    ))
  );

DROP POLICY IF EXISTS "stock_transfer_lines_insert" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_insert" ON public.stock_transfer_lines
  FOR INSERT TO authenticated WITH CHECK (
    is_business_member((
      SELECT t.business_id FROM public.stock_transfers t WHERE t.id = transfer_id
    ))
  );

GRANT SELECT, INSERT ON public.stock_transfers TO authenticated;
GRANT SELECT, INSERT ON public.stock_transfer_lines TO authenticated;
REVOKE ALL ON public.stock_transfers FROM anon;
REVOKE ALL ON public.stock_transfer_lines FROM anon;

CREATE INDEX IF NOT EXISTS idx_stock_transfers_business
  ON public.stock_transfers(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer
  ON public.stock_transfer_lines(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse
  ON public.stock_movements(business_id, warehouse_id, product_id)
  WHERE warehouse_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- B. Numbering service extension (CHECK widen + function re-emit, 022 pattern)
-- ----------------------------------------------------------------------------
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

ALTER TABLE public.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_doc_type_check;
ALTER TABLE public.document_sequences ADD CONSTRAINT document_sequences_doc_type_check
  CHECK (doc_type IN (
    'sales_invoice','purchase_bill','payment_received','payment_made',
    'credit_note','debit_note','expense',
    'quotation','sales_order','purchase_order',
    'stock_transfer'
  ));

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
    WHEN 'stock_transfer' THEN 'TRF'
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

-- ----------------------------------------------------------------------------
-- C. FIFO consumption-cost helper (same walk as 033's valuation, read-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fifo_consumption_cost(
  p_product_id uuid,
  p_quantity numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r_move RECORD;
  v_layers_q numeric[];
  v_layers_c numeric[];
  v_head int := 1;
  v_len int;
  v_take numeric;
  v_rem numeric;
  v_cost_total numeric := 0;
  v_remaining numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN 0;
  END IF;

  FOR r_move IN
    SELECT quantity, unit_cost
    FROM stock_movements
    WHERE product_id = p_product_id
    ORDER BY created_at, id
  LOOP
    IF r_move.quantity > 0 THEN
      v_layers_q := array_append(v_layers_q, r_move.quantity);
      v_layers_c := array_append(v_layers_c, COALESCE(r_move.unit_cost, 0));
    ELSIF r_move.quantity < 0 THEN
      v_rem := -r_move.quantity;
      WHILE v_rem > 0 LOOP
        v_len := COALESCE(array_length(v_layers_q, 1), 0);
        EXIT WHEN v_head > v_len;
        v_take := least(v_layers_q[v_head], v_rem);
        v_layers_q[v_head] := v_layers_q[v_head] - v_take;
        v_rem := v_rem - v_take;
        IF v_layers_q[v_head] <= 0 THEN
          v_head := v_head + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  v_remaining := p_quantity;
  v_len := COALESCE(array_length(v_layers_q, 1), 0);
  WHILE v_remaining > 0 AND v_head <= v_len LOOP
    v_take := least(v_layers_q[v_head], v_remaining);
    v_cost_total := v_cost_total + v_take * v_layers_c[v_head];
    v_remaining := v_remaining - v_take;
    v_head := v_head + 1;
  END LOOP;
  -- oversold remainder consumes at zero, matching 033's honest convention

  RETURN round((v_cost_total / p_quantity)::numeric, 4);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_fifo_consumption_cost(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fifo_consumption_cost(uuid, numeric) TO authenticated;

-- ----------------------------------------------------------------------------
-- D. execute_stock_transfer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_stock_transfer(
  p_business_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_transfer_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (transfer_id uuid, transfer_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_bad text;
  v_qty numeric;
  v_avail numeric;
  v_rec RECORD;
  v_cost numeric;
  v_id uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Warehouses: same business, physically distinct
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'Source and destination warehouses must differ';
  END IF;
  SELECT count(*) INTO v_count FROM warehouses w
   WHERE w.business_id = p_business_id
     AND w.id IN (p_from_warehouse_id, p_to_warehouse_id);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Both warehouses must belong to this business';
  END IF;

  -- Items sanity
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;
  FOR v_rec IN
    SELECT elem->>'product_id' AS pid, elem->>'quantity' AS q
    FROM jsonb_array_elements(p_items) elem
  LOOP
    BEGIN
      v_qty := v_rec.q::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid quantity % for product %', v_rec.q, v_rec.pid;
    END;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantities must be positive (got %)', v_rec.q;
    END IF;
    BEGIN
      v_count := NULL;
      EXECUTE 'SELECT count(*) FROM products p WHERE p.id = $1 AND p.business_id = $2 AND p.type = ''product'''
        INTO v_count USING v_rec.pid::uuid, p_business_id;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid product id %', v_rec.pid;
    END;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'Product % is not a product of this business', v_rec.pid;
    END IF;
  END LOOP;

  -- Serialize same-product stock decisions (deterministic lock order)
  PERFORM 1 FROM products p
   WHERE p.id IN (SELECT (elem->>'product_id')::uuid FROM jsonb_array_elements(p_items) elem)
   ORDER BY p.id
   FOR UPDATE;

  -- Duplicate product lines would double-spend availability
  SELECT count(*) INTO v_count
  FROM (SELECT DISTINCT elem->>'product_id' AS pid FROM jsonb_array_elements(p_items) elem) d;
  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Duplicate product lines are not allowed';
  END IF;

  -- Per-origin-warehouse availability (legacy NULL-wh rows excluded, see header)
  FOR v_rec IN
    SELECT (elem->>'product_id')::uuid AS pid, (elem->>'quantity')::numeric AS qty
    FROM jsonb_array_elements(p_items) elem
  LOOP
    SELECT COALESCE(SUM(sm.quantity), 0) INTO v_avail
    FROM stock_movements sm
    WHERE sm.product_id = v_rec.pid
      AND sm.business_id = p_business_id
      AND sm.warehouse_id = p_from_warehouse_id;
    IF v_avail < v_rec.qty THEN
      RAISE EXCEPTION 'Insufficient stock at source warehouse for product %: requested %, available %',
        v_rec.pid, v_rec.qty, v_avail;
    END IF;
  END LOOP;

  -- Header (number claimed inside 016 service)
  v_number := next_document_number(p_business_id, 'stock_transfer', p_transfer_date);

  INSERT INTO stock_transfers (business_id, transfer_number, from_warehouse_id, to_warehouse_id, notes, created_by)
  VALUES (p_business_id, v_number, p_from_warehouse_id, p_to_warehouse_id, p_notes, auth.uid())
  RETURNING id INTO v_id;

  -- Lines capture the FIFO cost actually consumed, for audit
  INSERT INTO stock_transfer_lines (transfer_id, product_id, quantity, unit_cost)
  SELECT v_id,
         (elem->>'product_id')::uuid,
         (elem->>'quantity')::numeric,
         get_fifo_consumption_cost((elem->>'product_id')::uuid, (elem->>'quantity')::numeric)
  FROM jsonb_array_elements(p_items) elem;

  -- BOTH legs in ONE statement: 023's statement-level recompute runs once
  -- afterwards and wins with the conserved total. Explicit unit_cost bypasses
  -- 033's fallback capture (trigger returns NEW unchanged when cost set).
  INSERT INTO stock_movements
    (business_id, product_id, warehouse_id, type, quantity, unit_cost,
     reference_type, reference_id, notes, created_by)
  SELECT t.business_id,
         l.product_id,
         CASE s.leg WHEN 0 THEN t.from_warehouse_id ELSE t.to_warehouse_id END,
         CASE s.leg WHEN 0 THEN 'transfer_out' ELSE 'transfer_in' END,
         CASE s.leg WHEN 0 THEN -l.quantity ELSE l.quantity END,
         l.unit_cost,
         'stock_transfer',
         t.id,
         t.notes,
         auth.uid()
  FROM stock_transfers t
  JOIN stock_transfer_lines l ON l.transfer_id = t.id
  CROSS JOIN (VALUES (0),(1)) AS s(leg)
  WHERE t.id = v_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 * (SELECT count(*) FROM stock_transfer_lines l WHERE l.transfer_id = v_id) THEN
    RAISE EXCEPTION 'Transfer leg insertion incomplete; transaction aborted';
  END IF;

  RETURN QUERY SELECT v_id, v_number;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_stock_transfer(uuid, uuid, uuid, jsonb, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_stock_transfer(uuid, uuid, uuid, jsonb, text, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- E. cancel_stock_transfer â€” flip status FIRST, then mirror actual posted legs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(
  p_transfer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_t RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO r_t FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer % not found', p_transfer_id;
  END IF;
  IF NOT can_write_business(r_t.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF r_t.status = 'cancelled' THEN
    RETURN;  -- idempotent
  END IF;

  UPDATE stock_transfers SET status = 'cancelled' WHERE id = r_t.id;

  -- Reversal built by READING actually-posted legs (house pattern): flip
  -- type and sign; the warehouse attribution stays on each original leg.
  INSERT INTO stock_movements
    (business_id, product_id, warehouse_id, type, quantity, unit_cost,
     reference_type, reference_id, notes, created_by)
  SELECT m.business_id,
         m.product_id,
         m.warehouse_id,
         CASE m.type WHEN 'transfer_out' THEN 'transfer_in' ELSE 'transfer_out' END,
         -m.quantity,
         m.unit_cost,
         'stock_transfer',
         r_t.id,
         'Reversal of ' || r_t.transfer_number,
         auth.uid()
  FROM stock_movements m
  WHERE m.reference_type = 'stock_transfer'
    AND m.reference_id = r_t.id;
END;
$$;

/*
# 037 â€” Canonical account balance maintenance (QA P1 #5 fix)

Problem: accounts.current_balance was maintained INCREMENTALLY by some
writers (engine wrappers) but never by direct-INSERT paths (payments 029,
CN/DN 022, settlement 028, FY close 027) â€” drift accumulates and the
dashboard liquid-cash KPI reads the stale column.

Fix (same pattern as stock's canonical recompute, 023): an AFTER row
trigger on journal_entry_lines recomputes the affected account's
balance from first principles after every line mutation:

  current_balance = round(opening_balance
    + nature_sign * SUM(posted dr - cr), 2)

This is EXACTLY the brought-forward identity get_trial_balance/m019's
ledger already uses, so ledger/TB/CoA/dashboard finally agree by
construction. Existing incremental UPDATEs become harmless (this trigger
runs after them and wins). One-time backfill heals accumulated drift.

Draft lines are excluded (status='posted' filter). Index added for the
per-account aggregation.
*/

CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id);

CREATE OR REPLACE FUNCTION trg_recalc_account_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acct uuid;
BEGIN
  v_acct := COALESCE(NEW.account_id, OLD.account_id);
  IF v_acct IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE accounts a
  SET current_balance = round(
    COALESCE(a.opening_balance, 0) +
    CASE WHEN account_nature(a.group_name) = 'debit' THEN 1 ELSE -1 END *
    COALESCE((
      SELECT SUM(l.debit_amount - l.credit_amount)
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = a.id AND e.status = 'posted'
    ), 0),
    2)
  WHERE a.id = v_acct;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_account_balance_tg ON journal_entry_lines;
CREATE TRIGGER trg_recalc_account_balance_tg
AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION trg_recalc_account_balance();

-- One-time heal of accumulated drift across ALL accounts
UPDATE accounts a
SET current_balance = round(
  COALESCE(a.opening_balance, 0) +
  CASE WHEN account_nature(a.group_name) = 'debit' THEN 1 ELSE -1 END *
  COALESCE((
    SELECT SUM(l.debit_amount - l.credit_amount)
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = a.id AND e.status = 'posted'
  ), 0),
  2);

-- ============================================================================
-- # 040 â€” Warehouse support for honest CRUD + per-warehouse stock (T66) [oscar]
--
-- m001 already ships full RLS CRUD policies on warehouses, so a UI needs no
-- new access layer. What IS genuinely missing:
--   1. Delete guard: stock_movements.warehouse_id is ON DELETE SET NULL, so
--      deleting a warehouse today SILENTLY erases attribution of all its
--      movement history (and breaks transfer provenance). BEFORE DELETE
--      trigger now blocks when referenced, with an actionable message.
--   2. One default per business: is_default had no uniqueness guarantee;
--      existing duplicate defaults are normalized deterministically
--      (earliest created_at, tie-break id) before a partial unique index.
--   3. v_warehouse_stock: security_invoker net quantity per (warehouse,
--      product) from attributed movements only â€” the read surface for any
--      warehouse UI. NULL-attribution legacy rows are excluded by design;
--      they remain visible in total product stock.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Referential delete guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forbid_warehouse_delete_with_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_moves bigint;
  v_transfers bigint;
BEGIN
  SELECT count(*) INTO v_moves FROM stock_movements sm WHERE sm.warehouse_id = OLD.id;
  IF v_moves > 0 THEN
    RAISE EXCEPTION 'Warehouse % has % stock movement(s) on record and cannot be deleted; history must stay attributable', OLD.name, v_moves;
  END IF;

  SELECT count(*) INTO v_transfers FROM stock_transfers t
   WHERE t.from_warehouse_id = OLD.id OR t.to_warehouse_id = OLD.id;
  IF v_transfers > 0 THEN
    RAISE EXCEPTION 'Warehouse % appears in % stock transfer(s) and cannot be deleted; route history must stay intact', OLD.name, v_transfers;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouses_delete_guard ON warehouses;
CREATE TRIGGER trg_warehouses_delete_guard
BEFORE DELETE ON warehouses
FOR EACH ROW EXECUTE FUNCTION forbid_warehouse_delete_with_history();

-- ----------------------------------------------------------------------------
-- B. Normalize duplicate defaults, then enforce one default per business
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE warehouses w
     SET is_default = false
   WHERE is_default
     AND id <> (
       SELECT id FROM warehouses w2
        WHERE w2.business_id = w.business_id
          AND w2.is_default
        ORDER BY w2.created_at, w2.id
        LIMIT 1
     );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_one_default_per_business
  ON warehouses(business_id)
  WHERE is_default;

-- ----------------------------------------------------------------------------
-- C. Per-warehouse stock view (security_invoker: caller's membership gates it)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_warehouse_stock;
CREATE VIEW public.v_warehouse_stock
WITH (security_invoker = on)
AS
SELECT
  sm.business_id,
  sm.warehouse_id,
  w.name  AS warehouse_name,
  sm.product_id,
  p.name  AS product_name,
  SUM(sm.quantity)              AS quantity,
  MAX(sm.created_at)            AS last_movement_at
FROM stock_movements sm
JOIN warehouses w ON w.id = sm.warehouse_id
JOIN products p   ON p.id = sm.product_id
GROUP BY sm.business_id, sm.warehouse_id, w.name, sm.product_id, p.name;

-- ============================================================================
-- # 041 â€” GSTR doc-level reporting surface (T73, feeds Phyllis T69) [oscar]
--
-- Document-truth GSTR-1/3B data built ONLY from existing columns of the
-- live tables (no schema redesign, no new writes).
--
-- ## Granularity
-- One row per (document, tax_rate) â€” canonical GSTR-1 line granularity.
-- A single-rate document yields exactly one row; multi-rate documents
-- produce one row per rate so rate-wise filing tables render directly.
--
-- ## Status families (mirror the transactional save RPCs / J2 machine)
-- OUTWARD: sales_invoices.status IN ('issued','partially_paid','paid')
--          â€” NEVER draft / cancelled / void.
-- INWARD:  purchase_bills.status IN ('confirmed','partially_paid','paid').
--
-- ## Semantics mirrors
-- * B2B/B2C classification identical to reportsAdapter.fetchGstr1:
--   party GSTIN present => B2B else B2C.
-- * Amounts are raw column sums (NO rounding here â€” the report layer owns
--   presentation rounding, mirroring how fetchGstr1 applies r2 client-side).
-- * place_of_supply exists on invoices only; bills carry none in schema,
--   so the inward view omits the column rather than faking it.
--
-- ## Intended net-liability derivation (report layer renders it)
--   output_tax  = Î£ outward.cgst+sgst+igst+cess      (3B table 3.1 shape)
--   input_credit= Î£ inward.cgst+sgst+igst+cess       (3B table 4A shape)
--   net_payable = output_tax âˆ’ input_credit; when negative it is a CREDIT
--   CARRY-FORWARD, not a refund claim. This is DOCUMENT truth â€” it may
--   differ from get_gst_summary() JOURNAL truth around CN/DN/settlement
--   timing; the FE must label which basis it shows.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_invoice_items_invoice
  ON public.sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_bill_items_bill
  ON public.purchase_bill_items(bill_id);

-- ----------------------------------------------------------------------------
-- A. v_gstr1_outward â€” per (invoice, rate) outward supply lines
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_outward;
CREATE VIEW public.v_gstr1_outward
WITH (security_invoker = on)
AS
SELECT
  si.business_id,
  si.id                          AS invoice_id,
  si.invoice_number              AS doc_number,
  si.invoice_date                AS doc_date,
  c.name                         AS party_name,
  NULLIF(btrim(c.gstin), '')     AS party_gstin,
  CASE WHEN NULLIF(btrim(c.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  si.place_of_supply,
  sii.tax_rate,
  COUNT(sii.id)                  AS item_count,
  SUM(sii.taxable_amount)        AS taxable_value,
  SUM(sii.cgst_amount)           AS cgst,
  SUM(sii.sgst_amount)           AS sgst,
  SUM(sii.igst_amount)           AS igst,
  SUM(sii.cess_amount)           AS cess,
  SUM(sii.cgst_amount + sii.sgst_amount + sii.igst_amount + sii.cess_amount) AS total_tax
FROM sales_invoices si
JOIN customers c            ON c.id = si.customer_id
JOIN sales_invoice_items sii ON sii.invoice_id = si.id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
GROUP BY si.business_id, si.id, si.invoice_number, si.invoice_date,
         c.name, c.gstin, si.place_of_supply, sii.tax_rate;

-- ----------------------------------------------------------------------------
-- B. v_gstr_inward â€” per (bill, rate) inward supply lines (ITC basis)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr_inward;
CREATE VIEW public.v_gstr_inward
WITH (security_invoker = on)
AS
SELECT
  pb.business_id,
  pb.id                          AS bill_id,
  pb.bill_number                 AS doc_number,
  pb.bill_date                   AS doc_date,
  sup.name                       AS party_name,
  NULLIF(btrim(sup.gstin), '')   AS party_gstin,
  CASE WHEN NULLIF(btrim(sup.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  pbi.tax_rate,
  COUNT(pbi.id)                  AS item_count,
  SUM(pbi.taxable_amount)        AS taxable_value,
  SUM(pbi.cgst_amount)           AS cgst,
  SUM(pbi.sgst_amount)           AS sgst,
  SUM(pbi.igst_amount)           AS igst,
  SUM(pbi.cess_amount)           AS cess,
  SUM(pbi.cgst_amount + pbi.sgst_amount + pbi.igst_amount + pbi.cess_amount) AS total_tax
FROM purchase_bills pb
JOIN suppliers sup          ON sup.id = pb.supplier_id
JOIN purchase_bill_items pbi ON pbi.bill_id = pb.id
WHERE pb.status IN ('confirmed', 'partially_paid', 'paid')
GROUP BY pb.business_id, pb.id, pb.bill_number, pb.bill_date,
         sup.name, sup.gstin, pbi.tax_rate;

-- ----------------------------------------------------------------------------
-- C. get_gstr_doc_summary â€” two-sided totals for the 3B-style net figure
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_gstr_doc_summary(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  side text,
  doc_count bigint,
  taxable_value numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  cess numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'outward'::text,
         COUNT(DISTINCT o.invoice_id),
         COALESCE(SUM(o.taxable_value), 0),
         COALESCE(SUM(o.cgst), 0),
         COALESCE(SUM(o.sgst), 0),
         COALESCE(SUM(o.igst), 0),
         COALESCE(SUM(o.cess), 0)
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to

  UNION ALL

  SELECT 'inward'::text,
         COUNT(DISTINCT i.bill_id),
         COALESCE(SUM(i.taxable_value), 0),
         COALESCE(SUM(i.cgst), 0),
         COALESCE(SUM(i.sgst), 0),
         COALESCE(SUM(i.igst), 0),
         COALESCE(SUM(i.cess), 0)
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr_doc_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr_doc_summary(uuid, date, date) TO authenticated;

-- ============================================================================
-- # 042 â€” Bulk CSV-import RPCs: customers / suppliers / products (T75) [oscar]
--
-- ## SEMANTICS (chosen deliberately, one of two honest options)
-- VALID-ROWS-INSERTED-WITH-PER-ROW-ERROR-LIST. All three RPCs run in ONE
-- transaction; every row that passes validation is inserted, every rejected
-- row is SKIPPED and returned in errors[{row,field,message}] using the row's
-- ORIGINAL 0-based index in p_rows. There are no silent partials either way:
-- the caller always receives the exact fate of every row. (All-or-nothing
-- was rejected because a 500-row sheet with 1 bad row would force a full
-- re-upload cycle for one fix.)
--
-- ## DUPLICATE RULES
-- parties (customers/suppliers): within-business duplicate =
--    case/space-insensitive NAME match, else same non-blank GSTIN.
-- products: within-business duplicate =
--    case/space-insensitive NAME match, else same non-blank SKU.
-- Duplicates inside the payload are flagged ('duplicate in file'); races
-- against concurrent writers fall through to the m001 UNIQUE(business_id,
-- name) constraint and are caught as per-row unique_violation errors
-- WITHOUT aborting the rest of the batch.
--
-- ## FIELD RULES (server-side mirrors of client validators where they exist)
-- name required (non-blank). email: must contain '@' when present.
-- gstin: ^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$ when present. pan:
-- ^[A-Z]{5}[0-9]{4}[A-Z]$ when present. opening_balance: numeric >= 0,
-- ALLOWED for parties (m001 column exists; current_balance seeded equal).
-- products: type in ('product','service') default 'product'; prices/
-- tax_rate numeric >= 0. OPENING/CURRENT STOCK DELIBERATELY NOT IMPORTED â€”
-- stock changes must flow through stock_movements (023 append-only ledger +
-- FIFO valuation integrity); an importer writing product rows directly
-- would create unvalued catalog ghosts. Documented v1 boundary.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_import_customers(
  p_business_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rec RECORD;
  v_idx int := -1;
  v_name text;
  v_email text;
  v_gstin text;
  v_pan text;
  v_ob numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must be a non-empty JSON array';
  END IF;

  FOR v_rec IN
    SELECT elem.*, ordinality - 1 AS rownum
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS elem
  LOOP
    v_idx := v_rec.rownum;
    BEGIN
      v_name  := NULLIF(btrim(COALESCE(v_rec.value->>'name', '')), '');
      v_email := NULLIF(btrim(COALESCE(v_rec.value->>'email', '')), '');
      v_gstin := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'gstin', ''))), '');
      v_pan   := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'pan', ''))), '');

      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Name is required');
        CONTINUE;
      END IF;

      IF v_email IS NOT NULL AND v_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'Invalid email format');
        CONTINUE;
      END IF;

      IF v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'gstin', 'message', 'Invalid GSTIN format');
        CONTINUE;
      END IF;

      IF v_pan IS NOT NULL AND v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'pan', 'message', 'Invalid PAN format');
        CONTINUE;
      END IF;

      BEGIN
        v_ob := NULLIF(btrim(COALESCE(v_rec.value->>'opening_balance', '')), '')::numeric;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Not a valid number');
        CONTINUE;
      END;
      IF v_ob IS NOT NULL AND v_ob < 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Must be zero or positive');
        CONTINUE;
      END IF;

      -- Duplicate rule: name (case/space-insensitive) or GSTIN
      IF EXISTS (
        SELECT 1 FROM customers c
        WHERE c.business_id = p_business_id
          AND (lower(btrim(c.name)) = lower(v_name)
               OR (v_gstin IS NOT NULL AND c.gstin = v_gstin))
      ) THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate: a customer with this name or GSTIN already exists');
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO customers
          (business_id, name, company_name, phone, email, gstin, pan,
           address, city, state, opening_balance, current_balance)
        VALUES
          (p_business_id, v_name,
           NULLIF(btrim(COALESCE(v_rec.value->>'company_name','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'phone','')), ''),
           v_email, v_gstin, v_pan,
           NULLIF(btrim(COALESCE(v_rec.value->>'address','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'city','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'state','')), ''),
           COALESCE(v_ob, 0), COALESCE(v_ob, 0));
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate customer name (concurrent insert)');
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', NULL, 'message', 'Unexpected error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_import_suppliers(
  p_business_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rec RECORD;
  v_idx int := -1;
  v_name text;
  v_email text;
  v_gstin text;
  v_pan text;
  v_ob numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must be a non-empty JSON array';
  END IF;

  FOR v_rec IN
    SELECT elem.*, ordinality - 1 AS rownum
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS elem
  LOOP
    v_idx := v_rec.rownum;
    BEGIN
      v_name  := NULLIF(btrim(COALESCE(v_rec.value->>'name', '')), '');
      v_email := NULLIF(btrim(COALESCE(v_rec.value->>'email', '')), '');
      v_gstin := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'gstin', ''))), '');
      v_pan   := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'pan', ''))), '');

      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Name is required');
        CONTINUE;
      END IF;

      IF v_email IS NOT NULL AND v_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'Invalid email format');
        CONTINUE;
      END IF;

      IF v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'gstin', 'message', 'Invalid GSTIN format');
        CONTINUE;
      END IF;

      IF v_pan IS NOT NULL AND v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'pan', 'message', 'Invalid PAN format');
        CONTINUE;
      END IF;

      BEGIN
        v_ob := NULLIF(btrim(COALESCE(v_rec.value->>'opening_balance', '')), '')::numeric;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Not a valid number');
        CONTINUE;
      END;
      IF v_ob IS NOT NULL AND v_ob < 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Must be zero or positive');
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM suppliers s
        WHERE s.business_id = p_business_id
          AND (lower(btrim(s.name)) = lower(v_name)
               OR (v_gstin IS NOT NULL AND s.gstin = v_gstin))
      ) THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate: a supplier with this name or GSTIN already exists');
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO suppliers
          (business_id, name, company_name, phone, email, gstin, pan,
           address, city, state, opening_balance, current_balance)
        VALUES
          (p_business_id, v_name,
           NULLIF(btrim(COALESCE(v_rec.value->>'company_name','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'phone','')), ''),
           v_email, v_gstin, v_pan,
           NULLIF(btrim(COALESCE(v_rec.value->>'address','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'city','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'state','')), ''),
           COALESCE(v_ob, 0), COALESCE(v_ob, 0));
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate supplier name (concurrent insert)');
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', NULL, 'message', 'Unexpected error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_import_products(
  p_business_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rec RECORD;
  v_idx int := -1;
  v_name text;
  v_sku text;
  v_type text;
  v_pp numeric;
  v_sp numeric;
  v_tax numeric;
  v_min numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must be a non-empty JSON array';
  END IF;

  FOR v_rec IN
    SELECT elem.*, ordinality - 1 AS rownum
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS elem
  LOOP
    v_idx := v_rec.rownum;
    BEGIN
      v_name := NULLIF(btrim(COALESCE(v_rec.value->>'name', '')), '');
      v_sku  := NULLIF(btrim(COALESCE(v_rec.value->>'sku', '')), '');
      v_type := LOWER(btrim(COALESCE(v_rec.value->>'type', 'product')));

      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Name is required');
        CONTINUE;
      END IF;

      IF v_type NOT IN ('product', 'service') THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'type', 'message', 'Must be product or service');
        CONTINUE;
      END IF;

      BEGIN
        v_pp  := NULLIF(btrim(COALESCE(v_rec.value->>'purchase_price', '')), '')::numeric;
        v_sp  := NULLIF(btrim(COALESCE(v_rec.value->>'selling_price', '')), '')::numeric;
        v_tax := NULLIF(btrim(COALESCE(v_rec.value->>'tax_rate', '')), '')::numeric;
        v_min := NULLIF(btrim(COALESCE(v_rec.value->>'minimum_stock', '')), '')::numeric;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'prices', 'message', 'Price/tax/minimum_stock must be numeric');
        CONTINUE;
      END;
      IF COALESCE(v_pp, 0) < 0 OR COALESCE(v_sp, 0) < 0 OR COALESCE(v_tax, 0) < 0 OR COALESCE(v_min, 0) < 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'prices', 'message', 'Prices, tax rate and minimum stock must be zero or positive');
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM products pr
        WHERE pr.business_id = p_business_id
          AND (lower(btrim(pr.name)) = lower(v_name)
               OR (v_sku IS NOT NULL AND pr.sku = v_sku))
      ) THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate: a product with this name or SKU already exists');
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO products
          (business_id, name, sku, type, hsn_sac, unit,
           purchase_price, selling_price, tax_rate, minimum_stock, description)
        VALUES
          (p_business_id, v_name, v_sku, v_type,
           NULLIF(btrim(COALESCE(v_rec.value->>'hsn_sac','')), ''),
           COALESCE(NULLIF(btrim(COALESCE(v_rec.value->>'unit','')), ''), 'PCS'),
           COALESCE(v_pp, 0), COALESCE(v_sp, 0), COALESCE(v_tax, 0), COALESCE(v_min, 0),
           NULLIF(btrim(COALESCE(v_rec.value->>'description','')), ''));
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate product name/SKU (concurrent insert)');
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', NULL, 'message', 'Unexpected error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_import_customers(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_import_suppliers(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_import_products(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_customers(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_suppliers(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_products(uuid, jsonb) TO authenticated;

/*
# 038 â€” FY-lock extension to remaining transactional paths (T64 rider)

035 gated journal_entries / sales_invoices / purchase_bills. This closes
the remaining dated-document paths so a closed fiscal year cannot gain
new or edited documents anywhere:

  payments(date)            - received AND made share one table
  expenses(date)
  credit_notes(date) / debit_notes(date)
  quotations(quote_date)
  sales_orders(order_date) / purchase_orders(order_date)

Stock adjustments need no new gate: their accounting truth is a journal
entry, already gated by 035.

Implementation: ONE generic BEFORE trigger function reading the date
column name from TG_ARGV[0] and the value via to_jsonb(NEW) - same
closed-year semantics as 035 (un-reopened close for that label, Apr-Mar
bounds, unparsable labels stay open). Expiry/expected/due dates are NOT
gated: they are planning metadata, not books of account.
*/

CREATE OR REPLACE FUNCTION enforce_fy_lock_generic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_label text;
  r_bounds RECORD;
  v_date text;
BEGIN
  v_date := to_jsonb(NEW) ->> v_col;
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT financial_year INTO v_label FROM businesses WHERE id = to_jsonb(NEW) ->> 'business_id';
  IF v_label IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.fy_start, b.fy_end INTO r_bounds FROM fy_label_bounds(v_label) b;
  IF r_bounds.fy_start IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_date::date >= r_bounds.fy_start AND v_date::date <= r_bounds.fy_end THEN
    IF EXISTS (
      SELECT 1 FROM fiscal_year_closes
      WHERE business_id = (to_jsonb(NEW) ->> 'business_id')::uuid
        AND fy_label = v_label
        AND reopened_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Fiscal year % is closed - documents dated % through % cannot be created or edited here',
        v_label, r_bounds.fy_start, r_bounds.fy_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fy_lock_payments ON payments;
CREATE TRIGGER trg_fy_lock_payments
BEFORE INSERT OR UPDATE OF date ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_expenses ON expenses;
CREATE TRIGGER trg_fy_lock_expenses
BEFORE INSERT OR UPDATE OF date ON expenses
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_credit_notes ON credit_notes;
CREATE TRIGGER trg_fy_lock_credit_notes
BEFORE INSERT OR UPDATE OF date ON credit_notes
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_debit_notes ON debit_notes;
CREATE TRIGGER trg_fy_lock_debit_notes
BEFORE INSERT OR UPDATE OF date ON debit_notes
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('date');

DROP TRIGGER IF EXISTS trg_fy_lock_quotations ON quotations;
CREATE TRIGGER trg_fy_lock_quotations
BEFORE INSERT OR UPDATE OF quote_date ON quotations
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('quote_date');

DROP TRIGGER IF EXISTS trg_fy_lock_sales_orders ON sales_orders;
CREATE TRIGGER trg_fy_lock_sales_orders
BEFORE INSERT OR UPDATE OF order_date ON sales_orders
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('order_date');

DROP TRIGGER IF EXISTS trg_fy_lock_purchase_orders ON purchase_orders;
CREATE TRIGGER trg_fy_lock_purchase_orders
BEFORE INSERT OR UPDATE OF order_date ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION enforce_fy_lock_generic('order_date');

-- ============================================================================
-- # 043 â€” Classified cash-flow: Operating / Investing / Financing (T78) [oscar]
--
-- MECHANISM CHOSEN: deterministic CASE over accounts.group_name â€” NOT a
-- mapping table. Reasons recorded for the hive:
--   * business-agnostic from day one: every business (and every FUTURE
--     business) is covered without seed/backfill machinery;
--   * zero drift: no join table to fall out of sync when groups are renamed;
--   * truthful fallback: any CUSTOM group an user invents defaults to
--     'operating', which is the honest prior for small-business P&L-natured
--     accounts; reclassification UI can come later as a rider if ever needed.
--
-- ## Classification rules
--   Fixed Assets                          -> investing   (asset purchases/disposals)
--   Long-term Liabilities, Capital Account -> financing   (loans, capital in/out)
--   everything else (incl. unknown groups) -> operating   [documented fallback]
--
-- ## Reconciliation guarantee with the existing surface
-- Predicate mirrors v_cashflow_daily EXACTLY (posted entries only, ledger
-- names IN ('Cash','Bank') post-013b), so SUM over classes == the existing
-- unclassified daily figures for the same range. Known shared limitation,
-- unchanged here: non-canonical cash-named ledgers outside the canonical
--   pair are invisible to BOTH views equally.
--
-- Net convention: net = debit - credit per line (positive = money in);
-- investing/financing nets will often be negative - that is real data.
-- Existing v_cashflow_daily left UNTOUCHED (additive-only migration).
-- ============================================================================

DROP VIEW IF EXISTS public.v_cashflow_classified;
CREATE VIEW public.v_cashflow_classified
WITH (security_invoker = on)
AS
SELECT
  l.business_id,
  e.date                AS flow_date,
  l.entry_id,
  a.id                  AS account_id,
  a.name                AS account_name,
  CASE
    WHEN a.group_name = 'Fixed Assets' THEN 'investing'::text
    WHEN a.group_name IN ('Long-term Liabilities', 'Capital Account') THEN 'financing'::text
    ELSE 'operating'::text
  END                   AS classification,
  COALESCE(l.debit_amount, 0)   AS inflow,
  COALESCE(l.credit_amount, 0)  AS outflow,
  (COALESCE(l.debit_amount, 0) - COALESCE(l.credit_amount, 0))::numeric AS net
FROM journal_entry_lines l
JOIN journal_entries e ON e.id = l.entry_id
JOIN accounts a        ON a.id = l.account_id
WHERE e.status = 'posted'
  AND a.name IN ('Cash', 'Bank');

-- ----------------------------------------------------------------------------
-- Summary over a date range â€” reads ONLY the security_invoker view, so the
-- invoker's membership RLS applies end-to-end (same pattern as 041).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cashflow_classified(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  classification text,
  inflow numeric,
  outflow numeric,
  net numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.classification,
         COALESCE(SUM(f.inflow), 0),
         COALESCE(SUM(f.outflow), 0),
         COALESCE(SUM(f.net), 0)
  FROM (VALUES ('operating'::text), ('investing'::text), ('financing'::text)) AS c(classification)
  LEFT JOIN v_cashflow_classified f
    ON f.classification = c.classification
   AND f.business_id = p_business_id
   AND f.flow_date BETWEEN p_from AND p_to
  GROUP BY c.classification;
$$;

REVOKE EXECUTE ON FUNCTION public.get_cashflow_classified(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashflow_classified(uuid, date, date) TO authenticated;

-- ============================================================================
-- 045 â€” AI assistant business snapshot (additive, read-only)
--
-- Bundles ONE compact JSON payload per business for the ai-assistant edge
-- function. Reuses ONLY existing canonical surfaces (019/020/021/025/033
-- lineage); computes nothing new beyond grouping/truncation:
--
--   kpis              -> v_dashboard_kpis (one row per business)
--   receivables_top   -> v_receivables_aging_base, top 10 by outstanding>0
--   payables_top      -> v_payables_aging_base, top 10 by outstanding>0
--   low_stock         -> products (current_stock <= minimum_stock), top 10
--   sales_monthly     -> sales_invoices live docs, last 6 month buckets
--   purchases_monthly -> purchase_bills live docs, last 6 month buckets
--   cash_position     -> accounts.group_name='Cash & Bank' (current_balance
--                        is CANONICAL since 037 trigger recompute)
--
-- Prompt-injection blunting: free-text columns are hard-truncated here at
-- the DB boundary and notes/terms/descriptions are NEVER included. The edge
-- function additionally frames this block as untrusted data.
--
-- Access: SECURITY DEFINER but gated on is_business_member() exactly like
-- get_gst_summary (025) / get_stock_valuation (033). No PII beyond party
-- names; no credentials; strictly read-only.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ai_business_snapshot(
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_kpis jsonb;
  v_ar   jsonb;
  v_ap   jsonb;
  v_low  jsonb;
  v_sm   jsonb;
  v_pm   jsonb;
  v_cash jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  SELECT to_jsonb(k)
    INTO v_kpis
    FROM v_dashboard_kpis k
   WHERE k.business_id = p_business_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO v_ar
    FROM (
      SELECT left(doc_number, 40)          AS doc_number,
             left(party_name, 80)          AS party_name,
             doc_date,
             due_date,
             outstanding::double precision AS outstanding,
             days_overdue
        FROM v_receivables_aging_base
       WHERE business_id = p_business_id
         AND outstanding > 0
       ORDER BY outstanding DESC
       LIMIT 10
    ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO v_ap
    FROM (
      SELECT left(doc_number, 40)          AS doc_number,
             left(party_name, 80)          AS party_name,
             doc_date,
             due_date,
             outstanding::double precision AS outstanding,
             days_overdue
        FROM v_payables_aging_base
       WHERE business_id = p_business_id
         AND outstanding > 0
       ORDER BY outstanding DESC
       LIMIT 10
    ) r2;

  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    INTO v_low
    FROM (
      SELECT left(name, 80)                 AS name,
             current_stock::double precision AS stock,
             minimum_stock::double precision AS min_stock
        FROM products
       WHERE business_id = p_business_id
         AND type = 'product'
         AND is_active
         AND minimum_stock > 0
         AND current_stock <= minimum_stock
       ORDER BY (minimum_stock - current_stock) DESC
       LIMIT 10
    ) p;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_sm
    FROM (
      SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
             sum(grand_total)::double precision                     AS total,
             count(*)                                               AS invoices
        FROM sales_invoices
       WHERE business_id = p_business_id
         AND status IN ('issued', 'partially_paid', 'paid')
         AND invoice_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')
       GROUP BY 1
    ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(m2) ORDER BY m2.month), '[]'::jsonb)
    INTO v_pm
    FROM (
      SELECT to_char(date_trunc('month', bill_date), 'YYYY-MM') AS month,
             sum(grand_total)::double precision                 AS total,
             count(*)                                           AS bills
        FROM purchase_bills
       WHERE business_id = p_business_id
         AND status IN ('confirmed', 'partially_paid', 'paid')
         AND bill_date >= (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')
       GROUP BY 1
    ) m2;

  SELECT jsonb_build_object(
           'total',
           COALESCE(sum(c.current_balance), 0)::double precision,
           'accounts',
           COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         )
    INTO v_cash
    FROM (
      SELECT left(name, 60)                       AS name,
             current_balance::double precision     AS balance
        FROM accounts
       WHERE business_id = p_business_id
         AND group_name = 'Cash & Bank'
       ORDER BY name
       LIMIT 8
    ) c;

  RETURN jsonb_build_object(
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',       p_business_id,
    'kpis',              v_kpis,
    'receivables_top',   v_ar,
    'payables_top',      v_ap,
    'low_stock',         v_low,
    'sales_monthly',     v_sm,
    'purchases_monthly', v_pm,
    'cash_position',     v_cash
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_ai_business_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ai_business_snapshot(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_ai_business_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION get_ai_business_snapshot(uuid) IS
  'Compact trusted-surface JSON snapshot for the ai-assistant edge function. Definer-gated via is_business_member(); free-text truncated; never includes notes/terms.';

-- 044: businesses.upi_id - optional UPI ID for invoice payment QR codes (T70)
-- Additive only; businesses SELECT policies already cover owner/members.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS upi_id text;

COMMENT ON COLUMN public.businesses.upi_id IS 'Optional UPI ID (VPA) used to render payment QR codes on sales invoices';

-- ============================================================================
-- 046 â€” Document conversion RPCs (T88): QT->Invoice, SO->Invoice, PO->Bill
--
-- Owner-required flows previously stubbed in the UI ("Conversion lands next
-- release"). Three SECURITY DEFINER functions, house security pattern
-- (is_business_member gate like get_gst_summary / get_ai_business_snapshot):
--
--   convert_quotation_to_invoice(p_quotation_id)     requires source 'accepted'
--   convert_sales_order_to_invoice(p_sales_order_id) requires source 'fulfilled'
--   convert_purchase_order_to_bill(p_purchase_order_id) requires source 'received'
--
-- STATUS MACHINES (026, J2): converted is reachable ONLY from accepted /
-- fulfilled / received. draft/sent/confirmed/received(pending)/rejected/
-- cancelled states RAISE with the current status named. Converting an
-- already-converted doc RAISES naming the existing downstream document
-- (idempotency refusal, issue_document precedent).
--
-- SINGLE TRANSACTION: source header is SELECT ... FOR UPDATE'd first; the
-- target document is created by REUSING the canonical 017/030 save RPCs
-- (create_sales_invoice / create_purchase_bill) so numbering, per-item
-- validation, RMW stock effects, audit logs, and JE posting follow the
-- EXACT live-path math â€” no parallel tax/stock logic exists here. Item
-- qty/rate/discount/tax breakdowns are carried over verbatim (jsonb numeric
-- round-trip is lossless), preserving the J1 identity through posting.
-- Source flips to status='converted' + converted_doc_id=<target> in the
-- same tx; any failure rolls everything back.
--
-- ADDITIVE ONLY: no ALTER of existing columns (converted_doc_id already
-- exists from 026); no destructive statements. Target documents are dated
-- TODAY (a conversion is a fresh commercial event); due_date left NULL for
-- the user to set.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A. Quotation -> Sales Invoice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION convert_quotation_to_invoice(
  p_quotation_id uuid
)
RETURNS TABLE (document_id uuid, document_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q        record;
  v_header jsonb;
  v_items  jsonb;
  v_inv_id uuid;
  v_je_id  uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO q
    FROM quotations
   WHERE id = p_quotation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;

  IF NOT is_business_member(q.business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF NOT can_write_business(q.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF q.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % was already converted to document %', q.quotation_number, q.converted_doc_id;
  END IF;
  IF q.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only ACCEPTED quotations can be converted; quotation % is currently %', q.quotation_number, q.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      i.product_id,
           'product_name',    i.product_name,
           'hsn_sac',         i.hsn_sac,
           'quantity',        i.quantity,
           'unit',            i.unit,
           'rate',            i.rate,
           'discount_amount', i.discount_amount,
           'tax_rate',        i.tax_rate,
           'taxable_amount',  i.taxable_amount,
           'cgst_amount',     i.cgst_amount,
           'sgst_amount',     i.sgst_amount,
           'igst_amount',     i.igst_amount,
           'cess_amount',     i.cess_amount,
           'total_amount',    i.total_amount
         )), '[]'::jsonb)
    INTO v_items
    FROM quotation_items i
   WHERE i.quotation_id = q.id;

  v_header := jsonb_build_object(
    'customer_id',     q.customer_id,
    'invoice_date',    CURRENT_DATE,
    'subtotal',        q.subtotal,
    'discount_amount', q.discount_amount,
    'taxable_amount',  q.taxable_amount,
    'cgst_amount',     q.cgst_amount,
    'sgst_amount',     q.sgst_amount,
    'igst_amount',     q.igst_amount,
    'cess_amount',     q.cess_amount,
    'round_off',       q.round_off,
    'grand_total',     q.grand_total,
    'notes',           concat_ws(' â€” ', nullif(q.notes, ''), 'Converted from quotation ' || q.quotation_number),
    'terms',           q.terms
  );

  SELECT invoice_id, journal_entry_id
    INTO v_inv_id, v_je_id
    FROM create_sales_invoice(q.business_id, v_header, v_items, 'issued');

  SELECT invoice_number INTO v_number
    FROM sales_invoices
   WHERE id = v_inv_id;

  UPDATE quotations
     SET status = 'converted',
         converted_doc_id = v_inv_id,
         updated_at = now()
   WHERE id = q.id;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    q.business_id, auth.uid(), 'quotation_converted', 'quotation', q.id,
    'Quotation ' || q.quotation_number || ' converted to invoice ' || v_number
  );

  RETURN QUERY SELECT v_inv_id, v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Sales Order -> Sales Invoice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION convert_sales_order_to_invoice(
  p_sales_order_id uuid
)
RETURNS TABLE (document_id uuid, document_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s        record;
  v_header jsonb;
  v_items  jsonb;
  v_inv_id uuid;
  v_je_id  uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO s
    FROM sales_orders
   WHERE id = p_sales_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found';
  END IF;

  IF NOT is_business_member(s.business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF NOT can_write_business(s.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF s.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Sales order % was already converted to document %', s.order_number, s.converted_doc_id;
  END IF;
  IF s.status <> 'fulfilled' THEN
    RAISE EXCEPTION 'Only FULFILLED sales orders can be converted; order % is currently %', s.order_number, s.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      i.product_id,
           'product_name',    i.product_name,
           'hsn_sac',         i.hsn_sac,
           'quantity',        i.quantity,
           'unit',            i.unit,
           'rate',            i.rate,
           'discount_amount', i.discount_amount,
           'tax_rate',        i.tax_rate,
           'taxable_amount',  i.taxable_amount,
           'cgst_amount',     i.cgst_amount,
           'sgst_amount',     i.sgst_amount,
           'igst_amount',     i.igst_amount,
           'cess_amount',     i.cess_amount,
           'total_amount',    i.total_amount
         )), '[]'::jsonb)
    INTO v_items
    FROM sales_order_items i
   WHERE i.sales_order_id = s.id;

  v_header := jsonb_build_object(
    'customer_id',     s.customer_id,
    'invoice_date',    CURRENT_DATE,
    'subtotal',        s.subtotal,
    'discount_amount', s.discount_amount,
    'taxable_amount',  s.taxable_amount,
    'cgst_amount',     s.cgst_amount,
    'sgst_amount',     s.sgst_amount,
    'igst_amount',     s.igst_amount,
    'cess_amount',     s.cess_amount,
    'round_off',       s.round_off,
    'grand_total',     s.grand_total,
    'notes',           concat_ws(' â€” ', nullif(s.notes, ''), 'Converted from sales order ' || s.order_number)
  );

  SELECT invoice_id, journal_entry_id
    INTO v_inv_id, v_je_id
    FROM create_sales_invoice(s.business_id, v_header, v_items, 'issued');

  SELECT invoice_number INTO v_number
    FROM sales_invoices
   WHERE id = v_inv_id;

  UPDATE sales_orders
     SET status = 'converted',
         converted_doc_id = v_inv_id,
         updated_at = now()
   WHERE id = s.id;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    s.business_id, auth.uid(), 'sales_order_converted', 'sales_order', s.id,
    'Sales order ' || s.order_number || ' converted to invoice ' || v_number
  );

  RETURN QUERY SELECT v_inv_id, v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- C. Purchase Order -> Purchase Bill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION convert_purchase_order_to_bill(
  p_purchase_order_id uuid
)
RETURNS TABLE (document_id uuid, document_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p        record;
  v_header jsonb;
  v_items  jsonb;
  v_bill_id uuid;
  v_je_id  uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO p
    FROM purchase_orders
   WHERE id = p_purchase_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF NOT is_business_member(p.business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF NOT can_write_business(p.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order % was already converted to document %', p.order_number, p.converted_doc_id;
  END IF;
  IF p.status <> 'received' THEN
    RAISE EXCEPTION 'Only RECEIVED purchase orders can be converted; order % is currently %', p.order_number, p.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      i.product_id,
           'product_name',    i.product_name,
           'hsn_sac',         i.hsn_sac,
           'quantity',        i.quantity,
           'unit',            i.unit,
           'rate',            i.rate,
           'discount_amount', i.discount_amount,
           'tax_rate',        i.tax_rate,
           'taxable_amount',  i.taxable_amount,
           'cgst_amount',     i.cgst_amount,
           'sgst_amount',     i.sgst_amount,
           'igst_amount',     i.igst_amount,
           'cess_amount',     i.cess_amount,
           'total_amount',    i.total_amount
         )), '[]'::jsonb)
    INTO v_items
    FROM purchase_order_items i
   WHERE i.purchase_order_id = p.id;

  v_header := jsonb_build_object(
    'supplier_id',     p.supplier_id,
    'bill_date',       CURRENT_DATE,
    'subtotal',        p.subtotal,
    'discount_amount', p.discount_amount,
    'taxable_amount',  p.taxable_amount,
    'cgst_amount',     p.cgst_amount,
    'sgst_amount',     p.sgst_amount,
    'igst_amount',     p.igst_amount,
    'cess_amount',     p.cess_amount,
    'round_off',       p.round_off,
    'grand_total',     p.grand_total,
    'notes',           concat_ws(' â€” ', nullif(p.notes, ''), 'Converted from purchase order ' || p.order_number)
  );

  SELECT bill_id, journal_entry_id
    INTO v_bill_id, v_je_id
    FROM create_purchase_bill(p.business_id, v_header, v_items, 'confirmed');

  SELECT bill_number INTO v_number
    FROM purchase_bills
   WHERE id = v_bill_id;

  UPDATE purchase_orders
     SET status = 'converted',
         converted_doc_id = v_bill_id,
         updated_at = now()
   WHERE id = p.id;

  INSERT INTO audit_logs (
    business_id, user_id, action, entity_type, entity_id, description
  ) VALUES (
    p.business_id, auth.uid(), 'purchase_order_converted', 'purchase_order', p.id,
    'Purchase order ' || p.order_number || ' converted to bill ' || v_number
  );

  RETURN QUERY SELECT v_bill_id, v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- D. Hardened grants (house pattern)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION convert_quotation_to_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_quotation_to_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION convert_quotation_to_invoice(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION convert_sales_order_to_invoice(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_sales_order_to_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION convert_sales_order_to_invoice(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION convert_purchase_order_to_bill(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_purchase_order_to_bill(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION convert_purchase_order_to_bill(uuid) TO authenticated;

COMMENT ON FUNCTION convert_quotation_to_invoice(uuid) IS
  'Converts an ACCEPTED quotation into a live sales invoice via the canonical 017 save path; marks source converted + deep-link id; single transaction.';
COMMENT ON FUNCTION convert_sales_order_to_invoice(uuid) IS
  'Converts a FULFILLED sales order into a live sales invoice via the canonical 017 save path; marks source converted + deep-link id; single transaction.';
COMMENT ON FUNCTION convert_purchase_order_to_bill(uuid) IS
  'Converts a RECEIVED purchase order into a confirmed purchase bill via the canonical 017 save path; marks source converted + deep-link id; single transaction.';

-- 047: businesses bank detail columns - quotation/sales-order/invoice bank pre-fill (T90)
-- Additive only; mirrors 044 pattern. InvoiceSheet.tsx already reads
-- bank_name / bank_account_number via casts; this makes them real columns.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc_code text;

COMMENT ON COLUMN public.businesses.bank_name IS 'Optional bank name rendered in Bank Details blocks on invoices/quotations/sales orders';
COMMENT ON COLUMN public.businesses.bank_account_number IS 'Optional account number rendered in Bank Details blocks';
COMMENT ON COLUMN public.businesses.bank_ifsc_code IS 'Optional IFSC code rendered in Bank Details blocks';

-- 046: document conversion RPCs (T88) - the "later card" promised by 026
-- Reuses create_sales_invoice / create_purchase_bill INTERNALLY so invoice/bill
-- math, numbering, journal posting and server-side stock movements are exactly
-- the 017 path (J1 identity preserved; no parallel math).
--
-- Status machines (026): only live pre-conversion states may convert.
--   quotations      sent|accepted  -> converted (draft/rejected/cancelled blocked)
--   sales_orders    confirmed|fulfilled -> converted
--   purchase_orders confirmed|received  -> converted
-- Double conversion impossible: source row is locked FOR UPDATE, status is
-- re-checked under that lock, and the final UPDATE guards on status again.
-- Linkage: 026 already provides converted_doc_id on all three tables.

-- ============================================================================
-- A. QUOTATION -> SALES INVOICE
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_quotation_to_invoice(
  p_business_id uuid,
  p_quotation_id uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q quotations;
  v_expected text[] := ARRAY['sent','accepted']::text[];
  v_items jsonb;
  v_inv jsonb;
  v_created record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_q FROM quotations
  WHERE id = p_quotation_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found in this business';
  END IF;
  IF v_q.status = 'converted' OR v_q.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted', v_q.quotation_number;
  END IF;
  IF NOT v_q.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only sent or accepted quotations can be converted (current status: %)', v_q.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      it.product_id,
           'product_name',    it.product_name,
           'hsn_sac',         it.hsn_sac,
           'quantity',        it.quantity,
           'unit',            it.unit,
           'rate',            it.rate,
           'discount_amount', it.discount_amount,
           'tax_rate',        it.tax_rate,
           'taxable_amount',  it.taxable_amount,
           'cgst_amount',     it.cgst_amount,
           'sgst_amount',     it.sgst_amount,
           'igst_amount',     it.igst_amount,
           'cess_amount',     it.cess_amount,
           'total_amount',    it.total_amount
         ) ORDER BY it.created_at, it.id), '[]'::jsonb)
  INTO v_items
  FROM quotation_items it
  WHERE it.quotation_id = v_q.id;

  v_inv := jsonb_build_object(
    'status',          'issued',
    'customer_id',     v_q.customer_id,
    'invoice_date',    COALESCE(p_invoice_date, CURRENT_DATE),
    'due_date',        p_due_date,
    'subtotal',        v_q.subtotal,
    'discount_amount', v_q.discount_amount,
    'taxable_amount',  v_q.taxable_amount,
    'cgst_amount',     v_q.cgst_amount,
    'sgst_amount',     v_q.sgst_amount,
    'igst_amount',     v_q.igst_amount,
    'cess_amount',     v_q.cess_amount,
    'round_off',       v_q.round_off,
    'grand_total',     v_q.grand_total,
    'notes',           v_q.notes,
    'terms',           v_q.terms
  );

  SELECT invoice_id, invoice_number INTO v_created
  FROM create_sales_invoice(p_business_id, v_inv, v_items);

  UPDATE quotations
  SET status = 'converted', converted_doc_id = v_created.invoice_id, updated_at = now()
  WHERE id = v_q.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_created.invoice_id, v_created.invoice_number;
END;
$$;

-- ============================================================================
-- B. SALES ORDER -> SALES INVOICE
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_sales_order_to_invoice(
  p_business_id uuid,
  p_order_id uuid,
  p_invoice_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o sales_orders;
  v_expected text[] := ARRAY['confirmed','fulfilled']::text[];
  v_items jsonb;
  v_inv jsonb;
  v_created record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_o FROM sales_orders
  WHERE id = p_order_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order not found in this business';
  END IF;
  IF v_o.status = 'converted' OR v_o.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Sales order % has already been converted', v_o.order_number;
  END IF;
  IF NOT v_o.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only confirmed or fulfilled sales orders can be converted (current status: %)', v_o.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      it.product_id,
           'product_name',    it.product_name,
           'hsn_sac',         it.hsn_sac,
           'quantity',        it.quantity,
           'unit',            it.unit,
           'rate',            it.rate,
           'discount_amount', it.discount_amount,
           'tax_rate',        it.tax_rate,
           'taxable_amount',  it.taxable_amount,
           'cgst_amount',     it.cgst_amount,
           'sgst_amount',     it.sgst_amount,
           'igst_amount',     it.igst_amount,
           'cess_amount',     it.cess_amount,
           'total_amount',    it.total_amount
         ) ORDER BY it.created_at, it.id), '[]'::jsonb)
  INTO v_items
  FROM sales_order_items it
  WHERE it.sales_order_id = v_o.id;

  v_inv := jsonb_build_object(
    'status',          'issued',
    'customer_id',     v_o.customer_id,
    'invoice_date',    COALESCE(p_invoice_date, CURRENT_DATE),
    'due_date',        p_due_date,
    'subtotal',        v_o.subtotal,
    'discount_amount', v_o.discount_amount,
    'taxable_amount',  v_o.taxable_amount,
    'cgst_amount',     v_o.cgst_amount,
    'sgst_amount',     v_o.sgst_amount,
    'igst_amount',     v_o.igst_amount,
    'cess_amount',     v_o.cess_amount,
    'round_off',       v_o.round_off,
    'grand_total',     v_o.grand_total,
    'notes',           v_o.notes
  );

  SELECT invoice_id, invoice_number INTO v_created
  FROM create_sales_invoice(p_business_id, v_inv, v_items);

  UPDATE sales_orders
  SET status = 'converted', converted_doc_id = v_created.invoice_id, updated_at = now()
  WHERE id = v_o.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales order state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_created.invoice_id, v_created.invoice_number;
END;
$$;

-- ============================================================================
-- C. PURCHASE ORDER -> PURCHASE BILL
-- ============================================================================
CREATE OR REPLACE FUNCTION convert_purchase_order_to_bill(
  p_business_id uuid,
  p_order_id uuid,
  p_bill_date date DEFAULT CURRENT_DATE,
  p_due_date date DEFAULT NULL
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o purchase_orders;
  v_expected text[] := ARRAY['confirmed','received']::text[];
  v_items jsonb;
  v_bill jsonb;
  v_created record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_o FROM purchase_orders
  WHERE id = p_order_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found in this business';
  END IF;
  IF v_o.status = 'converted' OR v_o.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order % has already been converted', v_o.order_number;
  END IF;
  IF NOT v_o.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only confirmed or received purchase orders can be converted (current status: %)', v_o.status;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',      it.product_id,
           'product_name',    it.product_name,
           'hsn_sac',         it.hsn_sac,
           'quantity',        it.quantity,
           'unit',            it.unit,
           'rate',            it.rate,
           'discount_amount', it.discount_amount,
           'tax_rate',        it.tax_rate,
           'taxable_amount',  it.taxable_amount,
           'cgst_amount',     it.cgst_amount,
           'sgst_amount',     it.sgst_amount,
           'igst_amount',     it.igst_amount,
           'cess_amount',     it.cess_amount,
           'total_amount',    it.total_amount
         ) ORDER BY it.created_at, it.id), '[]'::jsonb)
  INTO v_items
  FROM purchase_order_items it
  WHERE it.purchase_order_id = v_o.id;

  v_bill := jsonb_build_object(
    'status',          'confirmed',
    'supplier_id',     v_o.supplier_id,
    'bill_date',       COALESCE(p_bill_date, CURRENT_DATE),
    'due_date',        p_due_date,
    'subtotal',        v_o.subtotal,
    'discount_amount', v_o.discount_amount,
    'taxable_amount',  v_o.taxable_amount,
    'cgst_amount',     v_o.cgst_amount,
    'sgst_amount',     v_o.sgst_amount,
    'igst_amount',     v_o.igst_amount,
    'cess_amount',     v_o.cess_amount,
    'round_off',       v_o.round_off,
    'grand_total',     v_o.grand_total,
    'notes',           v_o.notes
  );

  SELECT bill_id, bill_number INTO v_created
  FROM create_purchase_bill(p_business_id, v_bill, v_items);

  UPDATE purchase_orders
  SET status = 'converted', converted_doc_id = v_created.bill_id, updated_at = now()
  WHERE id = v_o.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_created.bill_id, v_created.bill_number;
END;
$$;

-- ============================================================================
-- 048: convert_quotation_to_sales_order (T92) â€” completes the conversion
-- family started by 046 (QT->INV, SO->INV, PO->BILL). Mirrors the live
-- 046 house pattern exactly (20260825213000_046_document_conversion_rpcs):
--   * auth.uid() + can_write_business() gates
--   * FOR UPDATE lock on the source quotation, business-scoped
--   * double-conversion blocked TWICE: pre-check under the lock AND the
--     final status-guarded UPDATE (idempotent RAISE on re-entry)
--   * deep-copy with EXACT column mapping, zero re-derivation of any total
--   * guarded flip to 'converted' + converted_doc_id linkage
--
-- CONTRACT NOTES (deviations from the dispatch text, all schema-driven):
--   * RETURNS new_doc_id UUID (dispatch said int) â€” sales_orders.id and
--     quotations.converted_doc_id are uuid since 026; mirroring 046.
--   * quotations has NO converted_doc_type column (026) â€” linkage is
--     converted_doc_id plus the natural back-link sales_orders.quotation_id,
--     which this RPC populates for bidirectional traceability.
--   * sales_orders has NO terms column â€” quotation terms are dropped on
--     copy (documented here; notes carry over verbatim).
--   * New order starts at 'draft': orders are paperwork until confirmed
--     (J2 machine draft -> confirmed -> fulfilled -> converted). A merely
--     SENT quote must not mint a confirmed commitment; the user confirms
--     deliberately downstream. 046 produced a LIVE invoice because invoices
--     are themselves the money event â€” an order is not.
--   * expected_date <- expiry_date (quote validity maps to delivery
--     expectation); order_date <- p_order_date (default CURRENT_DATE).
--
-- NUMBERING: next_document_number(business_id,'sales_order',date) â€” the
-- SAME service path every existing sales_orders row uses (026 re-emission;
-- prefix SO/YYYY/nnnnnn). No parallel numbering.
-- NO stock movements, NO journal entries (orders never touch stock or books
-- per J2). NO audit_logs write â€” mirror of the live 046 bodies.
-- businesses.financial_year_lock triggers (038) police the order date
-- automatically via the generic to_jsonb coverage â€” nothing to add here.
-- ============================================================================

CREATE OR REPLACE FUNCTION convert_quotation_to_sales_order(
  p_business_id uuid,
  p_quotation_id uuid,
  p_order_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (new_doc_id uuid, new_doc_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q quotations;
  v_expected text[] := ARRAY['sent','accepted']::text[];
  v_order_date date;
  v_so_no text;
  v_so_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  SELECT * INTO v_q FROM quotations
  WHERE id = p_quotation_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found in this business';
  END IF;
  IF v_q.status = 'converted' OR v_q.converted_doc_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quotation % has already been converted', v_q.quotation_number;
  END IF;
  IF NOT v_q.status = ANY(v_expected) THEN
    RAISE EXCEPTION 'Only sent or accepted quotations can be converted (current status: %)', v_q.status;
  END IF;

  v_order_date := COALESCE(p_order_date, CURRENT_DATE);
  v_so_no := next_document_number(p_business_id, 'sales_order', v_order_date);

  INSERT INTO sales_orders (
    business_id, order_number, customer_id, quotation_id,
    order_date, expected_date,
    subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount,
    round_off, grand_total,
    status, notes, created_by
  ) VALUES (
    v_q.business_id, v_so_no, v_q.customer_id, v_q.id,
    v_order_date, v_q.expiry_date,
    v_q.subtotal, v_q.discount_amount, v_q.taxable_amount,
    v_q.cgst_amount, v_q.sgst_amount, v_q.igst_amount, v_q.cess_amount,
    v_q.round_off, v_q.grand_total,
    'draft', v_q.notes, auth.uid()
  )
  RETURNING id INTO v_so_id;

  -- Deep-copy ALL line items verbatim (rates, tax distribution, totals).
  INSERT INTO sales_order_items (
    business_id, sales_order_id, product_id, product_name, hsn_sac,
    quantity, unit, rate, discount_amount, tax_rate,
    taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount,
    total_amount
  )
  SELECT
    v_q.business_id, v_so_id, it.product_id, it.product_name, it.hsn_sac,
    it.quantity, it.unit, it.rate, it.discount_amount, it.tax_rate,
    it.taxable_amount, it.cgst_amount, it.sgst_amount, it.igst_amount, it.cess_amount,
    it.total_amount
  FROM quotation_items it
  WHERE it.quotation_id = v_q.id
  ORDER BY it.created_at, it.id;

  -- Post-guard flip: re-checks the allow-list under the row lock taken at
  -- entry; if a concurrent writer changed status, this finds no row and we
  -- abort the whole transaction (order insert rolls back with it).
  UPDATE quotations
  SET status = 'converted', converted_doc_id = v_so_id, updated_at = now()
  WHERE id = v_q.id AND status = ANY(v_expected);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation state changed during conversion - retry';
  END IF;

  RETURN QUERY SELECT v_so_id, v_so_no;
END;
$$;

REVOKE EXECUTE ON FUNCTION convert_quotation_to_sales_order(uuid, uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_quotation_to_sales_order(uuid, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION convert_quotation_to_sales_order(uuid, uuid, date) TO authenticated;

-- ============================================================================
-- 049: stock movement reference tagging (T92 verification-sweep patch)
--
-- Sweep finding: the ONLY writers that leave stock_movements.reference_type /
-- reference_id NULL are legitimate root events with no upstream document:
--   * type='opening'           â€” FE product creation (ProductCreatePage
--                                inserts directly; no source doc exists)
--   * reference_type='manual_adjustment' â€” post_stock_adjustment_atomic
--                                (036) passes its movement id to the JOURNAL,
--                                but leaves the movement's own reference_id NULL
-- Every doc-driven writer (017 issue/confirm, 030 promotion, 022 CN/DN and
-- cancellations, 036 invoice/bill cancels, 039 transfer legs + cancel)
-- already tags fully.
--
-- This card makes the "every movement references its source" invariant
-- universally true, metadata-only (no quantity / balance / date is touched):
--   1) BEFORE INSERT trigger tags future rows at write time;
--   2) one-time idempotent backfill for existing NULL rows. The backfill
--      temporarily disables trg_stock_append_only (023 forbids UPDATE on
--      this table) INSIDE this migration's transaction â€” if anything raises,
--      the whole migration rolls back WITH the trigger still enabled.
-- Backfill is safe to re-run: WHERE clauses leave tagged rows untouched.
-- Idempotency note: uq-style partial unique indexes are unaffected; the
-- 036 duplicate-posting backstop lives on journal_entries, not here.
-- ============================================================================

CREATE OR REPLACE FUNCTION tag_stock_movement_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Opening stock: root event, source = the product row itself.
  IF NEW.type = 'opening' AND NEW.reference_type IS NULL THEN
    NEW.reference_type := 'product_opening';
  END IF;
  IF NEW.reference_type = 'product_opening' AND NEW.reference_id IS NULL THEN
    NEW.reference_id := NEW.product_id;
  END IF;
  -- Manual adjustments: self-reference so the movement is joinable from
  -- its journal (which already carries this id as reference_id).
  IF NEW.reference_type = 'manual_adjustment' AND NEW.reference_id IS NULL THEN
    NEW.reference_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_reference_tagging ON stock_movements;
CREATE TRIGGER trg_stock_reference_tagging
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION tag_stock_movement_references();

-- ----------------------------------------------------------------------------
-- One-time backfill (metadata only). Append-only guard lifted for exactly
-- these two statements inside this transaction.
-- ----------------------------------------------------------------------------
ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_append_only;

UPDATE stock_movements
SET reference_type = 'product_opening', reference_id = product_id
WHERE type = 'opening'
  AND reference_type IS NULL;

UPDATE stock_movements
SET reference_id = id
WHERE reference_type = 'manual_adjustment'
  AND reference_id IS NULL;

ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_append_only;

-- ============================================================================
-- 050: communications core schema (T95) - notification + delivery system
--
-- Five additive tables, ZERO contact with accounting logic. Secrets boundary
-- (ABSOLUTE RULE): communication_settings stores CONFIGURATION PRESENCE
-- FLAGS ONLY (email_configured / whatsapp_configured + non-secret
-- identifiers like from-address / phone-number-id). Actual credentials
-- (API keys, tokens) live EXCLUSIVELY in Edge Function env
-- (`supabase secrets set`) and MUST NEVER be written to any table.
--
-- DEVIATIONS from dispatch text (existing-convention-forced, documented):
--   * notification_logs.business_id gains REFERENCES businesses(id) ON
--     DELETE CASCADE (house convention on every business-scoped table).
--   * notification_logs.channel made NOT NULL - a log row without a
--     channel is uninterpretable; every writer knows its channel.
--   * notification_logs.recipient_ref stays a bare uuid (polymorphic
--     customers|suppliers - no single FK possible); referential honesty is
--     enforced by enqueue_notification (051) instead.
--   * notification_preferences uses the natural composite PRIMARY KEY
--     (business_id, user_id, pref_key) instead of a surrogate id + UNIQUE.
--   * scheduled_reports gains light CHECKs (day_of_week 0-6, day_of_month
--     1-31) and a partial engine-support index on enabled rows.
--
-- RLS mirrors the 024/026 house style: SELECT = members; INSERT = write
-- role; UPDATE/DELETE = owner/admin (templates/settings/schedules).
-- notification_logs gets NO update/delete policies on purpose: rows are
-- mutated exclusively through SECURITY DEFINER engine RPCs (051) -
-- the same server-write-only discipline audit_logs received in 024.
-- notification_preferences is self-service: users manage THEIR OWN rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) notification_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','in_app')),
  subject text,
  body text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, key, channel)
);

-- ----------------------------------------------------------------------------
-- 2) notification_logs (delivery ledger - metadata only, never file bytes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','in_app')),
  template_key text,
  recipient_type text CHECK (recipient_type IN ('customer','supplier','custom')),
  recipient_ref uuid,
  recipient_address text NOT NULL,
  subject text,
  body text,
  attachment_name text,
  doc_type text CHECK (doc_type IN ('sales_invoice','quotation','sales_order',
    'purchase_order','payment_receipt','statement','report','reminder','custom')),
  doc_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  provider text,
  provider_message_id text,
  error_message text,
  idempotency_key text UNIQUE,
  retry_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_business_created
  ON notification_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_doc
  ON notification_logs (doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_pending
  ON notification_logs (business_id, created_at)
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 3) communication_settings (presence flags ONLY - see header)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_settings (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  email_provider text,
  email_from_address text,
  email_configured boolean NOT NULL DEFAULT false,
  whatsapp_provider text NOT NULL DEFAULT 'meta_cloud',
  whatsapp_phone_number_id text,
  whatsapp_configured boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4) notification_preferences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pref_key text NOT NULL,
  pref_value jsonb,
  PRIMARY KEY (business_id, user_id, pref_key)
);

-- ----------------------------------------------------------------------------
-- 5) scheduled_reports
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  report_key text NOT NULL,
  recipients jsonb NOT NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month integer CHECK (day_of_month BETWEEN 1 AND 31),
  time_of_day time NOT NULL DEFAULT '08:00',
  formats text[] NOT NULL DEFAULT '{pdf}',
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_enabled
  ON scheduled_reports (business_id)
  WHERE enabled;

-- ============================================================================
-- RLS (all five)
-- ============================================================================
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;

-- templates: read all members, write-role creates, owner/admin mutates
CREATE POLICY "notification_templates_select" ON notification_templates FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "notification_templates_insert" ON notification_templates FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "notification_templates_update" ON notification_templates FOR UPDATE
  TO authenticated USING (is_business_admin(business_id))
  WITH CHECK (is_business_admin(business_id));
CREATE POLICY "notification_templates_delete" ON notification_templates FOR DELETE
  TO authenticated USING (is_business_admin(business_id));

-- logs: read all members, write-role enqueues; NO update/delete (engine-only)
CREATE POLICY "notification_logs_select" ON notification_logs FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "notification_logs_insert" ON notification_logs FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));

-- settings: read all members, owner/admin full control
CREATE POLICY "communication_settings_select" ON communication_settings FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "communication_settings_insert" ON communication_settings FOR INSERT
  TO authenticated WITH CHECK (is_business_admin(business_id));
CREATE POLICY "communication_settings_update" ON communication_settings FOR UPDATE
  TO authenticated USING (is_business_admin(business_id))
  WITH CHECK (is_business_admin(business_id));
CREATE POLICY "communication_settings_delete" ON communication_settings FOR DELETE
  TO authenticated USING (is_business_admin(business_id));

-- preferences: read members; each user manages their own rows only
CREATE POLICY "notification_preferences_select" ON notification_preferences FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "notification_preferences_insert" ON notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_business_member(business_id));
CREATE POLICY "notification_preferences_update" ON notification_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND is_business_member(business_id))
  WITH CHECK (user_id = auth.uid() AND is_business_member(business_id));
CREATE POLICY "notification_preferences_delete" ON notification_preferences FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() AND is_business_member(business_id));

-- scheduled reports: read members, write-role creates, owner/admin mutates
CREATE POLICY "scheduled_reports_select" ON scheduled_reports FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "scheduled_reports_insert" ON scheduled_reports FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "scheduled_reports_update" ON scheduled_reports FOR UPDATE
  TO authenticated USING (is_business_admin(business_id))
  WITH CHECK (is_business_admin(business_id));
CREATE POLICY "scheduled_reports_delete" ON scheduled_reports FOR DELETE
  TO authenticated USING (is_business_admin(business_id));

-- ============================================================================
-- 051: communications engine (T95) - RPCs + default template seeding
--
-- Engine RPCs (SECURITY DEFINER, business-scoped, membership-validated):
--   enqueue_notification(...)        -> pending log row; duplicate-send safe
--   retry_notification(p_log_id)     -> failed -> pending (+retry_count)
--   cancel_notification(p_log_id)    -> pending|failed -> cancelled
--   get_communication_settings(biz)  -> presence flags (NO secrets exist)
--   upsert_communication_settings()  -> owner/admin; flags only, by design
-- Templates + scheduled_reports are managed by DIRECT RLS-gated table CRUD
-- (house preference, mirrors the T66 warehouses decision) - no extra RPCs.
--
-- SEEDING: one editable template row per key/channel as real data
-- (never hardcoded strings in FE/provider code). Matrix: email + in_app
-- for ALL 12 keys; whatsapp additionally for the transactional customer
-- quad (invoice_sent, payment_received, payment_reminder, invoice_overdue)
-- = 28 rows per business. Idempotent via UNIQUE (business_id,key,channel);
-- backfills existing businesses here AND auto-seeds future businesses via
-- an AFTER INSERT trigger. Bodies use {{variable}} placeholders.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Seeder (LANGUAGE sql, definer so the businesses trigger can call it)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_business_notification_templates(
  p_business_id uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH src(key, channel, subject, body, variables) AS (
  VALUES
  ('invoice_sent','email',
   E'Invoice {{invoice_number}} from {{business_name}}',
   E'Dear {{customer_name}},\n\nYour invoice {{invoice_number}} from {{business_name}} for {{amount}} is ready.\nDue date: {{due_date}}.\n\nThank you for your business.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('invoice_sent','in_app',
   E'Invoice {{invoice_number}} issued',
   E'Invoice {{invoice_number}} for {{amount}} was issued to {{customer_name}}.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('invoice_sent','whatsapp',
   E'Invoice {{invoice_number}} from {{business_name}}',
   E'Dear {{customer_name}}, your invoice {{invoice_number}} from {{business_name}} for {{amount}} is ready. Due {{due_date}}. Thank you.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('payment_received','email',
   E'Payment received - thank you',
   E'Dear {{customer_name}},\n\nWe have received your payment of {{amount}} towards invoice {{invoice_number}}.\n\nThank you for your business.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('payment_received','in_app',
   E'Payment of {{amount}} received',
   E'Payment of {{amount}} received from {{customer_name}} towards invoice {{invoice_number}}.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('payment_received','whatsapp',
   E'Payment received - {{business_name}}',
   E'Dear {{customer_name}}, we have received your payment of {{amount}} towards invoice {{invoice_number}}. Thank you.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('payment_reminder','email',
   E'Reminder: invoice {{invoice_number}} due {{due_date}}',
   E'Dear {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.\n\nThank you.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('payment_reminder','in_app',
   E'Invoice {{invoice_number}} due {{due_date}}',
   E'Invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.',
   ARRAY['customer_name','invoice_number','amount','due_date']),
  ('payment_reminder','whatsapp',
   E'Reminder: invoice {{invoice_number}} due {{due_date}}',
   E'Dear {{customer_name}}, a gentle reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}. Thank you.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('invoice_overdue','email',
   E'Overdue: invoice {{invoice_number}}',
   E'Dear {{customer_name}},\n\nInvoice {{invoice_number}} for {{amount}} was due on {{due_date}} and remains outstanding.\nPlease arrange payment at your earliest convenience.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('invoice_overdue','in_app',
   E'Invoice {{invoice_number}} is overdue',
   E'Invoice {{invoice_number}} for {{amount}} has passed its due date {{due_date}}.',
   ARRAY['customer_name','invoice_number','amount','due_date']),
  ('invoice_overdue','whatsapp',
   E'Overdue: invoice {{invoice_number}}',
   E'Dear {{customer_name}}, invoice {{invoice_number}} for {{amount}} was due on {{due_date}} and remains outstanding. Please arrange payment.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('statement_customer','email',
   E'Your account statement from {{business_name}}',
   E'Dear {{customer_name}},\n\nPlease find your account statement for {{period_start}} to {{period_end}}. Closing balance: {{balance}}.',
   ARRAY['customer_name','business_name','period_start','period_end','balance']),
  ('statement_customer','in_app',
   E'Statement ready for {{period_start}} - {{period_end}}',
   E'Account statement for {{customer_name}} generated. Closing balance: {{balance}}.',
   ARRAY['customer_name','business_name','period_start','period_end','balance']),
  ('statement_supplier','email',
   E'Supplier statement from {{business_name}}',
   E'Dear {{supplier_name}},\n\nPlease find your supplier statement for {{period_start}} to {{period_end}}. Closing balance: {{balance}}.',
   ARRAY['supplier_name','business_name','period_start','period_end','balance']),
  ('statement_supplier','in_app',
   E'Supplier statement ready',
   E'Statement for {{supplier_name}} generated. Closing balance: {{balance}}.',
   ARRAY['supplier_name','business_name','period_start','period_end','balance']),
  ('quotation_sent','email',
   E'Quotation {{quotation_number}} from {{business_name}}',
   E'Dear {{customer_name}},\n\nThank you for your interest. Quotation {{quotation_number}} totalling {{amount}} is attached and valid until {{expiry_date}}.',
   ARRAY['customer_name','quotation_number','business_name','amount','expiry_date']),
  ('quotation_sent','in_app',
   E'Quotation {{quotation_number}} sent',
   E'Quotation {{quotation_number}} for {{amount}} sent to {{customer_name}}.',
   ARRAY['customer_name','quotation_number','business_name','amount']),
  ('sales_order_sent','email',
   E'Sales order confirmation {{order_number}}',
   E'Dear {{customer_name}},\n\nYour sales order {{order_number}} from {{business_name}} totalling {{amount}} has been confirmed.',
   ARRAY['customer_name','order_number','business_name','amount']),
  ('sales_order_sent','in_app',
   E'Sales order {{order_number}} confirmed',
   E'Sales order {{order_number}} for {{amount}} confirmed for {{customer_name}}.',
   ARRAY['customer_name','order_number','business_name','amount']),
  ('purchase_order_sent','email',
   E'Purchase order {{order_number}}',
   E'Dear {{supplier_name}},\n\nPlease find our purchase order {{order_number}} totalling {{amount}}.',
   ARRAY['supplier_name','order_number','business_name','amount']),
  ('purchase_order_sent','in_app',
   E'Purchase order {{order_number}} sent',
   E'Purchase order {{order_number}} for {{amount}} sent to {{supplier_name}}.',
   ARRAY['supplier_name','order_number','business_name','amount']),
  ('gst_report','email',
   E'GST summary {{period_start}} - {{period_end}}',
   E'Dear user,\n\nGST summary for {{business_name}}, {{period_start}} to {{period_end}}:\nOutput tax: {{output_tax}}\nInput tax: {{input_tax}}\nNet GST payable: {{net_tax}}',
   ARRAY['business_name','period_start','period_end','output_tax','input_tax','net_tax']),
  ('gst_report','in_app',
   E'GST report generated',
   E'GST summary for {{period_start}} - {{period_end}} generated. Net GST payable: {{net_tax}}.',
   ARRAY['business_name','period_start','period_end','output_tax','input_tax','net_tax']),
  ('report_delivery','email',
   E'Your requested report: {{report_name}}',
   E'Dear user,\n\nReport {{report_name}} was generated at {{generated_at}} and is attached as {{format}}.',
   ARRAY['report_name','generated_at','format']),
  ('report_delivery','in_app',
   E'Report ready: {{report_name}}',
   E'Report {{report_name}} was generated at {{generated_at}} ({{format}}).',
   ARRAY['report_name','generated_at','format']),
  ('monthly_summary','email',
   E'Monthly summary - {{month}}',
   E'Dear user,\n\nBusiness summary for {{month}}:\nTotal sales: {{total_sales}}\nTotal purchases: {{total_purchases}}\nReceivables: {{receivables}}\nPayables: {{payables}}',
   ARRAY['business_name','month','total_sales','total_purchases','receivables','payables']),
  ('monthly_summary','in_app',
   E'Monthly summary for {{month}}',
   E'Sales {{total_sales}}, purchases {{total_purchases}}, receivables {{receivables}}, payables {{payables}}.',
   ARRAY['business_name','month','total_sales','total_purchases','receivables','payables'])
)
ins AS (
  INSERT INTO notification_templates (business_id, key, channel, subject, body, variables)
  SELECT p_business_id, s.key, s.channel, s.subject, s.body, s.variables
  FROM src s
  WHERE EXISTS (SELECT 1 FROM businesses b WHERE b.id = p_business_id)
  ON CONFLICT (business_id, key, channel) DO NOTHING
  RETURNING 1
)
SELECT count(*)::int FROM ins;
$$;

-- Auto-seed every FUTURE business at creation time.
CREATE OR REPLACE FUNCTION trg_seed_business_templates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_business_notification_templates(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_notification_templates ON businesses;
CREATE TRIGGER trg_seed_notification_templates
AFTER INSERT ON businesses
FOR EACH ROW EXECUTE FUNCTION trg_seed_business_templates();

-- One-time idempotent backfill for existing businesses.
SELECT seed_business_notification_templates(id) FROM businesses;

-- ----------------------------------------------------------------------------
-- B. enqueue_notification - duplicate-send safe pending-row insert
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_notification(
  p_business_id uuid,
  p_channel text,
  p_template_key text DEFAULT NULL,
  p_recipient_type text DEFAULT 'custom',
  p_recipient_ref uuid DEFAULT NULL,
  p_recipient_address text,
  p_subject text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_doc_type text DEFAULT 'custom',
  p_doc_id uuid DEFAULT NULL,
  p_attachment_name text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE (log_id uuid, deduplicated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('email','whatsapp','in_app') THEN
    RAISE EXCEPTION 'Invalid channel %', p_channel;
  END IF;
  IF p_recipient_address IS NULL OR btrim(p_recipient_address) = '' THEN
    RAISE EXCEPTION 'recipient_address is required';
  END IF;

  -- Polymorphic recipient_ref honesty: the referenced party must live in
  -- THIS business before we ever queue a send against it.
  IF p_recipient_ref IS NOT NULL THEN
    IF p_recipient_type = 'customer' THEN
      IF NOT EXISTS (SELECT 1 FROM customers c
                     WHERE c.id = p_recipient_ref AND c.business_id = p_business_id) THEN
        RAISE EXCEPTION 'Customer % not found in this business', p_recipient_ref;
      END IF;
    ELSIF p_recipient_type = 'supplier' THEN
      IF NOT EXISTS (SELECT 1 FROM suppliers s
                     WHERE s.id = p_recipient_ref AND s.business_id = p_business_id) THEN
        RAISE EXCEPTION 'Supplier % not found in this business', p_recipient_ref;
      END IF;
    END IF;
  END IF;

  INSERT INTO notification_logs (
    business_id, channel, template_key, recipient_type, recipient_ref,
    recipient_address, subject, body, attachment_name, doc_type, doc_id,
    status, idempotency_key
  ) VALUES (
    p_business_id, p_channel, p_template_key, COALESCE(p_recipient_type,'custom'),
    p_recipient_ref, btrim(p_recipient_address), p_subject, p_body,
    p_attachment_name, COALESCE(p_doc_type,'custom'), p_doc_id,
    'pending', p_idempotency_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING notification_logs.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, false;
  ELSE
    -- Conflict: surface the EXISTING row instead of double-sending.
    SELECT nl.id INTO v_id
    FROM notification_logs nl
    WHERE nl.idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT v_id, true;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION enqueue_notification(uuid,text,text,text,uuid,text,text,text,text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enqueue_notification(uuid,text,text,text,uuid,text,text,text,text,uuid,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION enqueue_notification(uuid,text,text,text,uuid,text,text,text,text,uuid,text,text) TO authenticated;

-- ----------------------------------------------------------------------------
-- C. retry / cancel
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION retry_notification(p_log_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT business_id INTO v FROM notification_logs WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;
  IF NOT can_write_business(v) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notification_logs nl
                 WHERE nl.id = p_log_id AND nl.status = 'failed') THEN
    RAISE EXCEPTION 'Only failed notifications can be retried';
  END IF;

  UPDATE notification_logs
  SET status = 'pending', error_message = NULL, retry_count = retry_count + 1
  WHERE id = p_log_id;

  RETURN p_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_notification(p_log_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT business_id INTO v FROM notification_logs WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification not found';
  END IF;
  IF NOT can_write_business(v) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notification_logs nl
                 WHERE nl.id = p_log_id AND nl.status IN ('pending','failed')) THEN
    RAISE EXCEPTION 'Only pending or failed notifications can be cancelled';
  END IF;

  UPDATE notification_logs SET status = 'cancelled' WHERE id = p_log_id;

  RETURN p_log_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- D. communication settings (presence flags ONLY - no secrets anywhere)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_communication_settings(
  p_business_id uuid
)
RETURNS TABLE (
  email_provider text,
  email_from_address text,
  email_configured boolean,
  whatsapp_provider text,
  whatsapp_phone_number_id text,
  whatsapp_configured boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row communication_settings;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  SELECT * INTO v_row FROM communication_settings cs
  WHERE cs.business_id = p_business_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::text, false, 'meta_cloud', NULL::text, false;
  ELSE
    RETURN QUERY SELECT v_row.email_provider, v_row.email_from_address,
      v_row.email_configured, v_row.whatsapp_provider,
      v_row.whatsapp_phone_number_id, v_row.whatsapp_configured;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_communication_settings(
  p_business_id uuid,
  p_email_provider text DEFAULT NULL,
  p_email_from_address text DEFAULT NULL,
  p_email_configured boolean DEFAULT false,
  p_whatsapp_provider text DEFAULT 'meta_cloud',
  p_whatsapp_phone_number_id text DEFAULT NULL,
  p_whatsapp_configured boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can change communication settings';
  END IF;

  INSERT INTO communication_settings (
    business_id, email_provider, email_from_address, email_configured,
    whatsapp_provider, whatsapp_phone_number_id, whatsapp_configured, updated_at
  ) VALUES (
    p_business_id, p_email_provider, p_email_from_address, p_email_configured,
    COALESCE(p_whatsapp_provider,'meta_cloud'), p_whatsapp_phone_number_id,
    p_whatsapp_configured, now()
  )
  ON CONFLICT (business_id) DO UPDATE SET
    email_provider = EXCLUDED.email_provider,
    email_from_address = EXCLUDED.email_from_address,
    email_configured = EXCLUDED.email_configured,
    whatsapp_provider = EXCLUDED.whatsapp_provider,
    whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id,
    whatsapp_configured = EXCLUDED.whatsapp_configured,
    updated_at = now();

  RETURN p_business_id;
END;
$$;

-- House revokes/grants for the remaining definer RPCs.
REVOKE EXECUTE ON FUNCTION retry_notification(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION retry_notification(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION retry_notification(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION cancel_notification(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_notification(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_notification(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_communication_settings(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_communication_settings(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_communication_settings(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION upsert_communication_settings(uuid,text,text,boolean,text,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION upsert_communication_settings(uuid,text,text,boolean,text,text,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION upsert_communication_settings(uuid,text,text,boolean,text,text,boolean) TO authenticated;

-- ============================================================================
-- # 052 â€” GSTR-1 supplementary surfaces: CDN + nil/exempt + HSN summary
--         (GST BACKEND W1, T99) [oscar]
--
-- Companion views to 041 (outward/inward). Same house rules:
--   * DOCUMENT TRUTH ONLY â€” built from existing columns, zero writes.
--   * security_invoker = on  -> caller's RLS governs every read.
--   * Status families mirror 017/022 machines:
--       OUTWARD live : issued | partially_paid | paid
--       INWARD  live : confirmed | partially_paid | paid
--       NOTES   live : issued | applied      (draft never reported;
--                                             cancelled excluded;
--                                             applied = refunds flowed)
--
-- ## A. v_gstr1_cdn â€” credit/debit notes touching OUTPUT tax (CDNR family)
-- Doc-level granularity BY DESIGN: note items (022) carry a single blended
-- tax_amount with NO tax_rate column, so per-rate splitting would be
-- fabrication. Header tax columns are authoritative. `effect` tells the
-- consumer how the note moves output liability without magic signs:
--   credit_note -> decreases_output ; debit_note -> increases_output.
-- Parent linkage gives GSTR-1 CDNR its required original-doc reference.
--
-- ## B. v_gstr1_nil â€” nil-rated / exempt OUTWARD supplies (Table 8 shape)
-- A live invoice is classified nil/exempt iff the SUM of ALL item tax
-- amounts equals zero (whole-document test; mixed taxed+untaxed docs are
-- NOT nil â€” they stay in the normal tables). Simplification documented:
-- we cannot distinguish "nil-rated" from "exempt" from columns alone,
-- both share this bucket, exposed as classification 'nil_or_exempt'.
--
-- ## C. v_gstr1_hsn â€” HSN summary of OUTWARD supplies (Table 12 shape)
-- Per (hsn_sac, unit, tax_rate): item-level values preferred, product-
-- level fallback via LEFT JOIN products (017 saves item copies; older/
-- manual rows may rely on the product master). Units are free-text
-- (default 'PCS') â€” mapping free text -> official UQC codes is a FE/
-- presentation concern, deliberately out of DB scope.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. v_gstr1_cdn â€” issued-family credit & debit notes (doc granularity)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_cdn;
CREATE VIEW public.v_gstr1_cdn
WITH (security_invoker = on)
AS
SELECT
  cn.business_id,
  cn.id                        AS doc_id,
  'credit_note'::text          AS note_type,
  'decreases_output'::text     AS effect,
  cn.credit_note_number        AS doc_number,
  cn.date                      AS doc_date,
  cn.sales_invoice_id          AS parent_doc_id,
  si.invoice_number            AS parent_doc_number,
  c.name                       AS party_name,
  NULLIF(btrim(c.gstin), '')   AS party_gstin,
  CASE WHEN NULLIF(btrim(c.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  cn.reason,
  cn.taxable_amount            AS taxable_value,
  cn.cgst_amount               AS cgst,
  cn.sgst_amount               AS sgst,
  cn.igst_amount               AS igst,
  cn.cess_amount               AS cess,
  (cn.cgst_amount + cn.sgst_amount + cn.igst_amount + cn.cess_amount) AS total_tax
FROM credit_notes cn
JOIN customers c      ON c.id  = cn.customer_id
JOIN sales_invoices si ON si.id = cn.sales_invoice_id
WHERE cn.status IN ('issued', 'applied')

UNION ALL

SELECT
  dn.business_id,
  dn.id,
  'debit_note'::text,
  'increases_output'::text,
  dn.debit_note_number,
  dn.date,
  dn.purchase_bill_id,
  pb.bill_number,
  sup.name,
  NULLIF(btrim(sup.gstin), ''),
  CASE WHEN NULLIF(btrim(sup.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END,
  dn.reason,
  dn.taxable_amount,
  dn.cgst_amount,
  dn.sgst_amount,
  dn.igst_amount,
  dn.cess_amount,
  (dn.cgst_amount + dn.sgst_amount + dn.igst_amount + dn.cess_amount)
FROM debit_notes dn
JOIN suppliers sup     ON sup.id = dn.supplier_id
JOIN purchase_bills pb ON pb.id  = dn.purchase_bill_id
WHERE dn.status IN ('issued', 'applied');

-- ----------------------------------------------------------------------------
-- B. v_gstr1_nil â€” whole-document zero-tax live invoices
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_nil;
CREATE VIEW public.v_gstr1_nil
WITH (security_invoker = on)
AS
SELECT
  si.business_id,
  si.id                        AS invoice_id,
  si.invoice_number            AS doc_number,
  si.invoice_date              AS doc_date,
  c.name                       AS party_name,
  NULLIF(btrim(c.gstin), '')   AS party_gstin,
  CASE WHEN NULLIF(btrim(c.gstin), '') IS NOT NULL THEN 'B2B' ELSE 'B2C' END AS section,
  si.place_of_supply,
  'nil_or_exempt'::text        AS classification,
  COUNT(sii.id)                AS item_count,
  COALESCE(SUM(sii.quantity), 0) AS quantity,
  COALESCE(SUM(sii.taxable_amount), 0) AS taxable_value
FROM sales_invoices si
JOIN customers c             ON c.id   = si.customer_id
JOIN sales_invoice_items sii ON sii.invoice_id = si.id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
GROUP BY si.business_id, si.id, si.invoice_number, si.invoice_date,
         c.name, c.gstin, si.place_of_supply
HAVING COALESCE(SUM(sii.cgst_amount + sii.sgst_amount + sii.igst_amount + sii.cess_amount), 0) = 0;

-- ----------------------------------------------------------------------------
-- C. v_gstr1_hsn â€” outward HSN summary (per hsn/unit/rate)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_gstr1_hsn;
CREATE VIEW public.v_gstr1_hsn
WITH (security_invoker = on)
AS
SELECT
  si.business_id,
  COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED') AS hsn_sac,
  COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS')                AS unit,
  sii.tax_rate,
  MAX(COALESCE(NULLIF(btrim(sii.product_name), ''), p.name))                             AS description,
  COUNT(sii.id)                                                                          AS item_count,
  SUM(sii.quantity)                                                                      AS quantity,
  SUM(sii.taxable_amount)                                                                AS taxable_value,
  SUM(sii.cgst_amount)                                                                   AS cgst,
  SUM(sii.sgst_amount)                                                                   AS sgst,
  SUM(sii.igst_amount)                                                                   AS igst,
  SUM(sii.cess_amount)                                                                   AS cess
FROM sales_invoice_items sii
JOIN sales_invoices si ON si.id = sii.invoice_id
LEFT JOIN products p    ON p.id  = sii.product_id
WHERE si.status IN ('issued', 'partially_paid', 'paid')
GROUP BY si.business_id,
         COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED'),
         COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS'),
         sii.tax_rate;

-- House style: reporting surfaces are authenticated-only.
REVOKE ALL ON public.v_gstr1_cdn FROM PUBLIC, anon;
REVOKE ALL ON public.v_gstr1_nil FROM PUBLIC, anon;
REVOKE ALL ON public.v_gstr1_hsn FROM PUBLIC, anon;

-- ============================================================================
-- # 053 â€” get_gstr1_sections: one-call GSTR-1 section builder
--         (GST BACKEND W1, T99) [oscar]
--
-- Assembles the filing-table sections from the security_invoker views:
--   b2b  / b2c : v_gstr1_outward split by GSTIN presence (041 rule)
--   cdnr       : v_gstr1_cdn   (issued-family CN/DN, doc granularity)
--   nil        : v_gstr1_nil   (whole-doc zero-tax outward)
--   hsn        : v_gstr1_hsn   (outward HSN summary per hsn/unit/rate)
--
-- SHAPE (jsonb, single row):
-- {
--   basis: "document-truth",
--   period: {from, to},
--   b2b:  {rows:[<outward rows>], totals:{doc_count,taxable_value,cgst,sgst,igst,cess}},
--   b2c:  {rows:[...], totals:{...}},
--   cdnr: {rows:[<cdn rows>], totals:{doc_count,credit_notes,debit_notes,
--                                     taxable_value,cgst,sgst,igst,cess}},
--   nil:  {rows:[<nil rows>], totals:{doc_count,taxable_value}},
--   hsn:  {rows:[<hsn rows>], totals:{taxable_value,cgst,sgst,igst,cess}}
-- }
--
-- Rows are raw to_jsonb() of the underlying view rows (no rounding â€” the
-- FE report layer owns presentation rounding, mirroring reportsAdapter).
-- Reads ONLY invoker views => caller RLS governs; no definer needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gstr1_sections(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_rows AS (
  SELECT * FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
cdn_rows AS (
  SELECT * FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
nil_rows AS (
  SELECT * FROM v_gstr1_nil n
  WHERE n.business_id = p_business_id
    AND n.doc_date BETWEEN p_from AND p_to
),
-- HSN cannot be date-filtered through the summary view (no doc_date on
-- grouped rows), so the section fn re-derives it date-scoped with the
-- exact same grouping expression as 052's v_gstr1_hsn.
hsn_live AS (
  SELECT
    si.business_id,
    COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED') AS hsn_sac,
    COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS')                AS unit,
    sii.tax_rate,
    MAX(COALESCE(NULLIF(btrim(sii.product_name), ''), p.name))                             AS description,
    COUNT(sii.id)                                                                          AS item_count,
    SUM(sii.quantity)                                                                      AS quantity,
    SUM(sii.taxable_amount)                                                                AS taxable_value,
    SUM(sii.cgst_amount)                                                                   AS cgst,
    SUM(sii.sgst_amount)                                                                   AS sgst,
    SUM(sii.igst_amount)                                                                   AS igst,
    SUM(sii.cess_amount)                                                                   AS cess
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON si.id = sii.invoice_id
  LEFT JOIN products p     ON p.id  = sii.product_id
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND si.invoice_date BETWEEN p_from AND p_to
  GROUP BY si.business_id,
           COALESCE(NULLIF(btrim(sii.hsn_sac), ''), NULLIF(btrim(p.hsn_sac), ''), 'UNCLASSIFIED'),
           COALESCE(NULLIF(btrim(sii.unit), ''), NULLIF(btrim(p.unit), ''), 'PCS'),
           sii.tax_rate
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),

  'b2b', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM out_rows r WHERE r.section = 'B2B'), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.invoice_id),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM out_rows r WHERE r.section = 'B2B')),

  'b2c', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM out_rows r WHERE r.section = 'B2C'), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.invoice_id),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM out_rows r WHERE r.section = 'B2C')),

  'cdnr', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM cdnr_rows r), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.doc_id),
                 'credit_notes', COUNT(*) FILTER (WHERE r.note_type = 'credit_note'),
                 'debit_notes', COUNT(*) FILTER (WHERE r.note_type = 'debit_note'),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM cdnr_rows r)),

  'nil', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_number)
                      FROM nil_rows r), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'doc_count', COUNT(DISTINCT r.invoice_id),
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0))
               FROM nil_rows r)),

  'hsn', jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.hsn_sac, r.unit, r.tax_rate)
                      FROM hsn_live r), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object(
                 'taxable_value', COALESCE(SUM(r.taxable_value), 0),
                 'cgst', COALESCE(SUM(r.cgst), 0),
                 'sgst', COALESCE(SUM(r.sgst), 0),
                 'igst', COALESCE(SUM(r.igst), 0),
                 'cess', COALESCE(SUM(r.cess), 0))
               FROM hsn_live r))
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr1_sections(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr1_sections(uuid, date, date) TO authenticated;

-- ============================================================================
-- # 054 â€” get_gstr3b_computed: document-truth GSTR-3B computation
--         (GST BACKEND W1, T99) [oscar]
--
-- Single-call computed 3B over the security_invoker views (041 + 052).
-- READ-ONLY engine; NEVER mutates. RLS applies via invoker views.
--
-- BASIS = DOCUMENT TRUTH: figures derive from live documents in the
-- period (outward invoices / inward bills / issued-family CN+DN), NOT
-- from posted journal lines. It can diverge from get_gst_summary()
-- JOURNAL truth around CN/DN/settlement timing â€” consumers must label
-- which basis they display (the response carries basis explicitly).
--
-- SHAPE (jsonb):
-- {
--   basis, period:{from,to},
--   outward_3_1a: {taxable_value,cgst,sgst,igst,cess,doc_count},
--   zero_rated:   {taxable_value,cgst,sgst,igst,cess,doc_count,note},
--       -- honest placeholder: no export/zero-rated flag exists until the
--       -- additive schema lands (T101/057 is_export); zeros until then.
--   nil_other_outward: {taxable_value,doc_count,classification},
--   cdnr_adjustment:  {credit_notes,debit_notes,taxable_credits,taxable_additions,
--                      cgst,sgst,igst,cess(net effect signed: DN minus CN)},
--   adjusted_output:  {taxable_value,cgst,sgst,igst,cess},  -- after CDN
--   inward_itc_4a:    {taxable_value,cgst,sgst,igst,cess,bill_count},
--   net_position:     {cgst,sgst,igst,cess,total_net_payable,
--                      is_credit_carried_forward},
--       -- payable = adjusted_output - ITC per component; NEGATIVE total
--       -- means CREDIT CARRY-FORWARD (not a refund claim).
--   traceability: {invoice_docs,bill_docs,credit_note_docs,debit_note_docs,
--                  nil_docs,gstr1_sections_fn}
-- }
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gstr3b_computed(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id)                        AS doc_count,
    COALESCE(SUM(o.taxable_value), 0)                   AS taxable_value,
    COALESCE(SUM(o.cgst), 0)                            AS cgst,
    COALESCE(SUM(o.sgst), 0)                            AS sgst,
    COALESCE(SUM(o.igst), 0)                            AS igst,
    COALESCE(SUM(o.cess), 0)                            AS cess
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
in_agg AS (
  SELECT
    COUNT(DISTINCT i.bill_id)                           AS bill_count,
    COALESCE(SUM(i.taxable_value), 0)                   AS taxable_value,
    COALESCE(SUM(i.cgst), 0)                            AS cgst,
    COALESCE(SUM(i.sgst), 0)                            AS sgst,
    COALESCE(SUM(i.igst), 0)                            AS igst,
    COALESCE(SUM(i.cess), 0)                            AS cess
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to
),
cdn_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE d.note_type = 'credit_note') AS credit_notes,
    COUNT(*) FILTER (WHERE d.note_type = 'debit_note')  AS debit_notes,
    COALESCE(SUM(d.taxable_value) FILTER (WHERE d.effect = 'decreases_output'), 0) AS taxable_credits,
    COALESCE(SUM(d.taxable_value) FILTER (WHERE d.effect = 'increases_output'), 0) AS taxable_additions,
    COALESCE(SUM(d.cgst), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_cgst,
    COALESCE(SUM(d.sgst), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_sgst,
    COALESCE(SUM(d.igst), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_igst,
    COALESCE(SUM(d.cess), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_cess,
    COALESCE(SUM(d.cgst), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_cgst,
    COALESCE(SUM(d.sgst), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_sgst,
    COALESCE(SUM(d.igst), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_igst,
    COALESCE(SUM(d.cess), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_cess
  FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
nil_agg AS (
  SELECT
    COUNT(DISTINCT n.invoice_id)                        AS doc_count,
    COALESCE(SUM(n.taxable_value), 0)                   AS taxable_value
  FROM v_gstr1_nil n
  WHERE n.business_id = p_business_id
    AND n.doc_date BETWEEN p_from AND p_to
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),

  'outward_3_1a', jsonb_build_object(
    'taxable_value', o.taxable_value,
    'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst, 'cess', o.cess,
    'doc_count', o.doc_count),

  'zero_rated', jsonb_build_object(
    'taxable_value', 0, 'cgst', 0, 'sgst', 0, 'igst', 0, 'cess', 0,
    'doc_count', 0,
    'note', 'Zero-rated/export classification requires the additive export flags (T101 migration 057); reported honestly as empty until then.'),

  'nil_other_outward', jsonb_build_object(
    'taxable_value', n.taxable_value,
    'doc_count', n.doc_count,
    'classification', 'nil_or_exempt'),

  'cdnr_adjustment', jsonb_build_object(
    'credit_notes', c.credit_notes,
    'debit_notes', c.debit_notes,
    'taxable_credits', c.taxable_credits,
    'taxable_additions', c.taxable_additions,
    'taxable_net_effect', c.taxable_additions - c.taxable_credits,
    'cgst', c.dn_cgst - c.cn_cgst,
    'sgst', c.dn_sgst - c.cn_sgst,
    'igst', c.dn_igst - c.cn_igst,
    'cess', c.dn_cess - c.cn_cess),

  'adjusted_output', jsonb_build_object(
    'taxable_value', o.taxable_value + (c.taxable_additions - c.taxable_credits),
    'cgst', o.cgst + (c.dn_cgst - c.cn_cgst),
    'sgst', o.sgst + (c.dn_sgst - c.cn_sgst),
    'igst', o.igst + (c.dn_igst - c.cn_igst),
    'cess', o.cess + (c.dn_cess - c.cn_cess)),

  'inward_itc_4a', jsonb_build_object(
    'taxable_value', i.taxable_value,
    'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst, 'cess', i.cess,
    'bill_count', i.bill_count),

  'net_position', jsonb_build_object(
    'cgst', (o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst,
    'sgst', (o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst,
    'igst', (o.igst + (c.dn_igst - c.cn_igst)) - i.igst,
    'cess', (o.cess + (c.dn_cess - c.cn_cess)) - i.cess,
    'total_net_payable',
      ((o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst)
    + ((o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst)
    + ((o.igst + (c.dn_igst - c.cn_igst)) - i.igst)
    + ((o.cess + (c.dn_cess - c.cn_cess)) - i.cess),
    'is_credit_carried_forward',
      ((((o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst)
      + ((o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst)
      + ((o.igst + (c.dn_igst - c.cn_igst)) - i.igst)
      + ((o.cess + (c.dn_cess - c.cn_cess)) - i.cess)) < 0)),

  'traceability', jsonb_build_object(
    'invoice_docs', o.doc_count,
    'bill_docs', i.bill_count,
    'credit_note_docs', c.credit_notes,
    'debit_note_docs', c.debit_notes,
    'nil_docs', n.doc_count,
    'gstr1_sections_fn', 'get_gstr1_sections')
)
FROM out_agg o, in_agg i, cdn_agg c, nil_agg n;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) TO authenticated;

-- ============================================================================
-- # 055 â€” get_gst_validation_issues: GST data-quality engine
--         (GST BACKEND W2, T100) [oscar]
--
-- READ-ONLY validator over live documents in [from, to]. NEVER mutates.
-- One row per finding: severity critical|warning|info + doc coordinates +
-- machine-readable code + human problem text + suggested_fix.
--
-- CHECKS (codes):
--   critical  GSTIN_FORMAT        party gstin present but fails structural regex
--   warning   PARTY_GSTIN_MISSING taxable doc charged to party without gstin
--                             (forces B2C / buyer loses ITC)
--   warning   POS_MISSING         live invoice without place_of_supply
--   warning   HSN_MISSING         items with neither item- nor product-level hsn_sac
--   critical  TAX_MODE_CONFLICT   intra-state doc carrying IGST, or inter-state
--                             doc carrying CGST/SGST (businesses.state vs
--                             place_of_supply, case-insensitive trim match;
--                             unknown either side => warning STATE_UNKNOWN)
--   critical  TAXABLE_MISMATCH    header taxable_amount vs SUM(items) beyond 0.01
--   critical  GRAND_TOTAL_IDENTITY grand_total <> taxable + (cgst+sgst+igst)
--                             + cess + round_off beyond 0.01 (013b identity)
--   warning   DOC_NUMBER_DUP_CI   case-insensitive duplicate number among live docs
--                             (exact dupes impossible: UNIQUE constraints)
--   info      EXCLUDED_FROM_REPORT draft/cancelled/void docs inside the period,
--                             listed so the FE can show what was left out
--
-- NOTES: state names are free text; equality is btrim(lower()). Tolerance
-- 0.01 absorbs display rounding only. Language SQL STABLE, invoker-RLS
-- applies to every underlying read.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gst_validation_issues(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  severity text,
  doc_type text,
  doc_id uuid,
  doc_number text,
  doc_date date,
  party text,
  problem text,
  code text,
  suggested_fix text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH li AS (
  SELECT
    si.id, si.business_id, si.customer_id, si.invoice_number, si.invoice_date,

    c.name AS party_name, NULLIF(btrim(c.gstin), '') AS party_gstin,
    si.place_of_supply, si.status, si.subtotal,
    si.taxable_amount, si.cgst_amount, si.sgst_amount, si.igst_amount,
    si.cess_amount, si.round_off, si.grand_total,
    COALESCE((SELECT SUM(sii.taxable_amount) FROM sales_invoice_items sii
              WHERE sii.invoice_id = si.id), 0) AS items_taxable,
    COALESCE((SELECT COUNT(*) FROM sales_invoice_items sii
              WHERE sii.invoice_id = si.id
                AND NULLIF(btrim(sii.hsn_sac), '') IS NULL
                AND NOT EXISTS (SELECT 1 FROM products pp WHERE pp.id = sii.product_id
                                 AND NULLIF(btrim(pp.hsn_sac), '') IS NOT NULL)), 0) AS items_no_hsn
  FROM sales_invoices si
  JOIN customers c ON c.id = si.customer_id
  WHERE si.business_id = p_business_id
    AND si.invoice_date BETWEEN p_from AND p_to
),
lb AS (
  SELECT
    pb.id, pb.business_id, pb.supplier_id, pb.bill_number, pb.bill_date,
    sup.name AS party_name, NULLIF(btrim(sup.gstin), '') AS party_gstin,
    pb.status, pb.subtotal,
    pb.taxable_amount, pb.cgst_amount, pb.sgst_amount, pb.igst_amount,
    pb.cess_amount, pb.round_off, pb.grand_total,
    COALESCE((SELECT SUM(pbi.taxable_amount) FROM purchase_bill_items pbi
              WHERE pbi.bill_id = pb.id), 0) AS items_taxable,
    COALESCE((SELECT COUNT(*) FROM purchase_bill_items pbi
              WHERE pbi.bill_id = pb.id
                AND NULLIF(btrim(pbi.hsn_sac), '') IS NULL
                AND NOT EXISTS (SELECT 1 FROM products pp WHERE pp.id = pbi.product_id
                                 AND NULLIF(btrim(pp.hsn_sac), '') IS NOT NULL)), 0) AS items_no_hsn
  FROM purchase_bills pb
  JOIN suppliers sup ON sup.id = pb.supplier_id
  WHERE pb.business_id = p_business_id
    AND pb.bill_date BETWEEN p_from AND p_to
),
live_li AS (
  SELECT * FROM li WHERE status IN ('issued', 'partially_paid', 'paid')
),
live_lb AS (
  SELECT * FROM lb WHERE status IN ('confirmed', 'partially_paid', 'paid')
),
biz AS (
  SELECT b.state FROM businesses b WHERE b.id = p_business_id
)
-- 1. GSTIN structural format (both directions, live docs only)
SELECT 'critical', 'customer', c.id, c.name, NULL::date,
       c.name,
       'Customer GSTIN ' || c.gstin || ' fails the structural GSTIN format.',
       'GSTIN_FORMAT',
       'Correct the GSTIN on the customer record before filing.'
FROM customers c
WHERE c.business_id = p_business_id
  AND NULLIF(btrim(c.gstin), '') IS NOT NULL
  AND c.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  AND EXISTS (SELECT 1 FROM live_li WHERE customer_id = c.id)

UNION ALL

SELECT 'critical', 'supplier', sup.id, sup.name, NULL::date,
       sup.name,
       'Supplier GSTIN ' || sup.gstin || ' fails the structural GSTIN format.',
       'GSTIN_FORMAT',
       'Correct the GSTIN on the supplier record before claiming ITC.'
FROM suppliers sup
WHERE sup.business_id = p_business_id
  AND NULLIF(btrim(sup.gstin), '') IS NOT NULL
  AND sup.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  AND EXISTS (SELECT 1 FROM live_lb WHERE supplier_id = sup.id)

UNION ALL

-- 2. Taxed doc billed to party without GSTIN (warning, both directions)
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'GST was charged but the customer has no GSTIN; the doc files under B2C.',
       'PARTY_GSTIN_MISSING',
       'Capture the customer GSTIN if they are registered.'
FROM live_li x
WHERE (x.cgst_amount + x.sgst_amount + x.igst_amount + x.cess_amount) > 0
  AND x.party_gstin IS NULL

UNION ALL

SELECT 'warning', 'purchase_bill', y.id, y.bill_number, y.bill_date,
       y.party_name,
       'Input GST was charged but the supplier has no GSTIN; ITC documentation is weak.',
       'PARTY_GSTIN_MISSING',
       'Capture the supplier GSTIN to support the ITC claim.'
FROM live_lb y
WHERE (y.cgst_amount + y.sgst_amount + y.igst_amount + y.cess_amount) > 0
  AND y.party_gstin IS NULL

UNION ALL

-- 3. Missing place_of_supply on live invoices
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'place_of_supply is blank; intra/inter-state tax mode cannot be verified.',
       'POS_MISSING',
       'Set place_of_supply on the invoice.'
FROM live_li x
WHERE NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NULL

UNION ALL

-- 4. Items without resolvable HSN/SAC (live invoices)
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       x.items_no_hsn || ' item(s) have no HSN/SAC (item-level and product-level both blank).',
       'HSN_MISSING',
       'Add hsn_sac to the items or their products.'
FROM live_li x
WHERE x.items_no_hsn > 0

UNION ALL

-- 5a. Intra-state expectation violated (pos == business state, IGST present)
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Intra-state supply (place_of_supply matches business state "' || bz.state || '") but IGST ' || x.igst_amount || ' was charged.',
       'TAX_MODE_CONFLICT',
       'Charge CGST+SGST instead of IGST, or correct place_of_supply.'
FROM live_li x, biz bz
WHERE NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(bz.state, '')), '') IS NOT NULL
  AND lower(btrim(x.place_of_supply)) = lower(btrim(bz.state))
  AND x.igst_amount > 0

UNION ALL

-- 5b. Inter-state expectation violated (pos != business state, CGST/SGST present)
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Inter-state supply (place_of_supply "' || x.place_of_supply || '" differs from business state "' || bz.state || '") but CGST/SGST were charged.',
       'TAX_MODE_CONFLICT',
       'Charge IGST instead of CGST+SGST, or correct place_of_supply.'
FROM live_li x, biz bz
WHERE NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(bz.state, '')), '') IS NOT NULL
  AND lower(btrim(x.place_of_supply)) <> lower(btrim(bz.state))
  AND (x.cgst_amount + x.sgst_amount) > 0

UNION ALL

-- 5c. Business state unknown while tax present and POS given
--     (blank-POS docs already carry POS_MISSING - no double reporting)
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Businesses.state is blank; tax mode could not be verified on a taxed document.',
       'STATE_UNKNOWN',
       'Set businesses.state so intra/inter-state checks can run.'
FROM live_li x, biz bz
WHERE (x.cgst_amount + x.sgst_amount + x.igst_amount) > 0
  AND NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(bz.state, '')), '') IS NULL

UNION ALL

-- 6. Header taxable vs items taxable mismatch (beyond penny tolerance)
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Header taxable ' || x.taxable_amount || ' <> items taxable ' || x.items_taxable || '.',
       'TAXABLE_MISMATCH',
       'Re-save the invoice so header totals recompute from items.'
FROM live_li x
WHERE abs(x.taxable_amount - x.items_taxable) > 0.01

UNION ALL

SELECT 'critical', 'purchase_bill', y.id, y.bill_number, y.bill_date,
       y.party_name,
       'Header taxable ' || y.taxable_amount || ' <> items taxable ' || y.items_taxable || '.',
       'TAXABLE_MISMATCH',
       'Re-save the bill so header totals recompute from items.'
FROM live_lb y
WHERE abs(y.taxable_amount - y.items_taxable) > 0.01

UNION ALL

-- 7. Grand-total identity (013b): taxable + taxes + cess + round_off
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'grand_total ' || x.grand_total || ' <> taxable + taxes + cess + round_off '
       || (x.taxable_amount + x.cgst_amount + x.sgst_amount + x.igst_amount + x.cess_amount + x.round_off) || '.',
       'GRAND_TOTAL_IDENTITY',
       'Re-save the invoice; the journal identity expects this sum.'
FROM live_li x
WHERE abs(x.grand_total - (x.taxable_amount + x.cgst_amount + x.sgst_amount
      + x.igst_amount + x.cess_amount + x.round_off)) > 0.01

UNION ALL

SELECT 'critical', 'purchase_bill', y.id, y.bill_number, y.bill_date,
       y.party_name,
       'grand_total ' || y.grand_total || ' <> taxable + taxes + cess + round_off '
       || (y.taxable_amount + y.cgst_amount + y.sgst_amount + y.igst_amount + y.cess_amount + y.round_off) || '.',
       'GRAND_TOTAL_IDENTITY',
       'Re-save the bill; the journal identity expects this sum.'
FROM live_lb y
WHERE abs(y.grand_total - (y.taxable_amount + y.cgst_amount + y.sgst_amount
      + y.igst_amount + y.cess_amount + y.round_off)) > 0.01

UNION ALL

-- 8. Case-insensitive duplicate numbers among live docs
SELECT 'warning', 'sales_invoice', a.id, a.invoice_number, a.invoice_date,
       a.party_name,
       'Invoice number collides case-insensitively with another live invoice.',
       'DOC_NUMBER_DUP_CI',
       'Renumber one of the documents; filing portals treat these as duplicates.'
FROM live_li a
JOIN live_li b2
  ON lower(btrim(a.invoice_number)) = lower(btrim(b2.invoice_number))
 AND a.id < b2.id

UNION ALL

SELECT 'warning', 'purchase_bill', a.id, a.bill_number, a.bill_date,
       a.party_name,
       'Bill number collides case-insensitively with another live bill.',
       'DOC_NUMBER_DUP_CI',
       'Renumber one of the documents; filing portals treat these as duplicates.'
FROM live_lb a
JOIN live_lb b2
  ON lower(btrim(a.bill_number)) = lower(btrim(b2.bill_number))
 AND a.id < b2.id

UNION ALL

-- 9. Info: non-reportable docs inside the period
SELECT 'info', 'sales_invoice', z.id, z.invoice_number, z.invoice_date,
       z.party_name,
       'Status "' || z.status || '" - excluded from GSTR surfaces for this period.',
       'EXCLUDED_FROM_REPORT',
       'Issue the draft or ignore if cancellation was intended.'
FROM li z
WHERE z.status NOT IN ('issued', 'partially_paid', 'paid')

UNION ALL

SELECT 'info', 'purchase_bill', z2.id, z2.bill_number, z2.bill_date,
       z2.party_name,
       'Status "' || z2.status || '" - excluded from GSTR surfaces for this period.',
       'EXCLUDED_FROM_REPORT',
       'Confirm the bill or ignore if cancellation was intended.'
FROM lb z2
WHERE z2.status NOT IN ('confirmed', 'partially_paid', 'paid');
$$;

REVOKE EXECUTE ON FUNCTION public.get_gst_validation_issues(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_validation_issues(uuid, date, date) TO authenticated;

-- ============================================================================
-- # 056 â€” get_gst_reconciliation: document-truth vs posted-journal engine
--         (GST BACKEND W2, T100) [oscar]
--
-- READ-ONLY. NEVER mutates. Per live document in [from, to]:
--   doc_tax   = header tax columns (document truth)
--   je_tax    = SUM(credit - debit) over posted journal lines whose account
--               sits in the matching GST group:
--                 sales_invoice -> 'GST Payable'   (output, credit-positive)
--                 purchase_bill -> 'GST Receivable' (input, debit-positive)
--               JEs located via journal_entries.reference_type/reference_id
--               (007 linkage), status='posted'.
--
-- match_status per doc:
--   matched       |je_tax - doc_tax| <= 0.01 and exactly one JE
--   difference    beyond tolerance
--   unjournaled   no posted JE references the doc
--   multi_posted  >1 posted primary JEs reference the doc (double-count risk;
--                 reversal JEs use *_reversal types and are NOT counted)
--
-- Component split uses canonical ledger names ('Output CGST' etc., 011/013a).
-- Cess ledger naming drifted historically (m011 vs 022 homing), so anything
-- not matching a canonical component lands in unmapped_residual instead of
-- being silently dropped â€” total always reconciles to the full group sum.
--
-- CN/DN coverage is reported AGGREGATE only: their JEs reference the note,
-- cancellations create mirror JEs, and per-doc diffing there is deferred â€”
-- documented boundary, not an omission.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gst_reconciliation(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_docs AS (
  SELECT
    si.id AS doc_id, si.invoice_number AS doc_number, si.invoice_date AS doc_date,
    c.name AS party_name, si.cgst_amount, si.sgst_amount, si.igst_amount, si.cess_amount,
    (si.cgst_amount + si.sgst_amount + si.igst_amount + si.cess_amount) AS doc_tax_total
  FROM sales_invoices si
  JOIN customers c ON c.id = si.customer_id
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND si.invoice_date BETWEEN p_from AND p_to
),
in_docs AS (
  SELECT
    pb.id AS doc_id, pb.bill_number AS doc_number, pb.bill_date AS doc_date,
    sup.name AS party_name, pb.cgst_amount, pb.sgst_amount, pb.igst_amount, pb.cess_amount,
    (pb.cgst_amount + pb.sgst_amount + pb.igst_amount + pb.cess_amount) AS doc_tax_total
  FROM purchase_bills pb
  JOIN suppliers sup ON sup.id = pb.supplier_id
  WHERE pb.business_id = p_business_id
    AND pb.status IN ('confirmed', 'partially_paid', 'paid')
    AND pb.bill_date BETWEEN p_from AND p_to
),
out_je AS (
  SELECT
    je.reference_id AS doc_id,
    COUNT(DISTINCT je.id) AS je_count,
    COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) AS je_tax_total,
    COALESCE(SUM(CASE WHEN a.name = 'Output CGST' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS je_cgst,
    COALESCE(SUM(CASE WHEN a.name = 'Output SGST' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS je_sgst,
    COALESCE(SUM(CASE WHEN a.name = 'Output IGST' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS je_igst,
    COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0)
      - COALESCE(SUM(CASE WHEN a.name IN ('Output CGST','Output SGST','Output IGST')
                          THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS unmapped_residual
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.business_id = je.business_id
  JOIN accounts a ON a.id = jel.account_id AND a.group_name = 'GST Payable'
  WHERE je.business_id = p_business_id
    AND je.status = 'posted'
    AND je.reference_type = 'sales_invoice'
  GROUP BY je.reference_id
),
in_je AS (
  SELECT
    je.reference_id AS doc_id,
    COUNT(DISTINCT je.id) AS je_count,
    COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) AS je_tax_total,
    COALESCE(SUM(CASE WHEN a.name = 'Input CGST' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS je_cgst,
    COALESCE(SUM(CASE WHEN a.name = 'Input SGST' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS je_sgst,
    COALESCE(SUM(CASE WHEN a.name = 'Input IGST' THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS je_igst,
    COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)
      - COALESCE(SUM(CASE WHEN a.name IN ('Input CGST','Input SGST','Input IGST')
                          THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS unmapped_residual
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id AND jel.business_id = je.business_id
  JOIN accounts a ON a.id = jel.account_id AND a.group_name = 'GST Receivable'
  WHERE je.business_id = p_business_id
    AND je.status = 'posted'
    AND je.reference_type = 'purchase_bill'
  GROUP BY je.reference_id
),
doc_rows AS (
  SELECT
    'sales_invoice'::text AS doc_type, o.doc_id, o.doc_number, o.doc_date, o.party_name,
    'outward'::text AS direction,
    o.cgst_amount AS doc_cgst, o.sgst_amount AS doc_sgst, o.igst_amount AS doc_igst,
    o.cess_amount AS doc_cess, o.doc_tax_total,
    COALESCE(j.je_cgst, 0) AS je_cgst, COALESCE(j.je_sgst, 0) AS je_sgst,
    COALESCE(j.je_igst, 0) AS je_igst, COALESCE(j.unmapped_residual, 0) AS unmapped_residual,
    COALESCE(j.je_tax_total, 0) AS je_tax_total,
    COALESCE(j.je_count, 0) AS je_count,
    CASE
      WHEN COALESCE(j.je_count, 0) = 0 THEN 'unjournaled'
      WHEN j.je_count > 1 THEN 'multi_posted'
      WHEN abs(j.je_tax_total - o.doc_tax_total) <= 0.01 THEN 'matched'
      ELSE 'difference'
    END::text AS match_status
  FROM out_docs o LEFT JOIN out_je j ON j.doc_id = o.doc_id

  UNION ALL

  SELECT
    'purchase_bill', i2.doc_id, i2.doc_number, i2.doc_date, i2.party_name,
    'inward',
    i2.cgst_amount, i2.sgst_amount, i2.igst_amount, i2.cess_amount, i2.doc_tax_total,
    COALESCE(k.je_cgst, 0), COALESCE(k.je_sgst, 0),
    COALESCE(k.je_igst, 0), COALESCE(k.unmapped_residual, 0),
    COALESCE(k.je_tax_total, 0),
    COALESCE(k.je_count, 0),
    CASE
      WHEN COALESCE(k.je_count, 0) = 0 THEN 'unjournaled'
      WHEN k.je_count > 1 THEN 'multi_posted'
      WHEN abs(k.je_tax_total - i2.doc_tax_total) <= 0.01 THEN 'matched'
      ELSE 'difference'
    END
  FROM in_docs i2 LEFT JOIN in_je k ON k.doc_id = i2.doc_id
)
SELECT jsonb_build_object(
  'basis', 'journal-vs-document',
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'documents', (
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.doc_date, r.doc_type, r.doc_number), '[]'::jsonb)
    FROM doc_rows r
  ),
  'totals', jsonb_build_object(
    'docs_checked', (SELECT COUNT(*) FROM doc_rows),
    'matched', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'matched'),
    'with_difference', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'difference'),
    'unjournaled', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'unjournaled'),
    'multi_posted', (SELECT COUNT(*) FROM doc_rows r WHERE r.match_status = 'multi_posted'),
    'absolute_difference_sum', (SELECT COALESCE(SUM(abs(r.je_tax_total - r.doc_tax_total)), 0)
                                FROM doc_rows r WHERE r.match_status IN ('difference', 'multi_posted')),
    'unmapped_ledger_residual_sum', (SELECT COALESCE(SUM(r.unmapped_residual), 0) FROM doc_rows r)
  ),
  'notes_coverage', jsonb_build_object(
    'credit_notes_live', (SELECT COUNT(*) FROM credit_notes cn2
                          WHERE cn2.business_id = p_business_id
                            AND cn2.status IN ('issued', 'applied')
                            AND cn2.date BETWEEN p_from AND p_to),
    'credit_note_posted_jes', (SELECT COUNT(*) FROM journal_entries je2
                               WHERE je2.business_id = p_business_id
                                 AND je2.status = 'posted'
                                 AND je2.reference_type = 'credit_note'),
    'debit_notes_live', (SELECT COUNT(*) FROM debit_notes dn2
                         WHERE dn2.business_id = p_business_id
                           AND dn2.status IN ('issued', 'applied')
                           AND dn2.date BETWEEN p_from AND p_to),
    'debit_note_posted_jes', (SELECT COUNT(*) FROM journal_entries je3
                              WHERE je3.business_id = p_business_id
                                AND je3.status = 'posted'
                                AND je3.reference_type = 'debit_note')),
  'boundary_note', 'Per-doc diffing covers invoices and bills; CN/DN JEs are covered as aggregate counts (issue vs cancellation mirror JEs make per-doc diffs v2 scope). Reversal JEs (reference_type *_reversal) are excluded from per-doc totals by design.',
  'read_only', true
);
$$;

REVOKE EXECUTE ON FUNCTION public.get_gst_reconciliation(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_reconciliation(uuid, date, date) TO authenticated;

-- ============================================================================
-- # 057 â€” GST additive schema + Tally export/mapping backend
--         (GST/TALLY SHARED BACKEND, T101) [oscar]
--
-- A. ADDITIVE COLUMNS (no rewrites, defaults keep every existing row valid):
--   purchase_bills.place_of_supply text   -- bills were the only GSTR surface
--                                         -- missing POS (041 honest omission)
--   sales_invoices.is_reverse_charge bool DEFAULT false
--   sales_invoices.is_export bool DEFAULT false
--   purchase_bills.is_export bool DEFAULT false
--   businesses.state_code text            -- optional owner-maintained code
--
-- B. TALLY EXPORT HISTORY â€” audit of what left the building:
--   tally_export_history(business_id, created_by, created_at, date_from,
--     date_to, export_types text[], record/success/warning/error counts,
--     status, metadata jsonb). RLS: members read; writes ONLY through the
--     definer RPC (audit discipline - no direct INSERT/UPDATE/DELETE).
--
-- C. TALLY LEDGER MAPPINGS â€” per-business AccountX->Tally chart mapping.
--   UNIQUE(business_id, accountx_ledger). A NULL row for an account means
--   "canonical default" (identity name) at export time - absence is the
--   default, nothing is seeded. CRUD via definer RPCs (upsert/list);
--   direct delete allowed for cleanup.
--
-- All RPCs SECURITY DEFINER with explicit auth.uid() + membership/write
-- gates (house pattern 024/050), SET search_path = public.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Additive columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.purchase_bills ADD COLUMN IF NOT EXISTS place_of_supply text;
ALTER TABLE public.sales_invoices  ADD COLUMN IF NOT EXISTS is_reverse_charge boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales_invoices  ADD COLUMN IF NOT EXISTS is_export boolean NOT NULL DEFAULT false;
ALTER TABLE public.purchase_bills  ADD COLUMN IF NOT EXISTS is_export boolean NOT NULL DEFAULT false;
ALTER TABLE public.businesses      ADD COLUMN IF NOT EXISTS state_code text;

-- ----------------------------------------------------------------------------
-- B. Tally export history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tally_export_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  date_from date NOT NULL,
  date_to date NOT NULL,
  export_types text[] NOT NULL DEFAULT '{}',
  record_count bigint NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','partial','failed')),
  metadata jsonb
);

ALTER TABLE public.tally_export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tally_export_history_select" ON public.tally_export_history FOR SELECT
  TO authenticated USING (is_business_member(business_id));
-- writes flow through record_export only (definer bypasses RLS)

CREATE INDEX IF NOT EXISTS idx_tally_export_history_business_created
  ON public.tally_export_history(business_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- C. Tally ledger mappings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tally_ledger_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  accountx_ledger text NOT NULL,
  tally_ledger text NOT NULL,
  tally_parent text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, accountx_ledger)
);

ALTER TABLE public.tally_ledger_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tally_mappings_select" ON public.tally_ledger_mappings FOR SELECT
  TO authenticated USING (is_business_member(business_id));
CREATE POLICY "tally_mappings_insert" ON public.tally_ledger_mappings FOR INSERT
  TO authenticated WITH CHECK (can_write_business(business_id));
CREATE POLICY "tally_mappings_update" ON public.tally_ledger_mappings FOR UPDATE
  TO authenticated USING (can_write_business(business_id))
  WITH CHECK (can_write_business(business_id));
CREATE POLICY "tally_mappings_delete" ON public.tally_ledger_mappings FOR DELETE
  TO authenticated USING (can_write_business(business_id));

-- ----------------------------------------------------------------------------
-- D. RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_tally_export(
  p_business_id uuid,
  p_date_from date,
  p_date_to date,
  p_export_types text[],
  p_record_count bigint DEFAULT 0,
  p_success_count integer DEFAULT 0,
  p_warning_count integer DEFAULT 0,
  p_error_count integer DEFAULT 0,
  p_status text DEFAULT 'completed',
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF p_status NOT IN ('completed','partial','failed') THEN
    RAISE EXCEPTION 'Invalid export status %', p_status;
  END IF;
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from must not exceed date_to';
  END IF;

  INSERT INTO tally_export_history (
    business_id, created_by, date_from, date_to, export_types,
    record_count, success_count, warning_count, error_count, status, metadata
  ) VALUES (
    p_business_id, v_uid, p_date_from, p_date_to, COALESCE(p_export_types, '{}'),
    p_record_count, p_success_count, p_warning_count, p_error_count, p_status, p_metadata
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_tally_exports(
  p_business_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  created_by uuid,
  created_at timestamptz,
  date_from date,
  date_to date,
  export_types text[],
  record_count bigint,
  success_count integer,
  warning_count integer,
  error_count integer,
  status text,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.created_by, t.created_at, t.date_from, t.date_to,
         t.export_types, t.record_count, t.success_count, t.warning_count,
         t.error_count, t.status, t.metadata
  FROM tally_export_history t
  WHERE t.business_id = p_business_id
    AND auth.uid() IS NOT NULL
    AND is_business_member(p_business_id)
  ORDER BY t.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
$$;

CREATE OR REPLACE FUNCTION public.upsert_tally_ledger_mapping(
  p_business_id uuid,
  p_accountx_ledger text,
  p_tally_ledger text,
  p_tally_parent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_clean text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  v_clean := btrim(COALESCE(p_accountx_ledger, ''));
  IF v_clean IS NULL OR v_clean = '' THEN
    RAISE EXCEPTION 'accountx_ledger is required';
  END IF;
  IF btrim(COALESCE(p_tally_ledger, '')) IS NULL OR btrim(COALESCE(p_tally_ledger, '')) = '' THEN
    RAISE EXCEPTION 'tally_ledger is required';
  END IF;

  INSERT INTO tally_ledger_mappings (
    business_id, accountx_ledger, tally_ledger, tally_parent, created_by
  ) VALUES (
    p_business_id, v_clean, btrim(p_tally_ledger),
    NULLIF(btrim(COALESCE(p_tally_parent, '')), ''), v_uid
  )
  ON CONFLICT (business_id, accountx_ledger) DO UPDATE SET
    tally_ledger = EXCLUDED.tally_ledger,
    tally_parent = EXCLUDED.tally_parent,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_tally_ledger_mapping(
  p_business_id uuid,
  p_accountx_ledger text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  DELETE FROM tally_ledger_mappings
  WHERE business_id = p_business_id
    AND accountx_ledger = btrim(COALESCE(p_accountx_ledger, ''));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_tally_export(uuid, date, date, text[], bigint, integer, integer, integer, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_tally_exports(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_tally_ledger_mapping(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_tally_ledger_mapping(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_tally_export(uuid, date, date, text[], bigint, integer, integer, integer, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tally_exports(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tally_ledger_mapping(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tally_ledger_mapping(uuid, text) TO authenticated;

-- ============================================================================
-- # 058 â€” get_gst_dashboard: one-call GST compliance dashboard aggregate
--         + get_gstr3b_computed re-emit consuming is_export (T101) [oscar]
--
-- A. get_gst_dashboard(business_id, from, to) -> jsonb
--   Document-truth aggregates over the security_invoker views (041/052):
--     output / input / net per cgst/sgst/igst/cess (+ taxable)
--     b2b/b2c splits of outward supplies
--     credit_note / debit_note counts + tax magnitudes
--     zero_rated (is_export live invoices - real since 057 landed)
--     open_validation_issues = live counts from get_gst_validation_issues()
--
-- B. get_gstr3b_computed RE-EMITTED unchanged except its honest placeholder:
--   zero_rated now classifies via sales_invoices.is_export (added 057),
--   exactly as the 054 header promised. All other figures byte-identical.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gst_dashboard(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id) AS doc_count,
    COALESCE(SUM(o.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(o.cgst), 0) AS cgst,
    COALESCE(SUM(o.sgst), 0) AS sgst,
    COALESCE(SUM(o.igst), 0) AS igst,
    COALESCE(SUM(o.cess), 0) AS cess
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
in_agg AS (
  SELECT
    COUNT(DISTINCT i.bill_id) AS doc_count,
    COALESCE(SUM(i.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(i.cgst), 0) AS cgst,
    COALESCE(SUM(i.sgst), 0) AS sgst,
    COALESCE(SUM(i.igst), 0) AS igst,
    COALESCE(SUM(i.cess), 0) AS cess
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to
),
b2b_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id) AS doc_count,
    COALESCE(SUM(o.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(o.cgst + o.sgst + o.igst + o.cess), 0) AS total_tax
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
    AND o.section = 'B2B'
),
b2c_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id) AS doc_count,
    COALESCE(SUM(o.taxable_value), 0) AS taxable_value,
    COALESCE(SUM(o.cgst + o.sgst + o.igst + o.cess), 0) AS total_tax
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
    AND o.section = 'B2C'
),
cdn_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE d.note_type = 'credit_note') AS cn_count,
    COUNT(*) FILTER (WHERE d.note_type = 'debit_note') AS dn_count,
    COALESCE(SUM(d.taxable_value) FILTER (WHERE d.effect = 'decreases_output'), 0) AS cn_taxable,
    COALESCE(SUM(d.taxable_value) FILTER (WHERE d.effect = 'increases_output'), 0) AS dn_taxable,
    COALESCE(SUM(d.total_tax) FILTER (WHERE d.effect = 'decreases_output'), 0) AS cn_tax,
    COALESCE(SUM(d.total_tax) FILTER (WHERE d.effect = 'increases_output'), 0) AS dn_tax
  FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
export_agg AS (
  SELECT
    COUNT(*) AS doc_count,
    COALESCE(SUM(si.taxable_amount), 0) AS taxable_value
  FROM sales_invoices si
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND COALESCE(si.is_export, false)
    AND si.invoice_date BETWEEN p_from AND p_to
),
issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE v.severity = 'critical') AS critical,
    COUNT(*) FILTER (WHERE v.severity = 'warning') AS warning,
    COUNT(*) FILTER (WHERE v.severity = 'info') AS info,
    COUNT(*) AS total
  FROM get_gst_validation_issues(p_business_id, p_from, p_to) v
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'output', jsonb_build_object(
    'taxable_value', o.taxable_value,
    'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst, 'cess', o.cess,
    'total_tax', o.cgst + o.sgst + o.igst + o.cess,
    'doc_count', o.doc_count),
  'input', jsonb_build_object(
    'taxable_value', i.taxable_value,
    'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst, 'cess', i.cess,
    'total_tax', i.cgst + i.sgst + i.igst + i.cess,
    'doc_count', i.doc_count),
  'net', jsonb_build_object(
    'cgst', o.cgst - i.cgst,
    'sgst', o.sgst - i.sgst,
    'igst', o.igst - i.igst,
    'cess', o.cess - i.cess,
    'total', (o.cgst + o.sgst + o.igst + o.cess) - (i.cgst + i.sgst + i.igst + i.cess)),
  'b2b', jsonb_build_object(
    'doc_count', b.doc_count, 'taxable_value', b.taxable_value, 'total_tax', b.total_tax),
  'b2c', jsonb_build_object(
    'doc_count', c2.doc_count, 'taxable_value', c2.taxable_value, 'total_tax', c2.total_tax),
  'credit_notes', jsonb_build_object(
    'count', d.cn_count, 'taxable_value', d.cn_taxable, 'total_tax', d.cn_tax,
    'effect', 'decreases_output'),
  'debit_notes', jsonb_build_object(
    'count', d.dn_count, 'taxable_value', d.dn_taxable, 'total_tax', d.dn_tax,
    'effect', 'increases_output'),
  'zero_rated_exports', jsonb_build_object(
    'doc_count', x.doc_count, 'taxable_value', x.taxable_value),
  'open_validation_issues', jsonb_build_object(
    'critical', ic.critical, 'warning', ic.warning, 'info', ic.info, 'total', ic.total)
)
FROM out_agg o, in_agg i, b2b_agg b, b2c_agg c2, cdn_agg d, export_agg x, issue_counts ic;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gst_dashboard(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_dashboard(uuid, date, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- B. get_gstr3b_computed re-emit: zero_rated now REAL via is_export (057).
--    Body identical to 054 except the export classification block.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_gstr3b_computed(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH out_agg AS (
  SELECT
    COUNT(DISTINCT o.invoice_id)                        AS doc_count,
    COALESCE(SUM(o.taxable_value), 0)                   AS taxable_value,
    COALESCE(SUM(o.cgst), 0)                            AS cgst,
    COALESCE(SUM(o.sgst), 0)                            AS sgst,
    COALESCE(SUM(o.igst), 0)                            AS igst,
    COALESCE(SUM(o.cess), 0)                            AS cess
  FROM v_gstr1_outward o
  WHERE o.business_id = p_business_id
    AND o.doc_date BETWEEN p_from AND p_to
),
in_agg AS (
  SELECT
    COUNT(DISTINCT i.bill_id)                           AS bill_count,
    COALESCE(SUM(i.taxable_value), 0)                   AS taxable_value,
    COALESCE(SUM(i.cgst), 0)                            AS cgst,
    COALESCE(SUM(i.sgst), 0)                            AS sgst,
    COALESCE(SUM(i.igst), 0)                            AS igst,
    COALESCE(SUM(i.cess), 0)                            AS cess
  FROM v_gstr_inward i
  WHERE i.business_id = p_business_id
    AND i.doc_date BETWEEN p_from AND p_to
),
cdn_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE d.note_type = 'credit_note') AS credit_notes,
    COUNT(*) FILTER (WHERE d.note_type = 'debit_note')  AS debit_notes,
    COALESCE(SUM(d.taxable_value) FILTER (WHERE d.effect = 'decreases_output'), 0) AS taxable_credits,
    COALESCE(SUM(d.taxable_value) FILTER (WHERE d.effect = 'increases_output'), 0) AS taxable_additions,
    COALESCE(SUM(d.cgst), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_cgst,
    COALESCE(SUM(d.sgst), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_sgst,
    COALESCE(SUM(d.igst), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_igst,
    COALESCE(SUM(d.cess), 0) FILTER (WHERE d.effect = 'increases_output') AS dn_cess,
    COALESCE(SUM(d.cgst), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_cgst,
    COALESCE(SUM(d.sgst), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_sgst,
    COALESCE(SUM(d.igst), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_igst,
    COALESCE(SUM(d.cess), 0) FILTER (WHERE d.effect = 'decreases_output') AS cn_cess
  FROM v_gstr1_cdn d
  WHERE d.business_id = p_business_id
    AND d.doc_date BETWEEN p_from AND p_to
),
nil_agg AS (
  SELECT
    COUNT(DISTINCT n.invoice_id)                        AS doc_count,
    COALESCE(SUM(n.taxable_value), 0)                   AS taxable_value
  FROM v_gstr1_nil n
  WHERE n.business_id = p_business_id
    AND n.doc_date BETWEEN p_from AND p_to
),
export_agg AS (
  SELECT
    COUNT(*)                                            AS doc_count,
    COALESCE(SUM(si.taxable_amount), 0)                 AS taxable_value
  FROM sales_invoices si
  WHERE si.business_id = p_business_id
    AND si.status IN ('issued', 'partially_paid', 'paid')
    AND COALESCE(si.is_export, false)
    AND si.invoice_date BETWEEN p_from AND p_to
)
SELECT jsonb_build_object(
  'basis', 'document-truth',
  'period', jsonb_build_object('from', p_from, 'to', p_to),

  'outward_3_1a', jsonb_build_object(
    'taxable_value', o.taxable_value,
    'cgst', o.cgst, 'sgst', o.sgst, 'igst', o.igst, 'cess', o.cess,
    'doc_count', o.doc_count),

  'zero_rated', jsonb_build_object(
    'taxable_value', x.taxable_value,
    'cgst', 0, 'sgst', 0, 'igst', 0, 'cess', 0,
    'doc_count', x.doc_count,
    'note', 'Live invoices flagged is_export (057). Zero-rated supplies carry no GST by definition; tax columns are structurally zero.'),

  'nil_other_outward', jsonb_build_object(
    'taxable_value', n.taxable_value,
    'doc_count', n.doc_count,
    'classification', 'nil_or_exempt'),

  'cdnr_adjustment', jsonb_build_object(
    'credit_notes', c.credit_notes,
    'debit_notes', c.debit_notes,
    'taxable_credits', c.taxable_credits,
    'taxable_additions', c.taxable_additions,
    'taxable_net_effect', c.taxable_additions - c.taxable_credits,
    'cgst', c.dn_cgst - c.cn_cgst,
    'sgst', c.dn_sgst - c.cn_sgst,
    'igst', c.dn_igst - c.cn_igst,
    'cess', c.dn_cess - c.cn_cess),

  'adjusted_output', jsonb_build_object(
    'taxable_value', o.taxable_value + (c.taxable_additions - c.taxable_credits),
    'cgst', o.cgst + (c.dn_cgst - c.cn_cgst),
    'sgst', o.sgst + (c.dn_sgst - c.cn_sgst),
    'igst', o.igst + (c.dn_igst - c.cn_igst),
    'cess', o.cess + (c.dn_cess - c.cn_cess)),

  'inward_itc_4a', jsonb_build_object(
    'taxable_value', i.taxable_value,
    'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst, 'cess', i.cess,
    'bill_count', i.bill_count),

  'net_position', jsonb_build_object(
    'cgst', (o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst,
    'sgst', (o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst,
    'igst', (o.igst + (c.dn_igst - c.cn_igst)) - i.igst,
    'cess', (o.cess + (c.dn_cess - c.cn_cess)) - i.cess,
    'total_net_payable',
      ((o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst)
    + ((o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst)
    + ((o.igst + (c.dn_igst - c.cn_igst)) - i.igst)
    + ((o.cess + (c.dn_cess - c.cn_cess)) - i.cess),
    'is_credit_carried_forward',
      ((((o.cgst + (c.dn_cgst - c.cn_cgst)) - i.cgst)
      + ((o.sgst + (c.dn_sgst - c.cn_sgst)) - i.sgst)
      + ((o.igst + (c.dn_igst - c.cn_igst)) - i.igst)
      + ((o.cess + (c.dn_cess - c.cn_cess)) - i.cess)) < 0)),

  'traceability', jsonb_build_object(
    'invoice_docs', o.doc_count,
    'bill_docs', i.bill_count,
    'credit_note_docs', c.credit_notes,
    'debit_note_docs', c.debit_notes,
    'nil_docs', n.doc_count,
    'zero_rated_docs', x.doc_count,
    'gstr1_sections_fn', 'get_gstr1_sections')
)
FROM out_agg o, in_agg i, cdn_agg c, nil_agg n, export_agg x;
$$;

REVOKE EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gstr3b_computed(uuid, date, date) TO authenticated;

-- ============================================================================
-- # 059 â€” Production gap backend (T108): fund transfers + expense surface
--         + invoice branding columns [oscar]
--
-- ## A. businesses branding columns (047 additive pattern)
--   invoice_footer_text   text  -- footer line rendered under invoice totals
--   invoice_signature_name text -- name line above/beside the signature image
-- Both verified ABSENT across all prior migrations before this ALTER.

-- ## B. v_expense_summary (security_invoker view)
-- Row-grain expense reporting surface for the reports registry, mirroring
-- the 020/052 invoker-view house style. SCHEMA HONESTY: expenses carry NO
-- payee/party column - that filter is impossible without fabrication and
-- is deliberately omitted (041 bills-POS precedent). Category falls back
-- to 'Uncategorized' for NULL category_id (column is ON DELETE SET NULL).
--
-- CONSUMPTION CONTRACT (for reportsAdapter binding):
--   columns   : business_id, expense_id, expense_number, expense_date,
--               category_id, category_name, description, reference,
--               payment_method, net_amount, tax_amount, total_amount,
--               attachment_url, created_at
--   filters   : expense_date BETWEEN from AND to,
--               category_name / category_id equality,
--               payment_method equality  (all client-composable, RLS-safe)
--   totals    : SUM(net_amount), SUM(tax_amount), SUM(total_amount)
--               over the filtered row set (report layer owns rounding)

-- ## C. transfer_funds RPC
-- Internal Cash<->Bank transfer as ONE balanced journal entry:
--   Dr destination ledger / Cr source ledger - both legs inside the
--   Cash & Bank group, so P&L untouched and group-level cash position
--   unchanged (exactly Tally's Contra voucher semantics).
--
-- NUMBERING DECISION (dispatch asked to verify then choose): the 016
-- document_sequences CHECK carries NO transfer doc_type today (11 types
-- end at stock_transfer/TRF). Chosen path: NO new doc type, NO fifth
-- CHECK swap - the JE's own advisory-locked entry_number (JE/YYYY/NNNN,
-- 014 R3) IS the voucher number, traceable via
-- journal_entries.reference_type='fund_transfer'. Adding an unused XFR
-- prefix would be speculative surface; a numbered-doc-type lane can be
-- added later without rework since nothing else keys off it.
--
-- MECHANICS: thin wrapper over post_journal_entry (014 hardened engine -
-- auth/write guards, double-entry validation, advisory numbering,
-- business-scoped INNER JOIN line insert). Balances are NOT touched here:
-- 037's statement trigger recomputes current_balance from full line
-- history after our insert. FY-lock (035 trg_fy_lock_journal) applies
-- automatically to the inserted journal_entries row.
-- Guards: authenticated + can_write, amount > 0, source <> destination,
-- both accounts must exist in-business AND sit in group 'Cash & Bank'
-- (locked together in one ordered FOR UPDATE - deadlock-free against
-- concurrent opposite-direction transfers).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Branding columns (additive only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.businesses
ADD COLUMN IF NOT EXISTS invoice_footer_text text,
ADD COLUMN IF NOT EXISTS invoice_signature_name text;

-- ----------------------------------------------------------------------------
-- B. Expense summary view
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_expense_summary;
CREATE VIEW public.v_expense_summary
WITH (security_invoker = on)
AS
SELECT
  e.business_id,
  e.id                    AS expense_id,
  e.expense_number,
  e.date                  AS expense_date,
  e.category_id,
  COALESCE(c.name, 'Uncategorized') AS category_name,
  e.description,
  e.reference,
  e.payment_method,
  e.amount                AS net_amount,
  e.tax_amount,
  e.total_amount,
  e.attachment_url,
  e.created_at
FROM expenses e
LEFT JOIN expense_categories c ON c.id = e.category_id;

REVOKE ALL ON public.v_expense_summary FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- C. transfer_funds
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_funds(
  p_business_id uuid,
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_amount numeric,
  p_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  journal_entry_id uuid,
  entry_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_src_name text;
  v_dst_name text;
  v_found int;
  v_in_cashbank int;
  v_narration text;
  v_je uuid;
  v_num text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;

  IF p_source_account_id IS NULL OR p_destination_account_id IS NULL
     OR p_source_account_id = p_destination_account_id THEN
    RAISE EXCEPTION 'Source and destination accounts must be different';
  END IF;

  -- Lock both account rows first, deterministic id order: deadlock-free
  -- even when two concurrent calls transfer in opposite directions.
  PERFORM 1
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.id IN (p_source_account_id, p_destination_account_id)
  ORDER BY a.id
  FOR UPDATE;

  -- Then validate existence + group membership on the locked rows.
  SELECT COUNT(*),
         MAX(CASE WHEN a.id = p_source_account_id THEN a.name END),
         MAX(CASE WHEN a.id = p_destination_account_id THEN a.name END),
         COUNT(*) FILTER (WHERE a.group_name = 'Cash & Bank')
  INTO v_found, v_src_name, v_dst_name, v_in_cashbank
  FROM accounts a
  WHERE a.business_id = p_business_id
    AND a.id IN (p_source_account_id, p_destination_account_id);

  IF v_found <> 2 THEN
    RAISE EXCEPTION 'Both accounts must exist in this business';
  END IF;

  IF v_in_cashbank <> 2 THEN
    RAISE EXCEPTION 'Fund transfers require accounts from the Cash & Bank group';
  END IF;

  v_narration := COALESCE(NULLIF(btrim(COALESCE(p_notes, '')), ''),
                          'Fund transfer from ' || v_src_name || ' to ' || v_dst_name);

  v_je := post_journal_entry(
    p_business_id,
    COALESCE(p_date, CURRENT_DATE),
    v_narration,
    'fund_transfer',
    NULL,
    jsonb_build_array(
      jsonb_build_object(
        'account_id',   p_destination_account_id,
        'debit_amount', p_amount,
        'credit_amount', 0
      ),
      jsonb_build_object(
        'account_id',    p_source_account_id,
        'debit_amount',  0,
        'credit_amount', p_amount
      )
    )
  );

  IF v_je IS NULL THEN
    RAISE EXCEPTION 'Fund transfer journal posting failed';
  END IF;

  SELECT je.entry_number INTO v_num
  FROM journal_entries je
  WHERE je.id = v_je;

  RETURN QUERY SELECT v_je, v_num;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_funds(uuid, uuid, uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_funds(uuid, uuid, uuid, numeric, date, text) TO authenticated;

-- ============================================================================
-- D. T108 RIDER: payment_made comms flavor (Stanley PaymentsMade parity)
-- ----------------------------------------------------------------------------
-- (1) notification_logs.doc_type CHECK gains 'payment_made' - house naming
--     verified first: money-in flavor here is 'payment_receipt', so its
--     money-out twin is 'payment_made' (matches 016 numbering doc_types).
--     Dynamic constraint swap (#5 house pattern) scoped by content match.
-- (2) Seed matrix: payment_made joins the BASE set (email + in_app) using
--     exactly the dispatch variables {{supplier_name}}/{{business_name}}/
--     {{amount}}; whatsapp stays the documented customer transactional
--     QUAD (invoice_sent/payment_received/payment_reminder/invoice_overdue)
--     - extension available on request, not silently changed.
--     Editable-per-business semantics identical to invoice_sent: real rows,
--     UNIQUE(business_id,key,channel), ON CONFLICT DO NOTHING re-seeds.
-- ============================================================================

DO $rider$
DECLARE
  c text;
BEGIN
  SELECT max(conname) INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.notification_logs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%payment_receipt%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.notification_logs DROP CONSTRAINT ' || c;
  END IF;
END
$rider$;

ALTER TABLE public.notification_logs ADD CHECK (doc_type IN (
  'sales_invoice','quotation','sales_order','purchase_order',
  'payment_receipt','payment_made','statement','report','reminder','custom'));

-- Seed fn re-emitted with the two payment_made tuples appended; body
-- otherwise byte-identical to 051. Backfill line re-run afterwards is
-- idempotent (ON CONFLICT (business_id,key,channel) DO NOTHING inside).
CREATE OR REPLACE FUNCTION public.seed_business_notification_templates(
  p_business_id uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $seed$
WITH src(key, channel, subject, body, variables) AS (
  VALUES
  ('invoice_sent','email',
   E'Invoice {{invoice_number}} from {{business_name}}',
   E'Dear {{customer_name}},\n\nYour invoice {{invoice_number}} from {{business_name}} for {{amount}} is ready.\nDue date: {{due_date}}.\n\nThank you for your business.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('invoice_sent','in_app',
   E'Invoice {{invoice_number}} issued',
   E'Invoice {{invoice_number}} for {{amount}} was issued to {{customer_name}}.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('invoice_sent','whatsapp',
   E'Invoice {{invoice_number}} from {{business_name}}',
   E'Dear {{customer_name}}, your invoice {{invoice_number}} from {{business_name}} for {{amount}} is ready. Due {{due_date}}. Thank you.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('payment_received','email',
   E'Payment received - thank you',
   E'Dear {{customer_name}},\n\nWe have received your payment of {{amount}} towards invoice {{invoice_number}}.\n\nThank you for your business.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('payment_received','in_app',
   E'Payment of {{amount}} received',
   E'Payment of {{amount}} received from {{customer_name}} towards invoice {{invoice_number}}.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('payment_received','whatsapp',
   E'Payment received - {{business_name}}',
   E'Dear {{customer_name}}, we have received your payment of {{amount}} towards invoice {{invoice_number}}. Thank you.',
   ARRAY['customer_name','invoice_number','business_name','amount']),
  ('payment_reminder','email',
   E'Reminder: invoice {{invoice_number}} due {{due_date}}',
   E'Dear {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.\n\nThank you.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('payment_reminder','in_app',
   E'Invoice {{invoice_number}} due {{due_date}}',
   E'Invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.',
   ARRAY['customer_name','invoice_number','amount','due_date']),
  ('payment_reminder','whatsapp',
   E'Reminder: invoice {{invoice_number}} due {{due_date}}',
   E'Dear {{customer_name}}, a gentle reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}. Thank you.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('invoice_overdue','email',
   E'Overdue: invoice {{invoice_number}}',
   E'Dear {{customer_name}},\n\nInvoice {{invoice_number}} for {{amount}} was due on {{due_date}} and remains outstanding.\nPlease arrange payment at your earliest convenience.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('invoice_overdue','in_app',
   E'Invoice {{invoice_number}} is overdue',
   E'Invoice {{invoice_number}} for {{amount}} has passed its due date {{due_date}}.',
   ARRAY['customer_name','invoice_number','amount','due_date']),
  ('invoice_overdue','whatsapp',
   E'Overdue: invoice {{invoice_number}}',
   E'Dear {{customer_name}}, invoice {{invoice_number}} for {{amount}} was due on {{due_date}} and remains outstanding. Please arrange payment.',
   ARRAY['customer_name','invoice_number','business_name','amount','due_date']),
  ('statement_customer','email',
   E'Your account statement from {{business_name}}',
   E'Dear {{customer_name}},\n\nPlease find your account statement for {{period_start}} to {{period_end}}. Closing balance: {{balance}}.',
   ARRAY['customer_name','business_name','period_start','period_end','balance']),
  ('statement_customer','in_app',
   E'Statement ready for {{period_start}} - {{period_end}}',
   E'Account statement for {{customer_name}} generated. Closing balance: {{balance}}.',
   ARRAY['customer_name','business_name','period_start','period_end','balance']),
  ('statement_supplier','email',
   E'Supplier statement from {{business_name}}',
   E'Dear {{supplier_name}},\n\nPlease find your supplier statement for {{period_start}} to {{period_end}}. Closing balance: {{balance}}.',
   ARRAY['supplier_name','business_name','period_start','period_end','balance']),
  ('statement_supplier','in_app',
   E'Supplier statement ready',
   E'Statement for {{supplier_name}} generated. Closing balance: {{balance}}.',
   ARRAY['supplier_name','business_name','period_start','period_end','balance']),
  ('quotation_sent','email',
   E'Quotation {{quotation_number}} from {{business_name}}',
   E'Dear {{customer_name}},\n\nThank you for your interest. Quotation {{quotation_number}} totalling {{amount}} is attached and valid until {{expiry_date}}.',
   ARRAY['customer_name','quotation_number','business_name','amount','expiry_date']),
  ('quotation_sent','in_app',
   E'Quotation {{quotation_number}} sent',
   E'Quotation {{quotation_number}} for {{amount}} sent to {{customer_name}}.',
   ARRAY['customer_name','quotation_number','business_name','amount']),
  ('sales_order_sent','email',
   E'Sales order confirmation {{order_number}}',
   E'Dear {{customer_name}},\n\nYour sales order {{order_number}} from {{business_name}} totalling {{amount}} has been confirmed.',
   ARRAY['customer_name','order_number','business_name','amount']),
  ('sales_order_sent','in_app',
   E'Sales order {{order_number}} confirmed',
   E'Sales order {{order_number}} for {{amount}} confirmed for {{customer_name}}.',
   ARRAY['customer_name','order_number','business_name','amount']),
  ('purchase_order_sent','email',
   E'Purchase order {{order_number}}',
   E'Dear {{supplier_name}},\n\nPlease find our purchase order {{order_number}} totalling {{amount}}.',
   ARRAY['supplier_name','order_number','business_name','amount']),
  ('purchase_order_sent','in_app',
   E'Purchase order {{order_number}} sent',
   E'Purchase order {{order_number}} for {{amount}} sent to {{supplier_name}}.',
   ARRAY['supplier_name','order_number','business_name','amount']),
  ('gst_report','email',
   E'GST summary {{period_start}} - {{period_end}}',
   E'Dear user,\n\nGST summary for {{business_name}}, {{period_start}} to {{period_end}}:\nOutput tax: {{output_tax}}\nInput tax: {{input_tax}}\nNet GST payable: {{net_tax}}',
   ARRAY['business_name','period_start','period_end','output_tax','input_tax','net_tax']),
  ('gst_report','in_app',
   E'GST report generated',
   E'GST summary for {{period_start}} - {{period_end}} generated. Net GST payable: {{net_tax}}.',
   ARRAY['business_name','period_start','period_end','output_tax','input_tax','net_tax']),
  ('report_delivery','email',
   E'Your requested report: {{report_name}}',
   E'Dear user,\n\nReport {{report_name}} was generated at {{generated_at}} and is attached as {{format}}.',
   ARRAY['report_name','generated_at','format']),
  ('report_delivery','in_app',
   E'Report ready: {{report_name}}',
   E'Report {{report_name}} was generated at {{generated_at}} ({{format}}).',
   ARRAY['report_name','generated_at','format']),
  ('monthly_summary','email',
   E'Monthly summary - {{month}}',
   E'Dear user,\n\nBusiness summary for {{month}}:\nTotal sales: {{total_sales}}\nTotal purchases: {{total_purchases}}\nReceivables: {{receivables}}\nPayables: {{payables}}',
   ARRAY['business_name','month','total_sales','total_purchases','receivables','payables']),
  ('monthly_summary','in_app',
   E'Monthly summary for {{month}}',
   E'Sales {{total_sales}}, purchases {{total_purchases}}, receivables {{receivables}}, payables {{payables}}.',
   ARRAY['business_name','month','total_sales','total_purchases','receivables','payables']),
  ('payment_made','email',
   E'Payment from {{business_name}}',
   E'Dear {{supplier_name}},\n\n{{business_name}} has sent you a payment of {{amount}}.\n\nThank you for your business.',
   ARRAY['supplier_name','business_name','amount']),
  ('payment_made','in_app',
   E'Payment made to {{supplier_name}}',
   E'Payment of {{amount}} was made to {{supplier_name}}.',
   ARRAY['supplier_name','business_name','amount'])
)
ins AS (
  INSERT INTO notification_templates (business_id, key, channel, subject, body, variables)
  SELECT p_business_id, s.key, s.channel, s.subject, s.body, s.variables
  FROM src s
  WHERE EXISTS (SELECT 1 FROM businesses b WHERE b.id = p_business_id)
  ON CONFLICT (business_id, key, channel) DO NOTHING
  RETURNING 1
)
SELECT count(*)::int FROM ins;
$seed$;

-- One-time idempotent backfill so EXISTING businesses get payment_made too
-- (the AFTER INSERT trigger covers only future businesses).
SELECT public.seed_business_notification_templates(id) FROM public.businesses;

REVOKE EXECUTE ON FUNCTION public.seed_business_notification_templates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_business_notification_templates(uuid) TO authenticated;

-- ============================================================================
-- 060 â€” RELEASE HARDENING: composite-FK cross-business reference rejection
-- ============================================================================
-- T112 release-candidate audit finding (the only isolation gap that survived
-- the full matrix sweep):
--
--   Item/detail tables carry a direct business_id and an RLS INSERT policy
--   checked on THAT column. A member of business A can therefore direct-INSERT
--   (Supabase client / psql) an item row with business_id = A pointing at a
--   parent document owned by business B (invoice_id, bill_id, ...). Reads stay
--   biz-scoped so nothing LEAKS across, but it corrupts referential semantics:
--   the item claims to belong to A while its parent lives in B. Definer RPC
--   paths (017/022/026/030/046/048) already validate cross-business ids in
--   code; this migration closes the raw-DML hole at the schema level so the
--   guarantee no longer depends on every future caller being honest.
--
-- Mechanism (purely ADDITIVE â€” no constraint is dropped or altered):
--   1. UNIQUE (id, business_id) on each parent (required FK target).
--      id is already PK so the pair adds zero semantic change.
--   2. Composite FK (parent_col, business_id) -> parent(id, business_id)
--      on each child. The pre-existing single-column FK stays in place;
--      both must hold. ON DELETE CASCADE mirrored from the original FKs.
--   3. Pre-flight DO block counts existing mismatched rows per family and
--      FAILS THE MIGRATION LOUDLY if any are found (fail-hard beats silent
--      repair of data we cannot attribute). Fresh release DBs are expected
--      to be clean because all write paths are RPC-only.
--
-- Deliberately OUT OF SCOPE (documented residual risks, see
-- hive/reports/oscar-security-hardening.md Â§5):
--   - journal_entry_lines.entry_id: clients hold NO DML policies on JE lines
--     since 014/024 (server-write only); RPCs validate biz pairing.
--   - payments.customer/supplier_id + expenses.category_id etc.: nullable
--     party/category refs need per-column composite pairs; low value vs
--     churn this late in RC â€” flagged for post-release follow-up.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Pre-flight: refuse to proceed on any existing cross-business child row
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad FROM sales_invoice_items i
  JOIN sales_invoices d ON d.id = i.invoice_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz sales_invoice_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM purchase_bill_items i
  JOIN purchase_bills d ON d.id = i.bill_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz purchase_bill_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM credit_note_items i
  JOIN credit_notes d ON d.id = i.credit_note_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz credit_note_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM debit_note_items i
  JOIN debit_notes d ON d.id = i.debit_note_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz debit_note_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM quotation_items i
  JOIN quotations d ON d.id = i.quotation_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz quotation_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM sales_order_items i
  JOIN sales_orders d ON d.id = i.sales_order_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz sales_order_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM purchase_order_items i
  JOIN purchase_orders d ON d.id = i.purchase_order_id WHERE i.business_id <> d.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz purchase_order_items', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM stock_transfer_lines l
  JOIN stock_transfers t ON t.id = l.transfer_id WHERE l.business_id <> t.business_id;
  IF v_bad > 0 THEN RAISE EXCEPTION '060 preflight: % cross-biz stock_transfer_lines', v_bad; END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- Parent unique pairs (FK targets)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_id_business    ON public.sales_invoices   (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_bills_id_business    ON public.purchase_bills   (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_notes_id_business      ON public.credit_notes     (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_debit_notes_id_business       ON public.debit_notes      (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_id_business        ON public.quotations       (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_id_business      ON public.sales_orders     (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_id_business   ON public.purchase_orders  (id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_transfers_id_business   ON public.stock_transfers  (id, business_id);

-- ----------------------------------------------------------------------------
-- Composite same-business FKs (additive; original single-col FKs untouched)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sales_invoice_items
  ADD CONSTRAINT fk_sii_invoice_samebiz FOREIGN KEY (invoice_id, business_id)
  REFERENCES public.sales_invoices (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.purchase_bill_items
  ADD CONSTRAINT fk_pbi_bill_samebiz FOREIGN KEY (bill_id, business_id)
  REFERENCES public.purchase_bills (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.credit_note_items
  ADD CONSTRAINT fk_cni_credit_note_samebiz FOREIGN KEY (credit_note_id, business_id)
  REFERENCES public.credit_notes (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.debit_note_items
  ADD CONSTRAINT fk_dni_debit_note_samebiz FOREIGN KEY (debit_note_id, business_id)
  REFERENCES public.debit_notes (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.quotation_items
  ADD CONSTRAINT fk_qi_quotation_samebiz FOREIGN KEY (quotation_id, business_id)
  REFERENCES public.quotations (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.sales_order_items
  ADD CONSTRAINT fk_soi_sales_order_samebiz FOREIGN KEY (sales_order_id, business_id)
  REFERENCES public.sales_orders (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT fk_poi_purchase_order_samebiz FOREIGN KEY (purchase_order_id, business_id)
  REFERENCES public.purchase_orders (id, business_id) ON DELETE CASCADE;

ALTER TABLE public.stock_transfer_lines
  ADD CONSTRAINT fk_stl_transfer_samebiz FOREIGN KEY (transfer_id, business_id)
  REFERENCES public.stock_transfers (id, business_id) ON DELETE CASCADE;

-- ============================================================================
-- 061 â€” RELEASE HARDENING: export_business_backup RPC
-- ============================================================================
-- T112 new-surface deliverable (owner directive). ONE jsonb snapshot of one
-- business for the Settings "Download backup" action.
--
-- Access model = 045 house pattern: SECURITY DEFINER (must read every table
-- regardless of future policy drift) + hard gates auth.uid() + membership.
-- Read-only operation -> gate on is_business_member (NOT can_write): any
-- active member may export; only the data of businesses they belong to.
--
-- Contract (FROZEN â€” relayed to Phyllis via god):
--   export_business_backup(p_business_id uuid) RETURNS jsonb
--   { schema_version: '1', generated_at: timestamptz,
--     business, customers, suppliers, products, warehouses,
--     invoices, invoice_items, purchase_bills, purchase_bill_items,
--     payments, accounts, journal_entries, journal_entry_lines,
--     stock_movements }   -- all collection keys are arrays ('[]' when empty)
--
-- Deliberate v1 scope = exactly the owner-directed table list. Excluded and
-- extendable later without breaking consumers (additive keys only):
-- expenses/categories, credit/debit notes, quote/order family, comms/tally
-- tables, fiscal_year_closes, gst_settlements.
--
-- Determinism: every aggregate ORDER BY id (stable byte-comparable exports).
-- Scale note: jsonb_agg materializes the whole business in memory once;
-- fine at SMB volume, revisit only if a tenant grows past ~6-figure rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_business_backup(
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $export_body$
DECLARE
  v_uid uuid;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Not a member of this business';
  END IF;

  SELECT jsonb_build_object(
    'schema_version', '1',
    'generated_at', now(),

    'business', (
      SELECT to_jsonb(b) FROM public.businesses b WHERE b.id = p_business_id
    ),

    'customers', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.customers x WHERE x.business_id = p_business_id
    ),

    'suppliers', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.suppliers x WHERE x.business_id = p_business_id
    ),

    'products', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.products x WHERE x.business_id = p_business_id
    ),

    'warehouses', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.warehouses x WHERE x.business_id = p_business_id
    ),

    'invoices', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.sales_invoices x WHERE x.business_id = p_business_id
    ),

    'invoice_items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.sales_invoice_items x WHERE x.business_id = p_business_id
    ),

    'purchase_bills', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.purchase_bills x WHERE x.business_id = p_business_id
    ),

    'purchase_bill_items', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.purchase_bill_items x WHERE x.business_id = p_business_id
    ),

    'payments', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.payments x WHERE x.business_id = p_business_id
    ),

    'accounts', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.accounts x WHERE x.business_id = p_business_id
    ),

    'journal_entries', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.journal_entries x WHERE x.business_id = p_business_id
    ),

    'journal_entry_lines', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.journal_entry_lines x WHERE x.business_id = p_business_id
    ),

    'stock_movements', (
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
      FROM public.stock_movements x WHERE x.business_id = p_business_id
    )
  )
  INTO v_result;

  RETURN v_result;
END
$export_body$;

REVOKE EXECUTE ON FUNCTION public.export_business_backup(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_business_backup(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_business_backup(uuid) TO authenticated;

-- ============================================================================
-- 062 â€” RELEASE HARDENING: server-side document header-totals integrity guard
-- ============================================================================
-- T116 (Stanley finding relay). Both save RPCs persisted CLIENT header totals
-- verbatim: no grand_total cross-check, no negative-component guard. The FE is
-- now correct; this closes the hostile/broken-client path that could persist
-- self-inconsistent documents and corrupt downstream GST/journal math.
--
-- Guards added to create_sales_invoice + create_purchase_bill (reject-don't-
-- fix â€” we NEVER silently override; bad payloads must surface):
--   G1 item rows: negative taxable/cgst/sgst/igst/cess RAISE (negative
--      quantity was already guarded).
--   G2 header: negative taxable/GST/cess RAISE (round_off EXCLUDED by design
--      â€” signed plug per 013b: credited positive, debited |amount| negative).
--   G3 header-vs-items agreement within paisa tolerance 0.01 for the five
--      summed components.
--   G4 013b identity mirrored from the ITEM payload:
--        grand_total = Î£item.taxable + Î£item.cgst + Î£item.sgst + Î£item.igst
--                    + Î£item.cess + header.round_off   (Â±0.01)
-- Applied to drafts TOO: a corrupt draft poisons issue_document promotion,
-- which posts the JE straight from stored header figures.
--
-- CONTRACT NOTE: item payloads MUST carry the per-item tax breakdown
-- (taxable/cgst/sgst/igst/cess) â€” true of the FE contract since 017-era and
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
-- 1b. Extended save: purchase bill (live + draft) â€” T116 guards mirrored
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

-- ============================================================================
-- 063 â€” AI summary-function family + summary cache (additive, read-only)
--
-- T117 (AI Business Intelligence). Thin aggregating WRAPPERS over existing
-- canonical surfaces ONLY â€” no financial math recomputed beyond grouping,
-- date-filtering and top-N truncation:
--   sales/purchase       -> live-doc windows over sales_invoices /
--                           purchase_bills (+ *_items for top products),
--                           status sets identical to v_dashboard_kpis
--   profit_loss          -> rows of get_profit_and_loss (020), regrouped
--   cashflow             -> v_cashflow_daily (020)
--   receivables/payables -> get_receivables_aging / get_payables_aging (021)
--   inventory            -> get_stock_valuation (033) + products low-stock +
--                           stock_movements (001) movers
--   customer/supplier    -> aging bases + payments + windowed doc trends;
--                           party membership verified against business
-- House pattern (identical to 045): SECURITY DEFINER, auth.uid() +
-- is_business_member gate, search_path pinned, free-text truncated at the DB
-- boundary, aggregates + TOP-N only (never raw row dumps to any model),
-- numbers emitted as double precision for compact JSON. Strictly read-only.
--
-- Cache: ai_summary_cache keyed (business_id, fingerprint) with short TTL.
-- get_ai_summary() is the ONE dispatcher RPC the edge function calls:
-- whitelist-enforced names, deterministic SQL only â€” the LLM is never
-- involved in summary modes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_summary_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (business_id, fingerprint)
);

ALTER TABLE ai_summary_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_summary_cache_select" ON ai_summary_cache;
CREATE POLICY "ai_summary_cache_select" ON ai_summary_cache FOR SELECT
  TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "ai_summary_cache_insert" ON ai_summary_cache;
CREATE POLICY "ai_summary_cache_insert" ON ai_summary_cache FOR INSERT
  TO authenticated WITH CHECK (is_business_member(business_id));

DROP POLICY IF EXISTS "ai_summary_cache_delete" ON ai_summary_cache;
CREATE POLICY "ai_summary_cache_delete" ON ai_summary_cache FOR DELETE
  TO authenticated USING (can_write_business(business_id));

CREATE INDEX IF NOT EXISTS idx_ai_summary_cache_expiry
  ON ai_summary_cache(business_id, expires_at);

-- ============================================================================
-- SALES SUMMARY (windowed totals, monthly buckets, top customers/products)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_sales_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_tot   jsonb;
  v_month jsonb;
  v_cust  jsonb;
  v_prod  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);

  SELECT jsonb_build_object(
           'total_grand',
             COALESCE(sum(si.grand_total), 0)::double precision,
           'total_taxable',
             COALESCE(sum(si.taxable_amount), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(si.paid_amount), 0)::double precision,
           'outstanding_total',
             COALESCE(sum(GREATEST(si.grand_total - si.paid_amount, 0)), 0)::double precision
         )
    INTO v_tot
    FROM sales_invoices si
   WHERE si.business_id = p_business_id
     AND si.status IN ('issued', 'partially_paid', 'paid')
     AND si.invoice_date >= p_from_date
     AND si.invoice_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', si.invoice_date), 'YYYY-MM') AS month,
             sum(si.grand_total)::double precision                    AS total,
             count(*)                                                 AS invoices
        FROM sales_invoices si
       WHERE si.business_id = p_business_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
    INTO v_cust
    FROM (
      SELECT left(cu.name, 80)                     AS customer_name,
             sum(si.grand_total)::double precision AS billed,
             count(*)                              AS invoices
        FROM sales_invoices si
        JOIN customers cu ON cu.id = si.customer_id
       WHERE si.business_id = p_business_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY cu.id, cu.name
       ORDER BY billed DESC
       LIMIT v_limit
    ) c;

  SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb)
    INTO v_prod
    FROM (
      SELECT left(it.product_name, 80)              AS product_name,
             sum(it.quantity)::double precision     AS qty_sold,
             sum(it.total_amount)::double precision AS revenue
        FROM sales_invoice_items it
        JOIN sales_invoices si ON si.id = it.invoice_id
       WHERE it.business_id = p_business_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY left(it.product_name, 80)
       ORDER BY revenue DESC
       LIMIT v_limit
    ) pr;

  RETURN jsonb_build_object(
    'kind', 'sales_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'totals',        v_tot,
    'monthly',       v_month,
    'top_customers', v_cust,
    'top_products',  v_prod
  );
END;
$$;

-- ============================================================================
-- PURCHASE SUMMARY (same shape as sales)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_purchase_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_tot   jsonb;
  v_month jsonb;
  v_supp  jsonb;
  v_prod  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);

  SELECT jsonb_build_object(
           'total_grand',
             COALESCE(sum(pb.grand_total), 0)::double precision,
           'total_taxable',
             COALESCE(sum(pb.taxable_amount), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(pb.paid_amount), 0)::double precision,
           'outstanding_total',
             COALESCE(sum(GREATEST(pb.grand_total - pb.paid_amount, 0)), 0)::double precision
         )
    INTO v_tot
    FROM purchase_bills pb
   WHERE pb.business_id = p_business_id
     AND pb.status IN ('confirmed', 'partially_paid', 'paid')
     AND pb.bill_date >= p_from_date
     AND pb.bill_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', pb.bill_date), 'YYYY-MM') AS month,
             sum(pb.grand_total)::double precision                 AS total,
             count(*)                                              AS bills
        FROM purchase_bills pb
       WHERE pb.business_id = p_business_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT COALESCE(jsonb_agg(to_jsonb(sp)), '[]'::jsonb)
    INTO v_supp
    FROM (
      SELECT left(sp.name, 80)                      AS supplier_name,
             sum(pb.grand_total)::double precision  AS billed,
             count(*)                               AS bills
        FROM purchase_bills pb
        JOIN suppliers sp ON sp.id = pb.supplier_id
       WHERE pb.business_id = p_business_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY sp.id, sp.name
       ORDER BY billed DESC
       LIMIT v_limit
    ) s2;

  SELECT COALESCE(jsonb_agg(to_jsonb(pr)), '[]'::jsonb)
    INTO v_prod
    FROM (
      SELECT left(it.product_name, 80)              AS product_name,
             sum(it.quantity)::double precision     AS qty_bought,
             sum(it.total_amount)::double precision AS spend
        FROM purchase_bill_items it
        JOIN purchase_bills pb ON pb.id = it.bill_id
       WHERE it.business_id = p_business_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY left(it.product_name, 80)
       ORDER BY spend DESC
       LIMIT v_limit
    ) pr;

  RETURN jsonb_build_object(
    'kind', 'purchase_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'totals',        v_tot,
    'monthly',       v_month,
    'top_suppliers', v_supp,
    'top_products',  v_prod
  );
END;
$$;

-- ============================================================================
-- PROFIT & LOSS SUMMARY (wrapper over get_profit_and_loss 020 â€” no recompute)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_profit_loss_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date,
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_limit    int;
  v_income   double precision := 0;
  v_direct   double precision := 0;
  v_indirect double precision := 0;
  v_net      double precision := 0;
  v_topexp   jsonb;
  r          RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);

  FOR r IN
    SELECT section, amount
      FROM get_profit_and_loss(p_business_id, p_from_date, p_to_date)
  LOOP
    IF r.section = 'Income' THEN
      v_income := v_income + r.amount::double precision;
    ELSIF r.section = 'Direct Expense' THEN
      v_direct := v_direct + r.amount::double precision;
    ELSIF r.section = 'Indirect Expense' THEN
      v_indirect := v_indirect + r.amount::double precision;
    ELSIF r.section = 'Summary' THEN
      v_net := r.amount::double precision;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.amount DESC), '[]'::jsonb)
    INTO v_topexp
    FROM (
      SELECT left(pl.account_name, 60)  AS category,
             pl.amount::double precision AS amount,
             pl.group_name               AS group_name
        FROM get_profit_and_loss(p_business_id, p_from_date, p_to_date) pl
       WHERE pl.section IN ('Direct Expense', 'Indirect Expense')
       ORDER BY pl.amount DESC
       LIMIT v_limit
    ) e;

  RETURN jsonb_build_object(
    'kind', 'profit_loss_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',            p_business_id,
    'from_date',              p_from_date,
    'to_date',                p_to_date,
    'income_total',           round(v_income::numeric, 2)::double precision,
    'direct_expense_total',   round(v_direct::numeric, 2)::double precision,
    'indirect_expense_total', round(v_indirect::numeric, 2)::double precision,
    'net_profit',             round(v_net::numeric, 2)::double precision,
    'top_expense_categories', v_topexp
  );
END;
$$;

-- ============================================================================
-- CASHFLOW SUMMARY (wrapper over v_cashflow_daily; peaks via scalar subqs)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cashflow_summary(
  p_business_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_in    double precision;
  v_out   double precision;
  v_month jsonb;
  v_peak  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT COALESCE(sum(cf.inflow), 0)::double precision,
         COALESCE(sum(cf.outflow), 0)::double precision
    INTO v_in, v_out
    FROM v_cashflow_daily cf
   WHERE cf.business_id = p_business_id
     AND cf.flow_date >= p_from_date
     AND cf.flow_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', cf.flow_date), 'YYYY-MM') AS month,
             sum(cf.inflow)::double precision                      AS inflow,
             sum(cf.outflow)::double precision                     AS outflow
        FROM v_cashflow_daily cf
       WHERE cf.business_id = p_business_id
         AND cf.flow_date >= p_from_date
         AND cf.flow_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT jsonb_build_object(
           'peak_inflow_day',
             (SELECT jsonb_build_object('day', cf.flow_date,
                                        'amount', cf.inflow::double precision)
                FROM v_cashflow_daily cf
               WHERE cf.business_id = p_business_id
                 AND cf.flow_date >= p_from_date
                 AND cf.flow_date <= p_to_date
               ORDER BY cf.inflow DESC, cf.flow_date ASC
               LIMIT 1),
           'peak_outflow_day',
             (SELECT jsonb_build_object('day', cf2.flow_date,
                                        'amount', cf2.outflow::double precision)
                FROM v_cashflow_daily cf2
               WHERE cf2.business_id = p_business_id
                 AND cf2.flow_date >= p_from_date
                 AND cf2.flow_date <= p_to_date
               ORDER BY cf2.outflow DESC, cf2.flow_date ASC
               LIMIT 1)
         )
    INTO v_peak;

  RETURN jsonb_build_object(
    'kind', 'cashflow_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'inflow_total',  round(v_in::numeric, 2)::double precision,
    'outflow_total', round(v_out::numeric, 2)::double precision,
    'net',           round((v_in - v_out)::numeric, 2)::double precision,
    'monthly',       v_month,
    'peaks',         COALESCE(v_peak, '{}'::jsonb)
  );
END;
$$;

-- ============================================================================
-- RECEIVABLES SUMMARY (rollup over get_receivables_aging 021)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_receivables_summary(
  p_business_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_roll  jsonb;
  v_top   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);

  SELECT jsonb_build_object(
           'outstanding_total',
             COALESCE(sum(a.outstanding), 0)::double precision,
           'current',
             COALESCE(sum(a."current"), 0)::double precision,
           'days_1_30',
             COALESCE(sum(a.days_1_30), 0)::double precision,
           'days_31_60',
             COALESCE(sum(a.days_31_60), 0)::double precision,
           'days_61_90',
             COALESCE(sum(a.days_61_90), 0)::double precision,
           'days_90_plus',
             COALESCE(sum(a.days_90_plus), 0)::double precision,
           'open_documents', count(DISTINCT a.doc_id),
           'parties',        count(DISTINCT a.party_id)
         )
    INTO v_roll
    FROM get_receivables_aging(p_business_id) a;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.outstanding DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT left(a2.party_name, 80)                AS party_name,
             sum(a2.outstanding)::double precision  AS outstanding,
             sum(a2.days_90_plus)::double precision AS overdue_90_plus,
             count(*)                               AS open_docs
        FROM get_receivables_aging(p_business_id) a2
       GROUP BY a2.party_id, a2.party_name
       ORDER BY outstanding DESC
       LIMIT v_limit
    ) t;

  RETURN jsonb_build_object(
    'kind', 'receivables_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id', p_business_id,
    'as_of',       CURRENT_DATE,
    'rollup',      v_roll,
    'top_parties', v_top
  );
END;
$$;

-- ============================================================================
-- PAYABLES SUMMARY (rollup over get_payables_aging 021)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_payables_summary(
  p_business_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_roll  jsonb;
  v_top   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);

  SELECT jsonb_build_object(
           'outstanding_total',
             COALESCE(sum(a.outstanding), 0)::double precision,
           'current',
             COALESCE(sum(a."current"), 0)::double precision,
           'days_1_30',
             COALESCE(sum(a.days_1_30), 0)::double precision,
           'days_31_60',
             COALESCE(sum(a.days_31_60), 0)::double precision,
           'days_61_90',
             COALESCE(sum(a.days_61_90), 0)::double precision,
           'days_90_plus',
             COALESCE(sum(a.days_90_plus), 0)::double precision,
           'open_documents', count(DISTINCT a.doc_id),
           'parties',        count(DISTINCT a.party_id)
         )
    INTO v_roll
    FROM get_payables_aging(p_business_id) a;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.outstanding DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT left(a2.party_name, 80)                AS party_name,
             sum(a2.outstanding)::double precision  AS outstanding,
             sum(a2.days_90_plus)::double precision AS overdue_90_plus,
             count(*)                               AS open_docs
        FROM get_payables_aging(p_business_id) a2
       GROUP BY a2.party_id, a2.party_name
       ORDER BY outstanding DESC
       LIMIT v_limit
    ) t;

  RETURN jsonb_build_object(
    'kind', 'payables_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id', p_business_id,
    'as_of',       CURRENT_DATE,
    'rollup',      v_roll,
    'top_parties', v_top
  );
END;
$$;

-- ============================================================================
-- INVENTORY SUMMARY (get_stock_valuation 033 + low-stock + movement movers)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_inventory_summary(
  p_business_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit int;
  v_val   double precision := 0;
  v_qty   double precision := 0;
  v_cnt   int := 0;
  r       RECORD;
  v_low   jsonb;
  v_fast  jsonb;
  v_slow  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);

  FOR r IN
    SELECT * FROM get_stock_valuation(p_business_id)
  LOOP
    IF COALESCE(r.quantity, 0) > 0 THEN
      v_cnt   := v_cnt + 1;
      v_qty   := v_qty + r.quantity::double precision;
      v_val   := v_val + COALESCE(r.total_value, 0)::double precision;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    INTO v_low
    FROM (
      SELECT left(name, 80)                  AS product_name,
             current_stock::double precision AS stock,
             minimum_stock::double precision AS min_stock
        FROM products
       WHERE business_id = p_business_id
         AND type = 'product'
         AND is_active
         AND minimum_stock > 0
         AND current_stock <= minimum_stock
       ORDER BY (minimum_stock - current_stock) DESC
       LIMIT v_limit
    ) p;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.qty_out DESC), '[]'::jsonb)
    INTO v_fast
    FROM (
      SELECT left(pr.name, 80)                        AS product_name,
             sum(-mv.quantity)::double precision      AS qty_out,
             count(*)                                 AS movements
        FROM stock_movements mv
        JOIN products pr ON pr.id = mv.product_id
       WHERE mv.business_id = p_business_id
         AND mv.quantity < 0
         AND mv.created_at >= (CURRENT_DATE - INTERVAL '90 days')
       GROUP BY pr.id, pr.name
       ORDER BY qty_out DESC
       LIMIT v_limit
    ) f;

  SELECT COALESCE(jsonb_agg(to_jsonb(sl)), '[]'::jsonb)
    INTO v_slow
    FROM (
      SELECT left(pr2.name, 80)               AS product_name,
             pr2.current_stock::double precision AS stock
        FROM products pr2
       WHERE pr2.business_id = p_business_id
         AND pr2.type = 'product'
         AND pr2.is_active
         AND NOT EXISTS (
               SELECT 1 FROM stock_movements mv2
                WHERE mv2.product_id = pr2.id
                  AND mv2.quantity < 0
                  AND mv2.created_at >= (CURRENT_DATE - INTERVAL '90 days'))
       ORDER BY pr2.name
       LIMIT v_limit
    ) sl;

  RETURN jsonb_build_object(
    'kind', 'inventory_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',     p_business_id,
    'valuation_total', round(v_val::numeric, 2)::double precision,
    'stocked_products', v_cnt,
    'total_quantity',  round(v_qty::numeric, 3)::double precision,
    'low_stock',       v_low,
    'fast_movers_90d', v_fast,
    'slow_movers_90d', v_slow
  );
END;
$$;

-- ============================================================================
-- CUSTOMER / SUPPLIER SUMMARIES (per-party; membership verified)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_customer_summary(
  p_business_id uuid,
  p_customer_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_name  text;
  v_tot   jsonb;
  v_month jsonb;
  v_out   jsonb;
  v_pay   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT left(c.name, 80) INTO v_name
    FROM customers c
   WHERE c.id = p_customer_id
     AND c.business_id = p_business_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Customer not found in this business';
  END IF;

  SELECT jsonb_build_object(
           'billed_total',
             COALESCE(sum(si.grand_total), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(si.paid_amount), 0)::double precision
         )
    INTO v_tot
    FROM sales_invoices si
   WHERE si.business_id = p_business_id
     AND si.customer_id = p_customer_id
     AND si.status IN ('issued', 'partially_paid', 'paid')
     AND si.invoice_date >= p_from_date
     AND si.invoice_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', si.invoice_date), 'YYYY-MM') AS month,
             sum(si.grand_total)::double precision                    AS total,
             count(*)                                                 AS invoices
        FROM sales_invoices si
       WHERE si.business_id = p_business_id
         AND si.customer_id = p_customer_id
         AND si.status IN ('issued', 'partially_paid', 'paid')
         AND si.invoice_date >= p_from_date
         AND si.invoice_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT jsonb_build_object(
           'outstanding_now',
             COALESCE(sum(b.outstanding), 0)::double precision,
           'overdue_docs',
             count(*) FILTER (WHERE b.days_overdue > 0),
           'oldest_days_overdue',
             COALESCE(max(b.days_overdue), 0)
         )
    INTO v_out
    FROM v_receivables_aging_base b
   WHERE b.business_id = p_business_id
     AND b.party_id = p_customer_id
     AND b.outstanding > 0;

  SELECT jsonb_build_object(
           'received_in_window',
             COALESCE(sum(pm.amount), 0)::double precision,
           'payments_count', count(*),
           'last_payment_date', max(pm.date)
         )
    INTO v_pay
    FROM payments pm
   WHERE pm.business_id = p_business_id
     AND pm.party_type = 'customer'
     AND pm.party_id = p_customer_id
     AND pm.type = 'received'
     AND pm.date >= p_from_date
     AND pm.date <= p_to_date;

  RETURN jsonb_build_object(
    'kind', 'customer_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',  p_business_id,
    'customer_id',  p_customer_id,
    'customer_name', v_name,
    'from_date',    p_from_date,
    'to_date',      p_to_date,
    'window_totals', v_tot,
    'monthly',      v_month,
    'outstanding',  v_out,
    'payments',     v_pay
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_supplier_summary(
  p_business_id uuid,
  p_supplier_id uuid,
  p_from_date date,
  p_to_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_name  text;
  v_tot   jsonb;
  v_month jsonb;
  v_out   jsonb;
  v_pay   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_from_date > p_to_date THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT left(s.name, 80) INTO v_name
    FROM suppliers s
   WHERE s.id = p_supplier_id
     AND s.business_id = p_business_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Supplier not found in this business';
  END IF;

  SELECT jsonb_build_object(
           'billed_total',
             COALESCE(sum(pb.grand_total), 0)::double precision,
           'count', count(*),
           'paid_total',
             COALESCE(sum(pb.paid_amount), 0)::double precision
         )
    INTO v_tot
    FROM purchase_bills pb
   WHERE pb.business_id = p_business_id
     AND pb.supplier_id = p_supplier_id
     AND pb.status IN ('confirmed', 'partially_paid', 'paid')
     AND pb.bill_date >= p_from_date
     AND pb.bill_date <= p_to_date;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
    INTO v_month
    FROM (
      SELECT to_char(date_trunc('month', pb.bill_date), 'YYYY-MM') AS month,
             sum(pb.grand_total)::double precision                 AS total,
             count(*)                                              AS bills
        FROM purchase_bills pb
       WHERE pb.business_id = p_business_id
         AND pb.supplier_id = p_supplier_id
         AND pb.status IN ('confirmed', 'partially_paid', 'paid')
         AND pb.bill_date >= p_from_date
         AND pb.bill_date <= p_to_date
       GROUP BY 1
    ) m;

  SELECT jsonb_build_object(
           'outstanding_now',
             COALESCE(sum(b.outstanding), 0)::double precision,
           'overdue_docs',
             count(*) FILTER (WHERE b.days_overdue > 0),
           'oldest_days_overdue',
             COALESCE(max(b.days_overdue), 0)
         )
    INTO v_out
    FROM v_payables_aging_base b
   WHERE b.business_id = p_business_id
     AND b.party_id = p_supplier_id
     AND b.outstanding > 0;

  SELECT jsonb_build_object(
           'paid_in_window',
             COALESCE(sum(pm.amount), 0)::double precision,
           'payments_count', count(*),
           'last_payment_date', max(pm.date)
         )
    INTO v_pay
    FROM payments pm
   WHERE pm.business_id = p_business_id
     AND pm.party_type = 'supplier'
     AND pm.party_id = p_supplier_id
     AND pm.type = 'made'
     AND pm.date >= p_from_date
     AND pm.date <= p_to_date;

  RETURN jsonb_build_object(
    'kind', 'supplier_summary',
    'generated_at',
      to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'business_id',   p_business_id,
    'supplier_id',   p_supplier_id,
    'supplier_name', v_name,
    'from_date',     p_from_date,
    'to_date',       p_to_date,
    'window_totals', v_tot,
    'monthly',       v_month,
    'outstanding',   v_out,
    'payments',      v_pay
  );
END;
$$;

-- ============================================================================
-- DISPATCHER + CACHE (the ONE RPC the edge function calls for summaries)
-- Whitelist-enforced; deterministic SQL only; LLM never involved here.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_ai_summary(
  p_business_id uuid,
  p_name text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_from   date;
  v_to     date;
  v_limit  int;
  v_fp     text;
  v_cached jsonb;
  v_data   jsonb;
  v_cid    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;
  IF p_name IS NULL THEN
    RAISE EXCEPTION 'Summary name required';
  END IF;

  v_from := COALESCE(nullif(p_params->>'from', '')::date,
                     (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')::date);
  v_to   := COALESCE(nullif(p_params->>'to', '')::date, CURRENT_DATE);
  v_limit := LEAST(GREATEST(COALESCE((p_params->>'limit')::int, 5), 1), 20);
  IF v_from > v_to THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  -- party summaries require the party id and use a fixed window
  IF p_name IN ('get_customer_summary', 'get_supplier_summary') THEN
    v_cid := nullif(p_params->>'party_id', '')::uuid;
    IF v_cid IS NULL THEN
      RAISE EXCEPTION 'party_id required for %', p_name;
    END IF;
  END IF;

  v_fp := md5(p_name || ':' || COALESCE(p_params::text, '{}'));

  SELECT payload INTO v_cached
    FROM ai_summary_cache
   WHERE business_id = p_business_id
     AND fingerprint = v_fp
     AND expires_at > now()
   LIMIT 1;
  IF v_cached IS NOT NULL THEN
    RETURN jsonb_build_object('source', 'cache', 'data', v_cached);
  END IF;

  CASE p_name
    WHEN 'get_sales_summary' THEN
      v_data := get_sales_summary(p_business_id, v_from, v_to, v_limit);
    WHEN 'get_purchase_summary' THEN
      v_data := get_purchase_summary(p_business_id, v_from, v_to, v_limit);
    WHEN 'get_profit_loss_summary' THEN
      v_data := get_profit_loss_summary(p_business_id, v_from, v_to, v_limit);
    WHEN 'get_cashflow_summary' THEN
      v_data := get_cashflow_summary(p_business_id, v_from, v_to);
    WHEN 'get_receivables_summary' THEN
      v_data := get_receivables_summary(p_business_id, v_limit);
    WHEN 'get_payables_summary' THEN
      v_data := get_payables_summary(p_business_id, v_limit);
    WHEN 'get_inventory_summary' THEN
      v_data := get_inventory_summary(p_business_id, v_limit);
    WHEN 'get_customer_summary' THEN
      v_data := get_customer_summary(p_business_id, v_cid, v_from, v_to);
    WHEN 'get_supplier_summary' THEN
      v_data := get_supplier_summary(p_business_id, v_cid, v_from, v_to);
    ELSE
      RAISE EXCEPTION 'Unknown summary name %', p_name;
  END CASE;

  INSERT INTO ai_summary_cache
    (business_id, fingerprint, payload, expires_at)
  VALUES
    (p_business_id, v_fp, v_data, now() + INTERVAL '15 minutes')
  ON CONFLICT (business_id, fingerprint)
  DO UPDATE SET payload   = EXCLUDED.payload,
                created_at = now(),
                expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object('source', 'computed', 'data', v_data);
END;
$$;

-- ============================================================================
-- GRANTS (house triple for every new function)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION get_sales_summary(uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_sales_summary(uuid, date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_sales_summary(uuid, date, date, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_purchase_summary(uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_purchase_summary(uuid, date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_purchase_summary(uuid, date, date, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_profit_loss_summary(uuid, date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_profit_loss_summary(uuid, date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_profit_loss_summary(uuid, date, date, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_cashflow_summary(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_cashflow_summary(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_cashflow_summary(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_receivables_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_receivables_summary(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_receivables_summary(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_payables_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_payables_summary(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_payables_summary(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_inventory_summary(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_inventory_summary(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_inventory_summary(uuid, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_customer_summary(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_customer_summary(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_customer_summary(uuid, uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_supplier_summary(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_supplier_summary(uuid, uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_supplier_summary(uuid, uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION get_ai_summary(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_ai_summary(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION get_ai_summary(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION get_ai_summary(uuid, text, jsonb) IS
  'Whitelist dispatcher for AI summary functions with 15-minute cache. Definer-gated via is_business_member(); deterministic SQL only.';

-- Re-enable mutation trigger after all migrations complete
ALTER TABLE IF EXISTS stock_movements ENABLE TRIGGER USER;
