-- Migration 076: Permissive RLS policies for sales_invoice_items and sales_invoices
ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for authenticated on sales_invoice_items" ON sales_invoice_items;
DROP POLICY IF EXISTS "Users can manage invoice items" ON sales_invoice_items;
DROP POLICY IF EXISTS "Allow authenticated full access to sales_invoice_items" ON sales_invoice_items;

CREATE POLICY "Allow authenticated full access to sales_invoice_items"
  ON sales_invoice_items
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated full access to sales_invoices" ON sales_invoices;
CREATE POLICY "Allow authenticated full access to sales_invoices"
  ON sales_invoices
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

GRANT ALL ON sales_invoice_items TO authenticated, anon, service_role;
GRANT ALL ON sales_invoices TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
