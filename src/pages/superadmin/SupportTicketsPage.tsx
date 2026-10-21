import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LifeBuoy, ArrowLeft, Search, RefreshCw, MessageSquarePlus,
  Circle, Timer, CheckCircle2, StickyNote,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  addTicketAdminNote,
  clearSupportTickets,
  listSupportTickets,
  setTicketStatus,
  SUPPORT_TICKETS_CHANGE_EVENT,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type SupportTicket,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/supportTicketsStore';

const statusMeta: Record<TicketStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  open: { label: 'Open', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900', icon: <Circle className="w-3 h-3" /> },
  in_progress: { label: 'In-Progress', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900', icon: <Timer className="w-3 h-3" /> },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900', icon: <CheckCircle2 className="w-3 h-3" /> },
};

const priorityMeta: Record<TicketPriority, string> = {
  low: 'bg-secondary-100 text-secondary-600 border-secondary-200 dark:bg-secondary-800 dark:text-secondary-300 dark:border-secondary-700',
  normal: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
  high: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  urgent: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
};

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
};

export function SupportTicketsPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TicketPriority>('all');
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const reload = () => setTickets(listSupportTickets());

  useEffect(() => {
    reload();
    if (typeof window === 'undefined') return;
    window.addEventListener(SUPPORT_TICKETS_CHANGE_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(SUPPORT_TICKETS_CHANGE_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return tickets.filter((t) => {
      const matchQ =
        !q ||
        t.message.toLowerCase().includes(q) ||
        t.user.email.toLowerCase().includes(q) ||
        t.user.businessName.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchPriority = priorityFilter === 'all' || t.priority === priorityFilter;
      return matchQ && matchStatus && matchPriority;
    });
  }, [tickets, search, statusFilter, priorityFilter]);

  const pick = (t: SupportTicket) => {
    setSelected(t);
    setNoteDraft('');
  };

  const changeStatus = (id: string, status: TicketStatus) => {
    const updated = setTicketStatus(id, status);
    if (updated) {
      setSelected(updated);
      reload();
    }
  };

  const submitNote = () => {
    if (!selected || !noteDraft.trim()) return;
    const updated = addTicketAdminNote(selected.id, noteDraft, 'Super Admin');
    if (updated) {
      setSelected(updated);
      setNoteDraft('');
      reload();
    }
  };

  const openCount = tickets.filter((t) => t.status === 'open').length;

  return (
    <div>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-6 border-b border-secondary-200 dark:border-secondary-800">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary-100 dark:bg-primary-950/50 rounded-lg text-primary-600 dark:text-primary-400">
              <LifeBuoy className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-page-title sm:text-2xl">Support Tickets</h1>
              <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">
                {tickets.length} ticket{tickets.length === 1 ? '' : 's'} · {openCount} open · from user Help &amp; Support → Report an Issue
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={reload} className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
            <Link to="/super-admin" className="inline-flex">
              <Button variant="secondary" size="sm" className="flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Control Center
              </Button>
            </Link>
          </div>
        </div>

        <div className="card-solid p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400" />
            <Input placeholder="Search message, user email, business…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | TicketStatus)} className="input text-sm text-secondary-700 dark:text-secondary-200">
            <option value="all">All statuses</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{statusMeta[s].label}</option>)}
          </select>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as 'all' | TicketPriority)} className="input text-sm text-secondary-700 dark:text-secondary-200">
            <option value="all">All priorities</option>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>

        <div className="card-solid overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[860px]">
              <thead className="bg-secondary-50 dark:bg-secondary-800/50 border-b border-secondary-200 dark:border-secondary-800 text-xs font-semibold text-secondary-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-4">Message</th>
                  <th className="px-4 py-4">User</th>
                  <th className="px-4 py-4">Business</th>
                  <th className="px-4 py-4">Priority</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4">Updated</th>
                  <th className="px-4 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-secondary-400">
                    {tickets.length === 0 ? 'No tickets yet — users file these via Help & Support → Report an Issue.' : 'No tickets match the current filters.'}
                  </td></tr>
                ) : filtered.map((t) => (
                  <tr key={t.id} className="bg-secondary-100/60 dark:bg-secondary-800/50 table-row-hover transition-colors">
                    <td className="px-4 py-4 max-w-[280px]">
                      <div className="font-medium text-secondary-900 dark:text-white line-clamp-2">{t.message}</div>
                      {t.adminNotes.length > 0 && (
                        <div className="text-[11px] text-secondary-400 mt-1 inline-flex items-center gap-1">
                          <StickyNote className="w-3 h-3" /> {t.adminNotes.length} admin note{t.adminNotes.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-secondary-600 dark:text-secondary-300 font-mono text-xs">{t.user.email}</td>
                    <td className="px-4 py-4 text-secondary-600 dark:text-secondary-300 text-xs max-w-[160px] truncate">{t.user.businessName}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${priorityMeta[t.priority]}`}>{t.priority}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusMeta[t.status].cls}`}>
                        {statusMeta[t.status].icon}{statusMeta[t.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-secondary-500 text-xs whitespace-nowrap">{fmt(t.updatedAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end">
                        <Button variant="secondary" size="sm" className="text-xs" onClick={() => pick(t)}>Open Ticket</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={() => setSelected(null)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-label="Ticket detail" className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto card-solid rounded-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <Badge variant="primary">Ticket</Badge>
                <h3 className="text-base font-semibold text-secondary-900 dark:text-white mt-2">Reported by {selected.user.name}</h3>
                <p className="text-xs text-secondary-400 mt-0.5">{selected.user.email} · {selected.user.businessName}{selected.user.businessId ? ` · ${selected.user.businessId}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize ${priorityMeta[selected.priority]}`}>{selected.priority}</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusMeta[selected.status].cls}`}>
                  {statusMeta[selected.status].icon}{statusMeta[selected.status].label}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-secondary-50 dark:bg-secondary-800/60 border border-secondary-200 dark:border-secondary-700 p-4 text-sm text-secondary-800 dark:text-zinc-100 whitespace-pre-wrap">
              {selected.message}
            </div>
            <p className="text-[11px] text-secondary-400 mt-2">Filed {fmt(selected.createdAt)} · last update {fmt(selected.updatedAt)}</p>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 mb-2">Set status</p>
              <div className="flex gap-2 flex-wrap">
                {TICKET_STATUSES.map((s) => (
                  <Button
                    key={s}
                    variant="secondary"
                    size="sm"
                    className={`text-xs ${selected.status === s ? 'ring-2 ring-indigo-500/40' : ''}`}
                    onClick={() => changeStatus(selected.id, s)}
                  >
                    {statusMeta[s].label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 mb-2">Admin notes ({selected.adminNotes.length})</p>
              {selected.adminNotes.length === 0 ? (
                <p className="text-xs text-secondary-400 mb-2">No notes yet.</p>
              ) : (
                <ul className="space-y-2 mb-3">
                  {selected.adminNotes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-secondary-200 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-800/60 p-3">
                      <p className="text-sm text-secondary-800 dark:text-zinc-100 whitespace-pre-wrap">{n.note}</p>
                      <p className="text-[11px] text-secondary-400 mt-1">{n.author} · {fmt(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Add an internal admin note…"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNote(); } }}
                />
                <Button size="sm" disabled={!noteDraft.trim()} onClick={submitNote} className="whitespace-nowrap inline-flex items-center gap-1.5">
                  <MessageSquarePlus className="w-4 h-4" /> Add Note
                </Button>
              </div>
            </div>

            <div className="mt-5 flex justify-between gap-2">
              {import.meta.env.DEV && (
                <Button variant="secondary" size="sm" className="text-rose-600 border-rose-200 text-xs" onClick={() => { clearSupportTickets(); setSelected(null); }}>
                  Clear all (QA)
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
