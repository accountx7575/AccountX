import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Mail,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Send,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/context/AuthContext';
import {
  sendNotification,
  mergeTemplate,
  normalizePhoneE164,
  COMM_ERROR_COPY,
  type CommErrorCode,
  type CommResponse,
} from '@/lib/comms/client';
import { getTemplateForKey, type NotificationTemplateRow } from '@/lib/comms/api';

export type SendDialogChannel = 'email' | 'whatsapp';

export interface SendRecipientOption {
  label: string;
  detail?: string;
  email?: string | null;
  phone?: string | null;
}

export interface SendAttachmentSpec {
  id: string;
  label: string;
  filename: string;
  build: () => Promise<Blob>;
}

export interface SendDialogProps {
  open: boolean;
  onClose: () => void;
  contextLabel: string;
  docType: string;
  docId?: string;
  docNumber?: string;
  templateKey?: string;
  templateVariables?: Record<string, unknown>;
  defaultSubject?: string;
  defaultMessage?: string;
  recipients: SendRecipientOption[];
  attachments?: SendAttachmentSpec[];
  categoryChip?: string;
  categoryTone?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  onSent?: (resp: Extract<CommResponse, { ok: true }>) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SendOutcome =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; providerMessageId: string; duplicate: boolean }
  | { kind: 'not-configured'; message: string }
  | { kind: 'failed'; code: CommErrorCode | 'LOCAL_VALIDATION'; message: string };

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function SendDialog({
  open,
  onClose,
  contextLabel,
  docType,
  docId,
  docNumber,
  templateKey,
  templateVariables,
  defaultSubject,
  defaultMessage,
  recipients,
  attachments = [],
  categoryChip,
  categoryTone = 'neutral',
  onSent,
}: SendDialogProps) {
  const { activeBusiness } = useAuth();
  const [channel, setChannel] = useState<SendDialogChannel>('email');
  const [recipientMode, setRecipientMode] = useState<number>(recipients.length > 0 ? 0 : -1);
  const [customValue, setCustomValue] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [attachmentId, setAttachmentId] = useState<string>('');
  const [outcome, setOutcome] = useState<SendOutcome>({ kind: 'idle' });
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const contactable = useMemo(
    () =>
      recipients.filter((r) => (channel === 'email' ? !!r.email : !!r.phone)),
    [recipients, channel]
  );

  useEffect(() => {
    if (!open) return;
    setChannel('email');
    setRecipientMode(contactable.length > 0 ? 0 : -1);
    setCustomValue('');
    setAttachmentId(attachments.length > 0 ? attachments[0].id : '');
    setOutcome({ kind: 'idle' });
  }, [open]);

  useEffect(() => {
    if (!open || !activeBusiness) return;
    let cancelled = false;
    (async () => {
      let nextSubject = defaultSubject || '';
      let nextBody = defaultMessage || '';
      let variables: string[] = [];
      if (templateKey) {
        try {
          const row: NotificationTemplateRow | null = await getTemplateForKey(
            activeBusiness.id,
            templateKey,
            channel
          );
          if (!cancelled && row) {
            nextSubject = mergeTemplate(row.subject || '', templateVariables || {});
            nextBody = mergeTemplate(row.body, templateVariables || {});
            variables = row.variables || [];
          }
        } catch {
          if (!cancelled && !nextBody) {
            nextBody = '';
          }
        }
      }
      if (cancelled) return;
      setSubject(nextSubject);
      setBodyText(nextBody);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel, activeBusiness?.id]);

  const paletteVars = useMemo(() => {
    const keys = new Set(Object.keys(templateVariables || {}));
    return [...keys];
  }, [templateVariables]);

  const insertVar = (name: string) => {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) {
      setBodyText((b) => `${b}${token}`);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    const next = `${bodyText.slice(0, start)}${token}${bodyText.slice(end)}`;
    setBodyText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const previewBody = useMemo(
    () => mergeTemplate(bodyText, templateVariables || {}),
    [bodyText, templateVariables]
  );
  const previewSubject = useMemo(
    () => mergeTemplate(subject, templateVariables || {}),
    [subject, templateVariables]
  );

  const resolvedRecipient = (): { ok: true; email: string; phoneE164: string } | { ok: false; message: string } => {
    if (recipientMode >= 0 && contactable[recipientMode]) {
      const r = contactable[recipientMode];
      if (channel === 'email') {
        const email = (r.email || '').trim();
        return EMAIL_RE.test(email)
          ? { ok: true, email, phoneE164: '' }
          : { ok: false, message: `The email saved on ${r.label} looks invalid.` };
      }
      const e164 = normalizePhoneE164(r.phone || '');
      return e164
        ? { ok: true, email: '', phoneE164: e164 }
        : { ok: false, message: `The phone number saved on ${r.label} is not usable.` };
    }
    const raw = customValue.trim();
    if (!raw) return { ok: false, message: 'Enter a recipient first.' };
    if (channel === 'email') {
      return EMAIL_RE.test(raw)
        ? { ok: true, email: raw, phoneE164: '' }
        : { ok: false, message: 'That is not a valid email address.' };
    }
    const e164 = normalizePhoneE164(raw);
    return e164
      ? { ok: true, email: '', phoneE164: e164 }
      : { ok: false, message: 'Enter a usable phone number (10-digit Indian numbers get +91 automatically).' };
  };

  const send = async () => {
    if (!activeBusiness) return;
    const rec = resolvedRecipient();
    if (!rec.ok) {
      setOutcome({ kind: 'failed', code: 'LOCAL_VALIDATION', message: rec.message });
      return;
    }
    setOutcome({ kind: 'sending' });
    try {
      const spec = attachments.find((a) => a.id === attachmentId);
      const attachment =
        channel === 'email' && spec
          ? { filename: spec.filename, content_base64: await blobToBase64(await spec.build()) }
          : undefined;
      const idempotencyParts = [
        docType,
        docId || docNumber || '',
        channel,
        channel === 'email' ? rec.email : rec.phoneE164,
        subject.slice(0, 40),
      ].filter(Boolean);
      const resp = await sendNotification({
        business_id: activeBusiness.id,
        channel,
        recipient:
          channel === 'email' ? { to: rec.email } : { phone_e164: rec.phoneE164 },
        subject: subject.trim() || undefined,
        body_text: previewBody,
        attachment,
        doc_type: docType,
        doc_id: docId,
        idempotency_key: idempotencyParts.join(':').slice(0, 200),
      });
      if (resp.ok) {
        setOutcome({
          kind: 'sent',
          providerMessageId: resp.provider_message_id,
          duplicate: resp.duplicate === true,
        });
        onSent?.(resp);
      } else if (resp.code === 'COMM_NOT_CONFIGURED') {
        setOutcome({ kind: 'not-configured', message: resp.message });
      } else {
        setOutcome({ kind: 'failed', code: resp.code, message: resp.message });
      }
    } catch (err) {
      setOutcome({
        kind: 'failed',
        code: 'UPSTREAM_ERROR',
        message: err instanceof Error ? err.message : COMM_ERROR_COPY.UPSTREAM_ERROR,
      });
    }
  };

  const retry = () => {
    setOutcome({ kind: 'idle' });
    void send();
  };

  const sending = outcome.kind === 'sending';

  return (
    <Modal open={open} onClose={onClose} title={`Send — ${contextLabel}`} size="lg">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{docNumber || docType.replace(/_/g, ' ')}</Badge>
          {categoryChip && <Badge variant={categoryTone}>{categoryChip}</Badge>}
          <span className="text-xs text-secondary-400 ml-auto">
            Delivery runs through your configured providers · history in Communications
          </span>
        </div>

        <div>
          <label className="label mb-1.5">Channel</label>
          <div className="flex gap-2" role="radiogroup" aria-label="Send channel">
            {([
              { id: 'email', label: 'Email', icon: Mail },
              { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
            ] as const).map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={channel === c.id}
                onClick={() => {
                  setChannel(c.id);
                  setOutcome({ kind: 'idle' });
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  channel === c.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-300'
                }`}
              >
                <c.icon className="h-4 w-4" /> {c.label}
              </button>
            ))}
          </div>
        </div>

        <FormField label="Recipient" required>
          <div className="space-y-2">
            {contactable.map((r, i) => (
              <label
                key={`${r.label}-${i}`}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  recipientMode === i
                    ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-900/20'
                    : 'border-secondary-200 dark:border-secondary-700'
                }`}
              >
                <input
                  type="radio"
                  name="send-recipient"
                  className="accent-primary-600"
                  checked={recipientMode === i}
                  onChange={() => setRecipientMode(i)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">{r.label}</span>
                  <span className="block text-xs text-secondary-400 truncate">
                    {channel === 'email' ? r.email : r.phone}
                  </span>
                </span>
              </label>
            ))}
            <label
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                recipientMode === -1
                  ? 'border-primary-500 bg-primary-50/60 dark:bg-primary-900/20'
                  : 'border-secondary-200 dark:border-secondary-700'
              }`}
            >
              <input
                type="radio"
                name="send-recipient"
                className="accent-primary-600"
                checked={recipientMode === -1}
                onChange={() => setRecipientMode(-1)}
              />
              <Input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onFocus={() => setRecipientMode(-1)}
                placeholder={channel === 'email' ? 'name@example.com' : '+91 98765 43210'}
                aria-label="Custom recipient"
              />
            </label>
          </div>
        </FormField>

        <FormField label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Message subject" />
        </FormField>

        <FormField label="Message">
          <Textarea
            ref={bodyRef}
            rows={6}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="Write the message…"
          />
          {paletteVars.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-secondary-400 mr-1">Insert variable:</span>
              {paletteVars.map((v) => (
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

        {attachments.length > 0 && (
          <div>
            <label className="label mb-1.5">
              <Paperclip className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
              Attachment (one per message)
            </label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="send-attachment"
                  className="accent-primary-600"
                  checked={attachmentId === ''}
                  onChange={() => setAttachmentId('')}
                />
                <span className="text-secondary-500">No attachment</span>
              </label>
              {attachments.map((a) => (
                <label key={a.id} className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="send-attachment"
                    className="accent-primary-600"
                    checked={attachmentId === a.id}
                    onChange={() => setAttachmentId(a.id)}
                  />
                  <span className="text-secondary-700 dark:text-secondary-200">{a.label}</span>
                  <span className="text-xs text-secondary-400 font-mono truncate">{a.filename}</span>
                </label>
              ))}
              {channel === 'whatsapp' && (
                <p className="text-xs text-secondary-400">
                  WhatsApp document delivery is prepared by the provider adapter when configured.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-secondary-200 dark:border-secondary-800 bg-secondary-50/60 dark:bg-secondary-800/30 p-4">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium mb-2">Preview</p>
          {previewSubject && <p className="text-sm font-semibold text-secondary-900 dark:text-white mb-1">{previewSubject}</p>}
          <p className="text-sm text-secondary-600 dark:text-secondary-300 whitespace-pre-wrap">{previewBody || '—'}</p>
        </div>

        {outcome.kind === 'sent' && (
          <div className="flex items-start gap-2 rounded-lg border border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20 p-3 text-sm text-success-800 dark:text-success-300" role="status">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Sent{outcome.duplicate ? ' (already sent earlier — no duplicate delivered)' : ''}.
              {outcome.providerMessageId && (
                <>
                  {' '}Provider ref <span className="font-mono text-xs">{outcome.providerMessageId.slice(0, 24)}…</span>
                </>
              )}
            </span>
          </div>
        )}
        {outcome.kind === 'not-configured' && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 p-3 text-sm text-warning-800 dark:text-warning-300" role="alert">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {outcome.message || COMM_ERROR_COPY.COMM_NOT_CONFIGURED}{' '}
              <Link to="/app/settings" className="font-semibold underline underline-offset-2">
                Open Settings → Notifications &amp; Communication
              </Link>{' '}
              to configure a provider first.
            </span>
          </div>
        )}
        {outcome.kind === 'failed' && (
          <div className="flex items-start gap-2 rounded-lg border border-error-300 dark:border-error-700 bg-error-50 dark:bg-error-900/20 p-3 text-sm text-error-800 dark:text-error-300" role="alert">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="min-w-0">
              {outcome.code === 'LOCAL_VALIDATION'
                ? outcome.message
                : `${COMM_ERROR_COPY[outcome.code]}${outcome.message && outcome.message !== COMM_ERROR_COPY[outcome.code] ? ` (${outcome.message})` : ''}`}
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {outcome.kind === 'failed' ? (
            <Button onClick={retry}>
              <RotateCcw className="h-4 w-4" /> Retry
            </Button>
          ) : (
            <Button onClick={() => void send()} disabled={sending || outcome.kind === 'sent'} loading={sending}>
              <Send className="h-4 w-4" /> Send
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
