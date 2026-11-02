import { supabase } from '@/lib/supabase';

export type CommChannelDb = 'email' | 'whatsapp' | 'in_app';

export type NotificationTemplateRow = {
  id: string;
  business_id: string;
  key: string;
  channel: CommChannelDb;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
  updated_at: string;
};

export type NotificationLogRow = {
  id: string;
  business_id: string;
  channel: CommChannelDb;
  template_key: string | null;
  recipient_type: 'customer' | 'supplier' | 'custom' | null;
  recipient_ref: string | null;
  recipient_address: string;
  subject: string | null;
  body: string | null;
  attachment_name: string | null;
  doc_type:
    | 'sales_invoice'
    | 'quotation'
    | 'sales_order'
    | 'purchase_order'
    | 'payment_receipt'
    | 'statement'
    | 'report'
    | 'reminder'
    | 'custom'
    | null;
  doc_id: string | null;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  provider: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  sent_at: string | null;
  created_at: string;
};

export type CommunicationSettingsView = {
  email_provider: string | null;
  email_from_address: string | null;
  email_configured: boolean;
  whatsapp_provider: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_configured: boolean;
};

export type ScheduledReportRow = {
  id: string;
  business_id: string;
  report_key: string;
  recipients: unknown;
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  formats: string[];
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

export const commsKeys = {
  settings: (bid?: string) => ['communication-settings', bid] as const,
  templates: (bid?: string) => ['notification-templates', bid] as const,
  logs: (bid?: string) => ['notification-logs', bid] as const,
  schedules: (bid?: string) => ['scheduled-reports', bid] as const,
  prefs: (bid?: string, userId?: string) => ['notification-preferences', bid, userId] as const,
};

export async function fetchCommunicationSettings(businessId: string): Promise<CommunicationSettingsView> {
  const { data, error } = await supabase.rpc('get_communication_settings', {
    p_business_id: businessId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    email_provider: row?.email_provider ?? null,
    email_from_address: row?.email_from_address ?? null,
    email_configured: row?.email_configured ?? false,
    whatsapp_provider: row?.whatsapp_provider ?? 'meta_cloud',
    whatsapp_phone_number_id: row?.whatsapp_phone_number_id ?? null,
    whatsapp_configured: row?.whatsapp_configured ?? false,
  };
}

export async function saveCommunicationSettings(
  businessId: string,
  next: CommunicationSettingsView
): Promise<void> {
  const { error } = await supabase.rpc('upsert_communication_settings', {
    p_business_id: businessId,
    p_email_provider: next.email_provider,
    p_email_from_address: next.email_from_address,
    p_email_configured: next.email_configured,
    p_whatsapp_provider: next.whatsapp_provider || 'meta_cloud',
    p_whatsapp_phone_number_id: next.whatsapp_phone_number_id,
    p_whatsapp_configured: next.whatsapp_configured,
  });
  if (error) throw new Error(error.message);
}

export async function listTemplates(businessId: string): Promise<NotificationTemplateRow[]> {
  const { data, error } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('business_id', businessId)
    .order('key')
    .order('channel');
  if (error) throw new Error(error.message);
  return (data || []) as NotificationTemplateRow[];
}

export async function getTemplateForKey(
  businessId: string,
  key: string,
  channel: 'email' | 'whatsapp'
): Promise<NotificationTemplateRow | null> {
  const { data, error } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('business_id', businessId)
    .eq('key', key)
    .eq('channel', channel)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NotificationTemplateRow) || null;
}

export async function updateTemplate(
  templateId: string,
  patch: { subject: string | null; body: string }
): Promise<void> {
  const { error } = await supabase
    .from('notification_templates')
    .update({ subject: patch.subject, body: patch.body })
    .eq('id', templateId);
  if (error) throw new Error(error.message);
}

export type LogFilters = {
  channel: string;
  status: string;
  from: string;
  to: string;
};

export async function listNotificationLogs(
  businessId: string,
  filters: LogFilters,
  limit = 100
): Promise<NotificationLogRow[]> {
  let q = supabase
    .from('notification_logs')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (filters.channel) q = q.eq('channel', filters.channel);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.from) q = q.gte('created_at', `${filters.from}T00:00:00`);
  if (filters.to) q = q.lte('created_at', `${filters.to}T23:59:59`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as NotificationLogRow[];
}

export async function retryNotification(logId: string): Promise<void> {
  const { error } = await supabase.rpc('retry_notification', { p_log_id: logId });
  if (error) throw new Error(error.message);
}

export async function cancelNotification(logId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_notification', { p_log_id: logId });
  if (error) throw new Error(error.message);
}

export async function listScheduledReports(businessId: string): Promise<ScheduledReportRow[]> {
  const { data, error } = await supabase
    .from('scheduled_reports')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as ScheduledReportRow[];
}

export type ScheduledReportInput = {
  report_key: string;
  recipients: string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week: number | null;
  day_of_month: number | null;
  time_of_day: string;
  formats: string[];
  enabled: boolean;
};

export async function createScheduledReport(
  businessId: string,
  userId: string | undefined,
  input: ScheduledReportInput
): Promise<void> {
  const { error } = await supabase.from('scheduled_reports').insert({
    business_id: businessId,
    created_by: userId ?? null,
    ...input,
  });
  if (error) throw new Error(error.message);
}

export async function updateScheduledReport(
  scheduleId: string,
  input: Partial<ScheduledReportInput>
): Promise<void> {
  const { error } = await supabase
    .from('scheduled_reports')
    .update(input)
    .eq('id', scheduleId);
  if (error) throw new Error(error.message);
}

export async function deleteScheduledReport(scheduleId: string): Promise<void> {
  const { error } = await supabase.from('scheduled_reports').delete().eq('id', scheduleId);
  if (error) throw new Error(error.message);
}

export async function getAutoRemindersEnabled(
  businessId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('notification_preferences')
    .select('pref_value')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('pref_key', 'auto_reminders_enabled')
    .maybeSingle();
  return data?.pref_value === true;
}

export async function setAutoRemindersEnabled(
  businessId: string,
  userId: string,
  enabled: boolean
): Promise<void> {
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      business_id: businessId,
      user_id: userId,
      pref_key: 'auto_reminders_enabled',
      pref_value: enabled,
    },
    { onConflict: 'business_id,user_id,pref_key' }
  );
  if (error) throw new Error(error.message);
}

/** Per-automation channel choices (T119 Automation Center). Stored as one jsonb
 *  pref per automation under notification_preferences (existing table only). */
export type AutomationChannels = { in_app: boolean; email: boolean; whatsapp: boolean };

const DEFAULT_CHANNELS: AutomationChannels = { in_app: true, email: false, whatsapp: false };

function channelsPrefKey(reportKey: string): string {
  return `automation_channels:${reportKey}`;
}

export async function getAutomationChannels(
  businessId: string,
  userId: string,
  reportKey: string
): Promise<AutomationChannels> {
  const { data } = await supabase
    .from('notification_preferences')
    .select('pref_value')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('pref_key', channelsPrefKey(reportKey))
    .maybeSingle();
  const v = data?.pref_value as Partial<AutomationChannels> | null | undefined;
  if (!v || typeof v !== 'object') return { ...DEFAULT_CHANNELS };
  return {
    in_app: typeof v.in_app === 'boolean' ? v.in_app : DEFAULT_CHANNELS.in_app,
    email: typeof v.email === 'boolean' ? v.email : DEFAULT_CHANNELS.email,
    whatsapp: typeof v.whatsapp === 'boolean' ? v.whatsapp : DEFAULT_CHANNELS.whatsapp,
  };
}

export async function setAutomationChannels(
  businessId: string,
  userId: string,
  reportKey: string,
  channels: AutomationChannels
): Promise<void> {
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      business_id: businessId,
      user_id: userId,
      pref_key: channelsPrefKey(reportKey),
      pref_value: channels,
    },
    { onConflict: 'business_id,user_id,pref_key' }
  );
  if (error) throw new Error(error.message);
}
