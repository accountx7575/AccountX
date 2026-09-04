import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Users, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Drawer } from '@/components/ui/Drawer';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DatePicker } from '@/components/common/DatePicker';
import { usePagedList } from '@/hooks/usePagedList';
import { formatCurrency, formatDate } from '@/lib/utils';
import { downloadLedgerCsv } from '@/lib/exportLedger';
import { can, capabilityTooltip } from '@/lib/rbac';
import { SendDialog } from '@/components/comms/SendDialog';

type ReminderTarget = {
  party: PartyAging;
  category: string;
  tone: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  contactName: string;
  email: string | null;
  phone: string | null;
};

type AgingDocRow = {
  party_id: string;
  party_name: string | null;
  doc_id: string;
  doc_number: string;
  doc_date: string;
  due_date: string;
  outstanding: number;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
};

type StatementRow = {
  entry_date: string;
  doc_type: string;
  doc_number: string | null;
  description: string;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
};

type PartyAging = {
  partyId: string;
  name: string;
  total: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  docs: AgingDocRow[];
};

const money = (n: number | null | undefined) => (n ? Math.round(n * 100) / 100 : 0);

export function ReceivablesPage() {
  const { activeBusiness, activeRole } = useAuth();
  const list = usePagedList();
  const [selected, setSelected] = useState<PartyAging | null>(null);
  const [stmtFrom, setStmtFrom] = useState('');
  const [stmtTo, setStmtTo] = useState('');
  const [reminder, setReminder] = useState<ReminderTarget | null>(null);
  const { toast } = useToast();

  const reminderCategory = (p: PartyAging): { label: string; tone: ReminderTarget['tone'] } => {
    if (p.d90plus > 0) return { label: 'Severely overdue', tone: 'error' };
    if (p.d61_90 > 0 || p.d31_60 > 0) return { label: 'Overdue', tone: 'warning' };
    const today = new Date().toISOString().slice(0, 10);
    const dueDates = p.docs.map((d) => d.due_date).filter(Boolean).sort();
    if (dueDates.length > 0 && dueDates[0] <= today)
      return { label: dueDates[0] === today ? 'Due today' : 'Overdue', tone: dueDates[0] === today ? 'info' : 'warning' };
    return { label: 'Due soon', tone: 'neutral' };
  };

  const openReminder = async (p: PartyAging) => {
    const { label, tone } = reminderCategory(p);
    let email: string | null = null;
    let phone: string | null = null;
    let contactName = p.name;
    try {
      const { data } = await supabase
        .from('customers')
        .select('name,email,phone')
        .eq('id', p.partyId)
        .maybeSingle();
      if (data) {
        contactName = data.name || p.name;
        email = data.email;
        phone = data.phone;
      }
    } catch {
      toast('Could not load the saved contact — enter the recipient manually.', 'info');
    }
    setReminder({ party: p, category: label, tone, contactName, email, phone });
  };

  const aging = useQuery({
    queryKey: ['receivables-aging', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as AgingDocRow[];
      const { data, error } = await supabase.rpc('get_receivables_aging', { p_business_id: activeBusiness.id });
      if (error) throw new Error(error.message);
      return (data || []) as AgingDocRow[];
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });

  const parties = useMemo<PartyAging[]>(() => {
    const byParty = new Map<string, PartyAging>();
    for (const d of aging.data || []) {
      let p = byParty.get(d.party_id);
      if (!p) {
        p = { partyId: d.party_id, name: d.party_name || 'Unnamed customer', total: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, docs: [] };
        byParty.set(d.party_id, p);
      }
      p.total += money(d.outstanding);
      p.current += money(d.current);
      p.d1_30 += money(d.days_1_30);
      p.d31_60 += money(d.days_31_60);
      p.d61_90 += money(d.days_61_90);
      p.d90plus += money(d.days_90_plus);
      p.docs.push(d);
    }
    return [...byParty.values()].sort((a, b) => b.total - a.total);
  }, [aging.data]);

  const filtered = useMemo(() => {
    const q = list.debouncedSearch.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.docs.some((d) => d.doc_number.toLowerCase().includes(q))
    );
  }, [parties, list.debouncedSearch]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);
  const totals = useMemo(
    () =>
      filtered.reduce(
        (t, p) => ({ total: t.total + p.total, overdue: t.overdue + p.d1_30 + p.d31_60 + p.d61_90 + p.d90plus }),
        { total: 0, overdue: 0 }
      ),
    [filtered]
  );

  const statement = useQuery({
    queryKey: ['customer-statement', activeBusiness?.id, selected?.partyId, stmtFrom, stmtTo],
    queryFn: async () => {
      if (!activeBusiness || !selected) return [] as StatementRow[];
      const { data, error } = await supabase.rpc('get_customer_statement', {
        p_business_id: activeBusiness.id,
        p_customer_id: selected.partyId,
        p_from_date: stmtFrom || null,
        p_to_date: stmtTo || null,
      });
      if (error) throw new Error(error.message);
      return (data || []) as StatementRow[];
    },
    enabled: !!activeBusiness && !!selected,
    placeholderData: (prev) => prev,
  });

  const openStatement = (p: PartyAging) => {
    setSelected(p);
    setStmtFrom('');
    setStmtTo('');
  };

  const exportCsv = () => {
    const rows = (aging.data || []).map((d) => ({
      Customer: d.party_name || '',
      'Invoice No': d.doc_number,
      'Invoice Date': d.doc_date,
      'Due Date': d.due_date,
      Outstanding: money(d.outstanding),
      Current: money(d.current),
      'Days 1-30': money(d.days_1_30),
      'Days 31-60': money(d.days_31_60),
      'Days 61-90': money(d.days_61_90),
      'Days 90+': money(d.days_90_plus),
    }));
    downloadLedgerCsv(`receivables-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const closingBalance = statement.data && statement.data.length > 0
    ? statement.data[statement.data.length - 1].running_balance
    : null;

  return (
    <div>
      <PageHeader
        title="Receivables"
        subtitle={`${filtered.length} customer${filtered.length !== 1 ? 's' : ''} with outstanding invoices`}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!can(activeRole, 'data.export') || (aging.data || []).length === 0}
            title={capabilityTooltip('data.export', activeRole)}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Total Outstanding</p>
          <p className="text-2xl font-semibold text-secondary-900 dark:text-white mt-1 tabular-nums figure">
            {formatCurrency(Math.round(totals.total * 100) / 100, activeBusiness?.currency_symbol)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Overdue</p>
          <p className="text-2xl font-semibold text-error-600 dark:text-error-400 mt-1 tabular-nums figure">
            {formatCurrency(Math.round(totals.overdue * 100) / 100, activeBusiness?.currency_symbol)}
          </p>
        </div>
      </div>

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search customers or invoice numbers..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        {aging.isError ? (
          <ErrorState title="Unable to load receivables ageing summary." onRetry={() => aging.refetch()} />
        ) : aging.isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : pageRows.length === 0 ? (
          <EmptyState icon={Users} title="No outstanding receivables"
            description={list.search ? 'No customer matches your search.' : 'Every issued invoice is fully settled — nothing to collect.'} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Current</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">1&ndash;30</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">31&ndash;60</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">61&ndash;90</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">90+</th>
                  <th className="text-right px-4 py-3 font-medium">Statement</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.partyId} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{p.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold figure">{formatCurrency(p.total, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden md:table-cell text-secondary-500">{p.current ? formatCurrency(p.current, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-secondary-500">{p.d1_30 ? formatCurrency(p.d1_30, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-warning-600 dark:text-warning-400">{p.d31_60 ? formatCurrency(p.d31_60, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-warning-600 dark:text-warning-400">{p.d61_90 ? formatCurrency(p.d61_90, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-error-600 dark:text-error-400">{p.d90plus ? formatCurrency(p.d90plus, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openStatement(p)}>View</Button>
                        <Button size="sm" variant="ghost" onClick={() => void openReminder(p)} title="Send a payment reminder to this customer">
                          <Send className="h-3.5 w-3.5" /> Remind
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ListPagination
          page={list.page}
          onPageChange={list.setPage}
          pageSize={list.pageSize}
          from={list.from}
          total={filtered.length}
          isLoading={aging.isLoading}
        />
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} width="xl" title={`Customer statement — ${selected?.name ?? ''}`}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">From</label>
            <DatePicker value={stmtFrom || undefined} onChange={(iso) => setStmtFrom(iso)} clearable placeholder="All time" />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">To</label>
            <DatePicker value={stmtTo || undefined} onChange={(iso) => setStmtTo(iso)} clearable placeholder="Today" max={stmtTo || undefined} />
          </div>
          <p className="text-xs text-secondary-400 ml-auto">Positive balance means the customer owes you.</p>
        </div>

        {statement.isError ? (
          <ErrorState title="Unable to load customer statement." onRetry={() => statement.refetch()} />
        ) : statement.isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : !statement.data || statement.data.length === 0 ? (
          <EmptyState icon={FileText} title="No statement entries" description="No transactions found for this customer in the selected period." />
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-thin border border-secondary-200 dark:border-secondary-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400 bg-secondary-50/60 dark:bg-secondary-800/40">
                    <th className="text-left px-3 py-2.5 font-medium">Date</th>
                    <th className="text-left px-3 py-2.5 font-medium">Type</th>
                    <th className="text-left px-3 py-2.5 font-medium">Doc No.</th>
                    <th className="text-left px-3 py-2.5 font-medium">Description</th>
                    <th className="text-right px-3 py-2.5 font-medium">Debit</th>
                    <th className="text-right px-3 py-2.5 font-medium">Credit</th>
                    <th className="text-right px-3 py-2.5 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.data.map((r, i) => (
                    <tr key={i} className={r.doc_type === 'bf' ? 'border-b border-secondary-100 dark:border-secondary-800/50 bg-secondary-50/40 dark:bg-secondary-800/20' : 'border-b border-secondary-100 dark:border-secondary-800/50'}>
                      <td className="px-3 py-2 whitespace-nowrap text-secondary-500">{r.doc_type === 'bf' ? '—' : formatDate(r.entry_date)}</td>
                      <td className="px-3 py-2 text-secondary-500">{r.description === 'Brought forward' ? 'Brought forward' : r.description}</td>
                      <td className="px-3 py-2 font-medium text-secondary-500">{r.doc_number || '—'}</td>
                      <td className="px-3 py-2 text-secondary-600 dark:text-secondary-300">{r.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums figure">{r.debit_amount ? formatCurrency(r.debit_amount, activeBusiness?.currency_symbol) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums figure">{r.credit_amount ? formatCurrency(r.credit_amount, activeBusiness?.currency_symbol) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums figure font-medium">{formatCurrency(r.running_balance, activeBusiness?.currency_symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <span className="badge bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                Closing balance: {formatCurrency(closingBalance ?? 0, activeBusiness?.currency_symbol)}
              </span>
            </div>
          </>
        )}
      </Drawer>

      <SendDialog
        open={!!reminder}
        onClose={() => setReminder(null)}
        contextLabel={`Reminder — ${reminder?.party.name ?? ''}`}
        docType="reminder"
        docNumber={reminder?.party.docs[0]?.doc_number}
        templateKey={reminder && (reminder.category === 'Overdue' || reminder.category === 'Severely overdue') ? 'invoice_overdue' : 'payment_reminder'}
        categoryChip={reminder?.category}
        categoryTone={reminder?.tone}
        templateVariables={{
          customer_name: reminder?.contactName || '',
          invoice_number: reminder?.party.docs[0]?.doc_number || '—',
          business_name: activeBusiness?.name || '',
          amount: formatCurrency(reminder?.party.total || 0, activeBusiness?.currency_symbol),
          due_date: reminder?.party.docs[0] ? formatDate(reminder.party.docs[0].due_date) : '—',
        }}
        defaultSubject={reminder && (reminder.category === 'Overdue' || reminder.category === 'Severely overdue')
          ? `Overdue: invoice ${reminder.party.docs[0]?.doc_number ?? ''}`
          : `Reminder: invoice ${reminder?.party.docs[0]?.doc_number ?? ''} due ${reminder?.party.docs[0] ? formatDate(reminder.party.docs[0].due_date) : ''}`}
        defaultMessage={`Dear ${reminder?.contactName || 'customer'}, ${reminder && (reminder.category === 'Overdue' || reminder.category === 'Severely overdue') ? `invoice ${reminder.party.docs[0]?.doc_number ?? ''} was due on ${reminder.party.docs[0] ? formatDate(reminder.party.docs[0].due_date) : ''}` : `a gentle reminder that invoice ${reminder?.party.docs[0]?.doc_number ?? ''} is due on ${reminder?.party.docs[0] ? formatDate(reminder.party.docs[0].due_date) : ''}`} for ${formatCurrency(reminder?.party.total || 0, activeBusiness?.currency_symbol)} remains outstanding.`}
        recipients={[
          {
            label: reminder?.contactName || 'Customer',
            email: reminder?.email,
            phone: reminder?.phone,
          },
        ]}
        attachments={
          reminder
            ? [
                {
                  id: 'outstanding-csv',
                  label: 'Outstanding invoices (CSV)',
                  filename: `outstanding-${reminder.party.name.replace(/\W+/g, '-').toLowerCase()}.csv`,
                  build: async () => {
                    const header = ['Invoice No', 'Invoice Date', 'Due Date', 'Outstanding'];
                    const lines = reminder.party.docs.map((d) =>
                      [d.doc_number, d.doc_date, d.due_date, money(d.outstanding)].join(',')
                    );
                    const csv = `\uFEFF${[header.join(','), ...lines].join('\n')}`;
                    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
                  },
                },
              ]
            : []
        }
      />
    </div>
  );
}
