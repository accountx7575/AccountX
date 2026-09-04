-- ============================================================================
-- # 059 — Production gap backend (T108): fund transfers + expense surface
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
