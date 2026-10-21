-- PBS-113: Demo/Proforma Sandbox — dedicated persistence.
--
-- Every demo document (demo quotation / demo sales invoice / demo sales order)
-- persists ONLY here, tagged is_demo:true by construction. This table is OUTSIDE
-- every real accounting lane by design:
--   * GL / journal entries / trial balance / balance sheet / COA read
--     journal_entries + postings — demo sandbox never writes there.
--   * GST compliance (GSTR-1/3B, validation, reconciliation) reads the real
--     sales_invoices/purchase_bills series — demo rows never land in those tables.
--   * Stock reads stock_movements/products — demo saves decrement nothing
--     (demo create branches return before any stock/journal call).
-- Seeing is_demo rows in any of those lanes would be a bug: guard rails live
-- in src/lib/demoStore.ts (isDemoRow + demo-only stores) and the demo write path
-- in QuotationCreatePage/SalesOrderCreatePage/SalesInvoiceCreatePage (early
-- return into saveDemoDoc before any supabase write).
--
-- DO NOT APPLY — human applies the migration queue at go-live.
-- Until then the sandbox runs on its localStorage mirror (ax-demo-docs:<businessId>).

CREATE TABLE IF NOT EXISTS demo_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quotation', 'sales_invoice', 'sales_order')),
  number text NOT NULL DEFAULT '',
  header_mode text NOT NULL DEFAULT 'demo' CHECK (header_mode IN ('estimate', 'demo', 'clean')),
  is_demo boolean NOT NULL DEFAULT true CHECK (is_demo = true),
  -- DB-row-shaped header + items + party snapshot for the sandboxed doc type.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_documents_business_kind_idx
  ON demo_documents (business_id, kind, created_at DESC);

-- Sandbox rows are never referenced by ledger/postings/stock — no ON DELETE
-- concerns beyond business teardown.

ALTER TABLE demo_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY demo_documents_select_business ON demo_documents
  FOR SELECT TO authenticated USING (is_business_member(business_id));

CREATE POLICY demo_documents_insert_business ON demo_documents
  FOR INSERT TO authenticated WITH CHECK (is_business_member(business_id));

CREATE POLICY demo_documents_update_business ON demo_documents
  FOR UPDATE TO authenticated USING (is_business_member(business_id));

CREATE POLICY demo_documents_delete_business ON demo_documents
  FOR DELETE TO authenticated USING (is_business_member(business_id));
