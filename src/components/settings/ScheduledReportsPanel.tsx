import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { Tooltip } from '@/components/ui/Tooltip';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can, capabilityTooltip } from '@/lib/rbac';
import { REPORT_REGISTRY } from '@/lib/reportsAdapter';
import {
  commsKeys,
  listScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  type ScheduledReportRow,
} from '@/lib/comms/api';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type DraftState = {
  report_key: string;
  recipientsText: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  day_of_week: number;
  day_of_month: number;
  time_of_day: string;
  formatPdf: boolean;
  formatCsv: boolean;
  enabled: boolean;
};

const emptyDraft = (): DraftState => ({
  report_key: REPORT_REGISTRY[0]?.id ?? '',
  recipientsText: '',
  frequency: 'weekly',
  day_of_week: 1,
  day_of_month: 1,
  time_of_day: '08:00',
  formatPdf: true,
  formatCsv: false,
  enabled: true,
});

const draftFromRow = (r: ScheduledReportRow): DraftState => {
  const recipients = Array.isArray(r.recipients) ? (r.recipients as string[]) : [];
  return {
    report_key: r.report_key,
    recipientsText: recipients.join(', '),
    frequency: r.frequency,
    day_of_week: r.day_of_week ?? 1,
    day_of_month: r.day_of_month ?? 1,
    time_of_day: (r.time_of_day || '08:00').slice(0, 5),
    formatPdf: r.formats.includes('pdf'),
    formatCsv: r.formats.includes('csv'),
    enabled: r.enabled,
  };
};

function frequencyLabel(r: ScheduledReportRow): string {
  if (r.frequency === 'daily') return `Daily at ${r.time_of_day.slice(0, 5)}`;
  if (r.frequency === 'weekly')
    return `Weekly · ${DAY_NAMES[r.day_of_week ?? 1]} ${r.time_of_day.slice(0, 5)}`;
  return `Monthly · day ${r.day_of_month ?? 1} at ${r.time_of_day.slice(0, 5)}`;
}

export function ScheduledReportsPanel() {
  const { activeBusiness, activeRole, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can(activeRole, 'settings.edit');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft());

  const schedulesQuery = useQuery({
    queryKey: commsKeys.schedules(activeBusiness?.id),
    queryFn: () => listScheduledReports(activeBusiness!.id),
    enabled: !!activeBusiness,
  });

  const titleFor = (key: string) =>
    REPORT_REGISTRY.find((r) => r.id === key)?.title || key;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: commsKeys.schedules(activeBusiness?.id) });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const recipients = draft.recipientsText
        .split(/[,\s;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const bad = recipients.find((x) => !EMAIL_RE.test(x));
      if (bad) throw new Error(`"${bad}" is not a valid email address.`);
      if (recipients.length === 0) throw new Error('Add at least one recipient.');
      const formats = [draft.formatPdf && 'pdf', draft.formatCsv && 'csv'].filter(Boolean) as string[];
      if (formats.length === 0) throw new Error('Pick at least one format (PDF or CSV).');
      const input = {
        report_key: draft.report_key,
        recipients,
        frequency: draft.frequency,
        day_of_week: draft.frequency === 'weekly' ? draft.day_of_week : null,
        day_of_month: draft.frequency === 'monthly' ? draft.day_of_month : null,
        time_of_day: `${draft.time_of_day}:00`,
        formats,
        enabled: draft.enabled,
      };
      if (editingId) await updateScheduledReport(editingId, input);
      else await createScheduledReport(activeBusiness!.id, user?.id, input);
    },
    onSuccess: () => {
      toast(editingId ? 'Schedule updated' : 'Report scheduled', 'success');
      setModalOpen(false);
      invalidate();
    },
    onError: (err: Error) => toast(err.message || 'Could not save schedule', 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ row, enabled }: { row: ScheduledReportRow; enabled: boolean }) =>
      updateScheduledReport(row.id, { enabled }),
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast(err.message || 'Could not update schedule', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteScheduledReport(id),
    onSuccess: () => {
      toast('Schedule removed', 'success');
      invalidate();
    },
    onError: (err: Error) => toast(err.message || 'Could not remove schedule', 'error'),
  });

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalOpen(true);
  };
  const openEdit = (row: ScheduledReportRow) => {
    setEditingId(row.id);
    setDraft(draftFromRow(row));
    setModalOpen(true);
  };

  const rows = schedulesQuery.data || [];
  const cronBanner = useMemo(
    () => (
      <div className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 p-3 text-sm text-warning-800 dark:text-warning-300">
        Schedules are stored here, but execution requires the <span className="font-mono text-xs">report-scheduler</span> edge function to be deployed and run on cron:
        <code className="block mt-1.5 rounded bg-zinc-950 text-zinc-100 text-xs px-2.5 py-1.5 overflow-x-auto whitespace-nowrap">
          supabase functions deploy report-scheduler
        </code>
        Until then nothing is sent — rows stay safely pending.
      </div>
    ),
    []
  );

  return (
    <div className="space-y-3">
      {cronBanner}

      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate} disabled={!canEdit} title={canEdit ? undefined : capabilityTooltip('settings.edit', activeRole)}>
          <Plus className="h-4 w-4" /> New scheduled report
        </Button>
      </div>

      {schedulesQuery.isError ? (
        <ErrorState title="Schedules unavailable" message="The scheduling engine is not reachable yet." onRetry={() => schedulesQuery.refetch()} />
      ) : schedulesQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No scheduled reports" description="Automate a recurring report delivery to stakeholders." />
      ) : (
        <ul className="divide-y divide-secondary-100 dark:divide-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-800 overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-secondary-50/60 dark:hover:bg-secondary-800/30 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{titleFor(r.report_key)}</p>
                <p className="text-xs text-secondary-400 truncate">
                  {frequencyLabel(r)} → {(Array.isArray(r.recipients) ? (r.recipients as string[]) : []).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {(r.formats || []).map((f) => (
                  <Badge key={f} variant="neutral">{f.toUpperCase()}</Badge>
                ))}
                <Badge variant={r.enabled ? 'success' : 'warning'}>{r.enabled ? 'On' : 'Paused'}</Badge>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-secondary-500 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary-600"
                  checked={r.enabled}
                  disabled={!canEdit || toggleMutation.isPending}
                  onChange={(e) => toggleMutation.mutate({ row: r, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(r)} disabled={!canEdit} title="Edit schedule">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Tooltip label="Remove schedule">
                  <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(r.id)} disabled={!canEdit}>
                    <Trash2 className="h-3.5 w-3.5 text-error-500" />
                  </Button>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!canEdit && (
        <p className="text-xs text-secondary-400">{capabilityTooltip('settings.edit', activeRole)} — scheduling is read-only for you.</p>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit scheduled report' : 'New scheduled report'} size="md">
        <div className="space-y-4">
          <FormField label="Report" required>
            <Select value={draft.report_key} onChange={(e) => setDraft((d) => ({ ...d, report_key: e.target.value }))}>
              {REPORT_REGISTRY.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Recipients (comma-separated emails)" required>
            <Input
              value={draft.recipientsText}
              onChange={(e) => setDraft((d) => ({ ...d, recipientsText: e.target.value }))}
              placeholder="owner@business.com, ca@firm.com"
            />
          </FormField>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <FormField label="Frequency">
              <Select value={draft.frequency} onChange={(e) => setDraft((d) => ({ ...d, frequency: e.target.value as DraftState['frequency'] }))}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </FormField>
            {draft.frequency === 'weekly' && (
              <FormField label="Day">
                <Select value={String(draft.day_of_week)} onChange={(e) => setDraft((d) => ({ ...d, day_of_week: Number(e.target.value) }))}>
                  {DAY_NAMES.map((n, i) => (
                    <option key={n} value={i}>{n}</option>
                  ))}
                </Select>
              </FormField>
            )}
            {draft.frequency === 'monthly' && (
              <FormField label="Day of month">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.day_of_month}
                  onChange={(e) => setDraft((d) => ({ ...d, day_of_month: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))}
                />
              </FormField>
            )}
            <FormField label="Time">
              <Input type="time" value={draft.time_of_day} onChange={(e) => setDraft((d) => ({ ...d, time_of_day: e.target.value }))} />
            </FormField>
          </div>
          <div>
            <span className="label mb-1.5 block">Formats</span>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="accent-primary-600" checked={draft.formatPdf} onChange={(e) => setDraft((x) => ({ ...x, formatPdf: e.target.checked }))} /> PDF
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" className="accent-primary-600" checked={draft.formatCsv} onChange={(e) => setDraft((x) => ({ ...x, formatCsv: e.target.checked }))} /> CSV
              </label>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-secondary-600 dark:text-secondary-300 cursor-pointer">
            <input type="checkbox" className="accent-primary-600" checked={draft.enabled} onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            Enabled (paused schedules keep their config but never send)
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
              {editingId ? 'Save changes' : 'Create schedule'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
