import { useState } from 'react';
import { LifeBuoy, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import {
  createSupportTicket,
  TICKET_PRIORITIES,
  type TicketPriority,
} from '@/lib/supportTicketsStore';

const priorityStyles: Record<TicketPriority, string> = {
  low: 'bg-secondary-100 text-secondary-700 border border-secondary-200',
  normal: 'bg-blue-50 text-blue-700 border border-blue-200',
  high: 'bg-amber-50 text-amber-700 border border-amber-200',
  urgent: 'bg-rose-50 text-rose-700 border border-rose-200',
};

const priorityLabels: Record<TicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

type ReportIssueModalProps = {
  open: boolean;
  onClose: () => void;
};

export function ReportIssueModal({ open, onClose }: ReportIssueModalProps) {
  const { user, activeBusiness } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [error, setError] = useState('');

  if (!open) return null;

  const submit = () => {
    setError('');
    if (!message.trim() || message.trim().length < 10) {
      setError('Describe the issue in at least 10 characters so support can act on it.');
      return;
    }
    const business = activeBusiness as unknown as Record<string, unknown> | null;
    createSupportTicket({
      message: message.trim(),
      priority,
      user: {
        name: (user?.user_metadata?.name as string) || user?.email || 'Unknown',
        email: user?.email || 'unknown@accountx.app',
        businessId: business?.id ? String(business.id) : '',
        businessName: (business?.legal_name as string) || (business?.name as string) || '—',
      },
    });
    setMessage('');
    setPriority('normal');
    toast('Issue reported — support will follow up', 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report an issue"
        className="relative w-full max-w-lg card-solid rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 p-2.5">
              <LifeBuoy className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Report an Issue</h3>
              <p className="text-xs text-zinc-400">Goes straight to the AccountX support desk.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="report-issue-message" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              What went wrong?
            </label>
            <textarea
              id="report-issue-message"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue — what you did, what you expected, what happened instead."
              className="mt-1 w-full rounded-xl bg-zinc-100/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 p-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all resize-none"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Priority</p>
            <div className="flex gap-2 flex-wrap">
              {TICKET_PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={priority === p}
                  onClick={() => setPriority(p)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${priorityStyles[p]} ${priority === p ? 'ring-2 ring-indigo-500/40' : 'opacity-70 hover:opacity-100'}`}
                >
                  {priorityLabels[p]}
                </button>
              ))}
            </div>
          </div>
          {activeBusiness && (
            <p className="text-[11px] text-zinc-400">
              Filed for <span className="font-medium text-zinc-500 dark:text-zinc-300">
                {(activeBusiness as unknown as Record<string, unknown>).legal_name as string ||
                  (activeBusiness as unknown as Record<string, unknown>).name as string ||
                  'your business'}
              </span>
            </p>
          )}
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={!message.trim()}>Submit Ticket</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
