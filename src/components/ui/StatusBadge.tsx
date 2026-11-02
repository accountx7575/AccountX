import { cn } from '@/lib/utils';

export type DocStatus =
  | 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'cancelled'
  | 'issued' | 'confirmed' | 'received' | 'partially_paid' | 'paid' | 'overdue'
  | 'open' | 'closed' | 'void' | string;

const statusTones: Record<string, { tone: string; label?: string }> = {
  draft: { tone: 'tone-neutral' },
  sent: { tone: 'tone-info' },
  issued: { tone: 'tone-info' },
  open: { tone: 'tone-info' },
  accepted: { tone: 'tone-success' },
  confirmed: { tone: 'tone-success' },
  received: { tone: 'tone-success', label: 'Received' },
  paid: { tone: 'tone-success' },
  partially_paid: { tone: 'tone-warning', label: 'Partially Paid' },
  overdue: { tone: 'tone-error' },
  rejected: { tone: 'tone-error' },
  cancelled: { tone: 'tone-error', label: 'Cancelled' },
  void: { tone: 'tone-error', label: 'Void' },
  converted: { tone: 'primary' },
  closed: { tone: 'tone-neutral' },
};

function humanize(s: string) {
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Single source of truth for document-status badges across all list pages. */
export function StatusBadge({ status, className }: { status: DocStatus; className?: string }) {
  const key = String(status ?? '').toLowerCase();
  const entry = statusTones[key];
  const tone = entry?.tone === 'primary' ? undefined : entry?.tone ?? 'tone-neutral';
  const label = entry?.label ?? humanize(key || '—');

  if (entry?.tone === 'primary') {
    return (
      <span className={cn('badge bg-gradient-to-br from-indigo-500 to-violet-600 text-white border-transparent shrink-0', className)}>{label}</span>
    );
  }

  return (
    <span className={cn('badge border', tone, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
      {label}
    </span>
  );
}
