import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Mail, MessageCircle, Bell } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { Tooltip } from '@/components/ui/Tooltip';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { can, capabilityTooltip } from '@/lib/rbac';
import { commsKeys, listTemplates, updateTemplate, type NotificationTemplateRow } from '@/lib/comms/api';

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: 'Email', icon: Mail },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  in_app: { label: 'In-app', icon: Bell },
};

export function MessageTemplatesPanel() {
  const { activeBusiness, activeRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = can(activeRole, 'settings.edit');

  const [editing, setEditing] = useState<NotificationTemplateRow | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const templatesQuery = useQuery({
    queryKey: commsKeys.templates(activeBusiness?.id),
    queryFn: () => listTemplates(activeBusiness!.id),
    enabled: !!activeBusiness,
  });

  const grouped = useMemo(() => {
    const byKey = new Map<string, NotificationTemplateRow[]>();
    for (const t of templatesQuery.data || []) {
      const arr = byKey.get(t.key) || [];
      arr.push(t);
      byKey.set(t.key, arr);
    }
    return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [templatesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateTemplate(editing!.id, { subject: draftSubject.trim() || null, body: draftBody }),
    onSuccess: () => {
      toast('Template saved — future sends use the updated wording', 'success');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: commsKeys.templates(activeBusiness?.id) });
    },
    onError: (err: Error) => toast(err.message || 'Could not save template', 'error'),
  });

  const openEdit = (t: NotificationTemplateRow) => {
    setEditing(t);
    setDraftSubject(t.subject || '');
    setDraftBody(t.body);
  };

  const insertVar = (name: string) => {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) {
      setDraftBody((b) => `${b}${token}`);
      return;
    }
    const start = el.selectionStart ?? draftBody.length;
    const end = el.selectionEnd ?? draftBody.length;
    setDraftBody(`${draftBody.slice(0, start)}${token}${draftBody.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-secondary-400">
        Seeded defaults are real rows you can edit — every send (dialog, reminders, scheduled reports) reads these live. A reset-to-default action is not available yet; keep a copy before heavy edits.
      </p>

      {templatesQuery.isError ? (
        <ErrorState title="Templates unavailable" message="The template engine is not reachable yet." onRetry={() => templatesQuery.refetch()} />
      ) : templatesQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState icon={FileText} title="No templates yet" description="Template rows appear once the business is seeded." />
      ) : (
        <ul className="divide-y divide-secondary-100 dark:divide-secondary-800 rounded-xl border border-secondary-200 dark:border-secondary-800 overflow-hidden">
          {grouped.map(([key, rows]) => (
            <li key={key} className="px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-secondary-50/60 dark:hover:bg-secondary-800/30 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 font-mono">{key}</p>
                <p className="text-xs text-secondary-400 truncate">{rows[0]?.subject || rows[0]?.body.slice(0, 80)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {rows.map((t) => {
                  const meta = CHANNEL_META[t.channel] || CHANNEL_META.email;
                  return (
                    <Tooltip key={t.id} label={`${meta.label}: ${t.is_active ? 'active' : 'inactive'}`}>
                      <button
                        type="button"
                        onClick={() => canEdit && openEdit(t)}
                        disabled={!canEdit}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                          t.channel === 'email'
                            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                            : t.channel === 'whatsapp'
                              ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300'
                              : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300'
                        } ${canEdit ? 'hover:ring-2 hover:ring-primary-300 cursor-pointer' : 'cursor-default opacity-80'}`}
                      >
                        <meta.icon className="h-3 w-3" /> {meta.label}
                        <Pencil className="h-2.5 w-2.5 opacity-60" />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!canEdit && (
        <p className="text-xs text-secondary-400">{capabilityTooltip('settings.edit', activeRole)} — templates are read-only for you.</p>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit template — ${editing?.key ?? ''}`} size="lg">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="info">{editing?.channel.replace('_', '-')}</Badge>
            {(editing?.variables || []).map((v) => (
              <span key={v} className="rounded bg-secondary-100 dark:bg-secondary-800 px-1.5 py-0.5 text-[10px] font-mono text-secondary-500">{`{{${v}}}`}</span>
            ))}
          </div>
          <FormField label="Subject">
            <Input value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} placeholder="Message subject" />
          </FormField>
          <FormField label="Body">
            <Textarea ref={bodyRef} rows={8} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} />
            {(editing?.variables || []).length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-secondary-400 mr-1">Insert variable:</span>
                {(editing?.variables || []).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    className="rounded-full border border-secondary-200 dark:border-secondary-700 px-2 py-0.5 text-xs font-mono text-secondary-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            )}
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!draftBody.trim()}>
              Save template
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
