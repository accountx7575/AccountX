import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageCircle, Info, Save, Send, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Tooltip } from '@/components/ui/Tooltip';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can, capabilityTooltip } from '@/lib/rbac';
import {
  sendNotification,
  normalizePhoneE164,
} from '@/lib/comms/client';
import {
  commsKeys,
  fetchCommunicationSettings,
  saveCommunicationSettings,
  getAutoRemindersEnabled,
  setAutoRemindersEnabled,
  type CommunicationSettingsView,
} from '@/lib/comms/api';

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
        checked ? 'bg-primary-600' : 'bg-secondary-300 dark:bg-secondary-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const EMAIL_SECRETS = [
  { cmd: 'supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx', note: 'Resend API key (email provider)' },
];
const WHATSAPP_SECRETS = [
  { cmd: 'supabase secrets set WHATSAPP_TOKEN=EAAG...', note: 'Meta Cloud permanent access token' },
  { cmd: 'supabase secrets set WHATSAPP_PHONE_NUMBER_ID=1234567890', note: 'Phone number id (shown above once configured)' },
];

export function CommunicationCenterPanel() {
  const { activeBusiness, activeRole, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can(activeRole, 'settings.edit');

  const [emailForm, setEmailForm] = useState<Partial<CommunicationSettingsView>>({});
  const [waForm, setWaForm] = useState<Partial<CommunicationSettingsView>>({});
  const [showEmailInfo, setShowEmailInfo] = useState(false);
  const [showWaInfo, setShowWaInfo] = useState(false);
  const [testChannel, setTestChannel] = useState<'email' | 'whatsapp'>('email');
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>('');

  const settingsQuery = useQuery({
    queryKey: commsKeys.settings(activeBusiness?.id),
    queryFn: () => fetchCommunicationSettings(activeBusiness!.id),
    enabled: !!activeBusiness,
  });

  const prefsQuery = useQuery({
    queryKey: commsKeys.prefs(activeBusiness?.id, user?.id),
    queryFn: () => getAutoRemindersEnabled(activeBusiness!.id, user!.id),
    enabled: !!activeBusiness && !!user,
  });

  const savePrefs = useMutation({
    mutationFn: (v: boolean) => setAutoRemindersEnabled(activeBusiness!.id, user!.id, v),
    onSuccess: (_d, v) => {
      toast(v ? 'Automatic reminders on' : 'Automatic reminders off', 'success');
      queryClient.invalidateQueries({ queryKey: commsKeys.prefs(activeBusiness?.id, user?.id) });
    },
    onError: (err: Error) => toast(err.message || 'Could not save preference', 'error'),
  });

  const saveSettings = useMutation({
    mutationFn: () => {
      const current = settingsQuery.data!;
      return saveCommunicationSettings(activeBusiness!.id, {
        email_provider: emailForm.email_provider ?? current.email_provider ?? 'resend',
        email_from_address: emailForm.email_from_address ?? current.email_from_address,
        email_configured: emailForm.email_configured ?? current.email_configured,
        whatsapp_provider: waForm.whatsapp_provider ?? current.whatsapp_provider ?? 'meta_cloud',
        whatsapp_phone_number_id: waForm.whatsapp_phone_number_id ?? current.whatsapp_phone_number_id,
        whatsapp_configured: waForm.whatsapp_configured ?? current.whatsapp_configured,
      });
    },
    onSuccess: () => {
      setEmailForm({});
      setWaForm({});
      toast('Communication settings saved', 'success');
      queryClient.invalidateQueries({ queryKey: commsKeys.settings(activeBusiness?.id) });
    },
    onError: (err: Error) => toast(err.message || 'Could not save communication settings', 'error'),
  });

  const runTest = async () => {
    if (!activeBusiness) return;
    const value = testTo.trim();
    setTesting(true);
    setTestResult('');
    try {
      if (testChannel === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
      } else if (!normalizePhoneE164(value)) {
        throw new Error('Enter a usable phone number.');
      }
      const resp = await sendNotification({
        business_id: activeBusiness.id,
        channel: testChannel,
        recipient:
          testChannel === 'email'
            ? { to: value }
            : { phone_e164: normalizePhoneE164(value) },
        subject: 'AccountX test notification',
        body_text: 'This is a test notification sent from AccountX → Settings → Notifications & Communication. If you can read this, your provider is live.',
      });
      setTestResult(
        resp.ok
          ? `Sent${resp.duplicate ? ' (duplicate suppressed)' : ''}. Provider ref: ${resp.provider_message_id || 'n/a'}`
          : `${resp.code}: ${resp.message}`
      );
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const s = settingsQuery.data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-secondary-200 dark:border-secondary-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2">
              <Mail className="h-4.5 w-4.5 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Email</h4>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Transactional email delivery</p>
            </div>
            <span className="ml-auto">
              {settingsQuery.isLoading ? (
                <span className="h-5 w-28 rounded bg-secondary-100 dark:bg-secondary-800 animate-pulse block" />
              ) : s?.email_configured ? (
                <Badge variant="success">CONFIGURED</Badge>
              ) : (
                <Badge variant="warning">NOT CONFIGURED</Badge>
              )}
            </span>
          </div>
          {settingsQuery.isError ? (
            <ErrorState title="Settings unavailable" message="The communication settings engine is not reachable yet." onRetry={() => settingsQuery.refetch()} />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Provider">
                  <Select
                    value={emailForm.email_provider ?? s?.email_provider ?? 'resend'}
                    onChange={(e) => setEmailForm((f) => ({ ...f, email_provider: e.target.value }))}
                    disabled={!canEdit || settingsQuery.isLoading}
                  >
                    <option value="resend">Resend</option>
                    <option value="smtp">SMTP</option>
                  </Select>
                </FormField>
                <FormField label="From address">
                  <Input
                    value={emailForm.email_from_address ?? s?.email_from_address ?? ''}
                    onChange={(e) => setEmailForm((f) => ({ ...f, email_from_address: e.target.value }))}
                    placeholder="billing@yourbusiness.com"
                    disabled={!canEdit || settingsQuery.isLoading}
                  />
                </FormField>
              </div>
              <label className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-300">
                <input
                  type="checkbox"
                  className="accent-primary-600"
                  checked={emailForm.email_configured ?? s?.email_configured ?? false}
                  disabled={!canEdit}
                  onChange={(e) => setEmailForm((f) => ({ ...f, email_configured: e.target.checked }))}
                />
                Mark email as configured{' '}
                <Tooltip label="Tick this ONLY after the provider secret has been set on the server (see commands). Nothing else changes — no secret is ever stored here.">
                  <Info className="h-3.5 w-3.5 text-secondary-400" />
                </Tooltip>
              </label>
              <button
                type="button"
                onClick={() => setShowEmailInfo((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                aria-expanded={showEmailInfo}
              >
                <Info className="h-3.5 w-3.5" /> Server setup commands
              </button>
              {showEmailInfo && (
                <div className="rounded-lg bg-zinc-950 text-zinc-100 p-3 space-y-2 overflow-x-auto">
                  {EMAIL_SECRETS.map((x) => (
                    <div key={x.cmd}>
                      <code className="text-xs whitespace-nowrap">{x.cmd}</code>
                      <p className="text-[10px] text-zinc-400">{x.note}</p>
                    </div>
                  ))}
                  <p className="text-[10px] text-zinc-400">Secrets live only in Edge Function env — they are never written to the database.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-secondary-200 dark:border-secondary-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-success-100 dark:bg-success-900/30 p-2">
              <MessageCircle className="h-4.5 w-4.5 text-success-600 dark:text-success-400" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">WhatsApp</h4>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Meta Cloud API messaging</p>
            </div>
            <span className="ml-auto">
              {settingsQuery.isLoading ? (
                <span className="h-5 w-28 rounded bg-secondary-100 dark:bg-secondary-800 animate-pulse block" />
              ) : s?.whatsapp_configured ? (
                <Badge variant="success">CONFIGURED</Badge>
              ) : (
                <Badge variant="warning">NOT CONFIGURED</Badge>
              )}
            </span>
          </div>
          {settingsQuery.isError ? null : (
            <div className="space-y-3">
              <FormField label="Phone number id">
                <Input
                  value={waForm.whatsapp_phone_number_id ?? s?.whatsapp_phone_number_id ?? ''}
                  onChange={(e) => setWaForm((f) => ({ ...f, whatsapp_phone_number_id: e.target.value }))}
                  placeholder="123456789012345"
                  disabled={!canEdit || settingsQuery.isLoading}
                />
              </FormField>
              <label className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-300">
                <input
                  type="checkbox"
                  className="accent-primary-600"
                  checked={waForm.whatsapp_configured ?? s?.whatsapp_configured ?? false}
                  disabled={!canEdit}
                  onChange={(e) => setWaForm((f) => ({ ...f, whatsapp_configured: e.target.checked }))}
                />
                Mark WhatsApp as configured{' '}
                <Tooltip label="Tick this ONLY after WHATSAPP_TOKEN has been set on the server (see commands). The token itself is never stored or shown here.">
                  <Info className="h-3.5 w-3.5 text-secondary-400" />
                </Tooltip>
              </label>
              <button
                type="button"
                onClick={() => setShowWaInfo((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                aria-expanded={showWaInfo}
              >
                <Info className="h-3.5 w-3.5" /> Server setup commands
              </button>
              {showWaInfo && (
                <div className="rounded-lg bg-zinc-950 text-zinc-100 p-3 space-y-2 overflow-x-auto">
                  {WHATSAPP_SECRETS.map((x) => (
                    <div key={x.cmd}>
                      <code className="text-xs whitespace-nowrap">{x.cmd}</code>
                      <p className="text-[10px] text-zinc-400">{x.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!canEdit && (
        <p className="text-xs text-secondary-400">{capabilityTooltip('settings.edit', activeRole)} — values are read-only for you.</p>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <Button
            onClick={() => saveSettings.mutate()}
            loading={saveSettings.isPending}
            disabled={settingsQuery.isLoading || Object.keys(emailForm).length + Object.keys(waForm).length === 0}
          >
            <Save className="h-4 w-4" /> Save configuration
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-secondary-200 dark:border-secondary-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Send className="h-4 w-4 text-secondary-400" />
          <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Send test message</h4>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Channel">
            <Select value={testChannel} onChange={(e) => { setTestChannel(e.target.value as 'email' | 'whatsapp'); setTestResult(''); }}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </Select>
          </FormField>
          <FormField label="Recipient">
            <Input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={testChannel === 'email' ? 'you@example.com' : '+91 98765 43210'}
              className="w-64"
            />
          </FormField>
          <Button variant="secondary" loading={testing} onClick={() => void runTest()} disabled={!testTo.trim()}>
            Send test
          </Button>
        </div>
        {testResult && (
          <p
            role="status"
            className={`mt-3 text-sm rounded-lg border p-3 ${
              testResult.startsWith('Sent')
                ? 'border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20 text-success-800 dark:text-success-300'
                : 'border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 text-warning-800 dark:text-warning-300'
            }`}
          >
            {testResult}
            {!testResult.startsWith('Sent') && ' Configure a provider above, then retry.'}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-secondary-200 dark:border-secondary-800 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Settings2 className="h-4 w-4 text-secondary-400" />
          <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Notification preferences</h4>
        </div>
        <div className="flex items-center gap-3 py-1">
          <Toggle
            checked={prefsQuery.data ?? false}
            onChange={(v) => savePrefs.mutate(v)}
            disabled={savePrefs.isPending}
            label="Automatic payment reminders"
          />
          <div>
            <p className="text-sm text-secondary-700 dark:text-secondary-200">Automatic payment reminders</p>
            <p className="text-xs text-secondary-400">
              Let AccountX queue overdue-invoice reminders automatically. Default OFF — nothing is ever sent without you asking.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
