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
