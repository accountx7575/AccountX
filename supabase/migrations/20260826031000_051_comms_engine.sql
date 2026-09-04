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
),
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
  p_recipient_address text DEFAULT NULL,
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


