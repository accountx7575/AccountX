import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, Eye, RotateCcw, Ban, RefreshCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { DatePicker } from '@/components/common/DatePicker';
import {
  commsKeys,
  listNotificationLogs,
  retryNotification,
  cancelNotification,
  type NotificationLogRow,
} from '@/lib/comms/api';
import { formatDateTime } from '@/lib/utils';

const STATUS_OPTIONS = ['pending', 'processing', 'sent', 'failed', 'cancelled'];
const CHANNEL_LABELS: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', in_app: 'In-app' };
const DOC_TYPE_LABELS: Record<string, string> = {
  sales_invoice: 'Invoice',
  quotation: 'Quotation',
  sales_order: 'Sales order',
  purchase_order: 'Purchase order',
  payment_receipt: 'Receipt',
  statement: 'Statement',
  report: 'Report',
  reminder: 'Reminder',
  custom: 'Custom',
};

function referenceLabel(row: NotificationLogRow): string {
  if (row.doc_type === 'sales_invoice' && row.subject) return row.subject;
  if (row.template_key) return row.template_key.replace(/_/g, ' ');
  return DOC_TYPE_LABELS[row.doc_type || ''] || '—';
}

export function CommunicationsPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const refFilter = searchParams.get('ref') || '';

  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState<NotificationLogRow | null>(null);

  const logsQuery = useQuery({
    queryKey: [...commsKeys.logs(activeBusiness?.id), { channel, status, from, to }],
    queryFn: () => listNotificationLogs(activeBusiness!.id, { channel, status, from, to }),
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: commsKeys.logs(activeBusiness?.id) });

  const retryMutation = useMutation({
    mutationFn: (logId: string) => retryNotification(logId),
    onSuccess: () => {
      toast('Queued for retry', 'success');
      invalidate();
    },
    onError: (err: Error) => toast(err.message || 'Retry failed', 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: (logId: string) => cancelNotification(logId),
    onSuccess: () => {
      toast('Notification cancelled', 'success');
      invalidate();
    },
    onError: (err: Error) => toast(err.message || 'Cancel failed', 'error'),
  });

  const resendMutation = useMutation({
    mutationFn: async (row: NotificationLogRow) => {
      if (!activeBusiness) throw new Error('No active business');
      const { error } = await supabase.from('notification_logs').insert({
        business_id: activeBusiness.id,
        channel: row.channel,
        template_key: row.template_key,
        recipient_type: row.recipient_type || 'custom',
        recipient_ref: row.recipient_ref,
        recipient_address: row.recipient_address,
        subject: row.subject,
        body: row.body,
        attachment_name: row.attachment_name,
        doc_type: row.doc_type,
        doc_id: row.doc_id,
        status: 'pending',
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast('Copied as a fresh pending notification', 'success');
      invalidate();
    },
    onError: (err: Error) => toast(err.message || 'Resend failed', 'error'),
  });

  const filtered = useMemo(() => {
    const q = refFilter.trim().toLowerCase();
    if (!q) return logsQuery.data || [];
    return (logsQuery.data || []).filter(
      (r) =>
        (r.subject || '').toLowerCase().includes(q) ||
        (r.template_key || '').toLowerCase().includes(q) ||
        r.recipient_address.toLowerCase().includes(q)
    );
  }, [logsQuery.data, refFilter]);

  return (
    <div>
      <PageHeader
        title="Communications"
        subtitle="Delivery history for every email and WhatsApp message AccountX sends"
        actions={
          <Button variant="secondary" onClick={() => logsQuery.refetch()} loading={logsQuery.isFetching}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-wrap items-end gap-3">
          <FormField label="Channel">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-36">
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="in_app">In-app</option>
            </Select>
          </FormField>
          <FormField label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((sOpt) => (
                <option key={sOpt} value={sOpt}>{sOpt.replace('_', ' ')}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="From">
            <DatePicker value={from || undefined} onChange={(iso) => setFrom(iso)} clearable placeholder="Any time" />
          </FormField>
          <FormField label="To">
            <DatePicker value={to || undefined} onChange={(iso) => setTo(iso)} clearable placeholder="Today" max={to || undefined} />
          </FormField>
          {refFilter && (
            <p className="text-xs text-secondary-400 pb-2">Filtered by reference “{refFilter}”</p>
          )}
        </div>

        {refFilter && (
          <div className="px-4 pt-3 -mb-1 text-xs text-secondary-400">
            Reference filtering matches subject, template key or recipient on this page.
          </div>
        )}

        {logsQuery.isError ? (
          <ErrorState title="History unavailable" message="The delivery ledger is not reachable yet." onRetry={() => logsQuery.refetch()} />
        ) : logsQuery.isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No notifications yet"
            description="Sends from invoices, receipts, reminders, statements and reports appear here."
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Recipient</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Channel</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Type</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Reference</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Provider</th>
                  <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Sent at</th>
                  <th className="text-left px-4 py-3 font-medium hidden 2xl:table-cell">Failure reason</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-secondary-500">{formatDateTime(r.created_at)}</td>
                    <td className="px-4 py-3 max-w-[16rem]">
                      <span className="block truncate text-secondary-900 dark:text-secondary-100" title={r.recipient_address}>{r.recipient_address}</span>
                      {r.recipient_type && r.recipient_type !== 'custom' && (
                        <span className="text-xs text-secondary-400 capitalize">{r.recipient_type}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-600 dark:text-secondary-300">{CHANNEL_LABELS[r.channel] || r.channel}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-secondary-600 dark:text-secondary-300 capitalize">{DOC_TYPE_LABELS[r.doc_type || ''] || r.doc_type?.replace(/_/g, ' ') || '—'}</td>
                    <td className="px-4 py-3 hidden lg:table-cell max-w-[14rem]"><span className="block truncate" title={r.subject || ''}>{referenceLabel(r)}</span></td>
                    <td className="px-4 py-3">
                      {r.status === 'sent' ? (
                        <Tooltip label="Sent is terminal in v1 — Delivered/Read arrive when provider webhooks are wired up.">
                          <StatusBadge status={r.status} />
                        </Tooltip>
                      ) : (
                        <StatusBadge status={r.status} />
                      )}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-secondary-500">{r.provider || '—'}</td>
                    <td className="px-4 py-3 hidden xl:table-cell whitespace-nowrap text-secondary-500">{r.sent_at ? formatDateTime(r.sent_at) : '—'}</td>
                    <td className="px-4 py-3 hidden 2xl:table-cell max-w-[16rem]"><span className="block truncate text-error-600 dark:text-error-400" title={r.error_message || ''}>{r.error_message || '—'}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Tooltip label="View details">
                          <button onClick={() => setViewing(r)} className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors" aria-label="View notification">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        {r.status === 'failed' && (
                          <Tooltip label="Queue this failed send again">
                            <button
                              onClick={() => retryMutation.mutate(r.id)}
                              disabled={retryMutation.isPending}
                              className="p-1.5 rounded-md text-secondary-400 hover:text-warning-600 hover:bg-warning-50 dark:hover:bg-warning-900/30 transition-colors"
                              aria-label="Retry notification"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        )}
                        {(r.status === 'pending' || r.status === 'failed') && (
                          <Tooltip label="Cancel this pending/failed send">
                            <button
                              onClick={() => cancelMutation.mutate(r.id)}
                              disabled={cancelMutation.isPending}
                              className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                              aria-label="Cancel notification"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        )}
                        {r.status !== 'pending' && (
                          <Tooltip label="Send an identical copy now">
                            <button
                              onClick={() => resendMutation.mutate(r)}
                              disabled={resendMutation.isPending}
                              className="p-1.5 rounded-md text-secondary-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30 transition-colors"
                              aria-label="Resend copy"
                            >
                              <RotateCcw className="h-3.5 w-3.5 rotate-180" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Notification details" size="md">
        {viewing && (
          <dl className="space-y-2.5 text-sm">
            {[
              ['Status', viewing.status],
              ['Channel', CHANNEL_LABELS[viewing.channel] || viewing.channel],
              ['Recipient', viewing.recipient_address],
              ['Recipient type', viewing.recipient_type || 'custom'],
              ['Template key', viewing.template_key || '—'],
              ['Document type', DOC_TYPE_LABELS[viewing.doc_type || ''] || viewing.doc_type || '—'],
              ['Attachment', viewing.attachment_name || '—'],
              ['Provider', viewing.provider || '—'],
              ['Provider message id', viewing.provider_message_id || '—'],
              ['Retry count', String(viewing.retry_count)],
              ['Created', formatDateTime(viewing.created_at)],
              ['Sent at', viewing.sent_at ? formatDateTime(viewing.sent_at) : '—'],
              ['Failure reason', viewing.error_message || '—'],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-secondary-400">{k}</dt>
                <dd className="text-secondary-900 dark:text-secondary-100 break-words min-w-0">{v}</dd>
              </div>
            ))}
            {viewing.body && (
              <div className="pt-2">
                <dt className="text-secondary-400 mb-1">Body</dt>
                <dd className="rounded-lg bg-secondary-50 dark:bg-secondary-800/50 p-3 text-secondary-700 dark:text-secondary-200 whitespace-pre-wrap break-words">{viewing.body}</dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </div>
  );
}
