import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { Eye, Layers, Plus, Trash2, FileSpreadsheet } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import {
  listDemoDocs,
  deleteDemoDoc,
  downloadDemoCsv,
  type DemoDocRecord,
  type DemoKind,
} from '@/lib/demoStore';

interface KindConfig {
  title: string;
  home: string;
  createRoute: string;
  numberKey: string;
  dateLabel: string;
  dateKey: string;
  expiryLabel: string;
  expiryKey: string;
  partyLabel: string;
  docTitle: string;
}

const KIND_CONFIG: Record<DemoKind, KindConfig> = {
  quotation: {
    title: 'Demo Quotations',
    home: '/app/demo/quotations',
    createRoute: '/app/demo/quotations/new',
    numberKey: 'quotation_number',
    dateLabel: 'Quote Date',
    dateKey: 'quote_date',
    expiryLabel: 'Valid Until',
    expiryKey: 'expiry_date',
    partyLabel: 'Customer',
    docTitle: 'QUOTATION',
  },
  sales_invoice: {
    title: 'Demo Sales Invoices',
    home: '/app/demo/invoices',
    createRoute: '/app/demo/invoices/new',
    numberKey: 'invoice_number',
    dateLabel: 'Invoice Date',
    dateKey: 'invoice_date',
    expiryLabel: 'Due Date',
    expiryKey: 'due_date',
    partyLabel: 'Customer',
    docTitle: 'TAX INVOICE',
  },
  sales_order: {
    title: 'Demo Sales Orders',
    home: '/app/demo/orders',
    createRoute: '/app/demo/orders/new',
    numberKey: 'order_number',
    dateLabel: 'Order Date',
    dateKey: 'order_date',
    expiryLabel: 'Expected Delivery',
    expiryKey: 'expected_date',
    partyLabel: 'Customer',
    docTitle: 'SALES ORDER',
  },
};

function DemoDocListPage({ kind }: { kind: DemoKind }) {
  const cfg = KIND_CONFIG[kind];
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DemoDocRecord | null>(null);

  const docs = useQuery({
    queryKey: ['demo-docs', activeBusiness?.id, kind],
    queryFn: () => listDemoDocs(activeBusiness?.id || '', kind),
    enabled: !!activeBusiness,
  });

  const all = docs.data || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((d) => {
      const party = (d.party || {}) as Record<string, string | null>;
      return (
        d.number.toLowerCase().includes(q) ||
        String(party.company_name || party.name || '').toLowerCase().includes(q)
      );
    });
  }, [all, search]);

  const slice = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['demo-docs', activeBusiness?.id] });

  const handleExcel = (doc: DemoDocRecord) => {
    downloadDemoCsv(kind, cfg.docTitle, activeBusiness?.name || '', doc);
    toast('Demo sheet downloaded (CSV opens in Excel)', 'success');
  };

  if (!activeBusiness) return null;

  return (
    <div>
      <PageHeader
        title={cfg.title}
        subtitle="Proforma sandbox — draft, preview, print and export estimates without touching your real books"
        actions={
          <Button variant="secondary" onClick={() => navigate('/app')}>
            <Eye className="h-4 w-4" /> Dashboard
          </Button>
        }
      />

      <div className="card">
        <ListToolbar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          placeholder={`Search by ${cfg.docTitle.toLowerCase().includes('invoice') ? 'invoice' : 'number'} or ${cfg.partyLabel.toLowerCase()}...`}
          pageSize={pageSize}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(0);
          }}
        >
          <Button className="h-9" onClick={() => navigate(cfg.createRoute)}>
            <Plus className="h-4 w-4" /> New Demo {cfg.docTitle === 'TAX INVOICE' ? 'Invoice' : cfg.docTitle === 'SALES ORDER' ? 'Order' : 'Quotation'}
          </Button>
        </ListToolbar>

        {docs.isLoading ? (
          <div className="p-10 text-center text-sm text-secondary-500">Loading demo documents…</div>
        ) : docs.isError ? (
          <div className="p-10 text-center text-sm text-error-600">Failed to load demo documents</div>
        ) : slice.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title={search ? 'No matching demo documents' : `No demo ${cfg.docTitle === 'TAX INVOICE' ? 'invoices' : cfg.docTitle === 'SALES ORDER' ? 'orders' : 'quotations'} yet`}
            description={
              search
                ? 'Try a different search term.'
                : 'Create a demo document from any customer and product in your books — preview it, print it, and discard it. Nothing ever hits your ledger, stock or GST series.'
            }
            action={
              !search && (
                <Button onClick={() => navigate(cfg.createRoute)}>
                  <Plus className="h-4 w-4" /> Create Demo {cfg.docTitle === 'TAX INVOICE' ? 'Invoice' : cfg.docTitle === 'SALES ORDER' ? 'Order' : 'Quotation'}
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary-50 dark:bg-secondary-800/60">
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Number</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">{cfg.dateLabel}</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">{cfg.partyLabel}</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">{cfg.expiryLabel}</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Preset</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-secondary-500">Grand Total</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-secondary-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((doc) => {
                  const header = doc.header as Record<string, number | string | null>;
                  const party = (doc.party || {}) as Record<string, string | null>;
                  return (
                    <tr key={doc.id} className="border-t border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-secondary-900 dark:text-white">{doc.number}</td>
                      <td className="px-3 py-2 text-xs text-secondary-600 dark:text-secondary-300">{formatDate(String(header[cfg.dateKey] || ''))}</td>
                      <td className="px-3 py-2 text-xs text-secondary-800 dark:text-secondary-200">{party.company_name || party.name || '—'}</td>
                      <td className="px-3 py-2 text-xs text-secondary-600 dark:text-secondary-300">{header[cfg.expiryKey] ? formatDate(String(header[cfg.expiryKey])) : '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${doc.headerMode === 'estimate' ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : doc.headerMode === 'demo' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300'}`}>
                          {doc.headerMode === 'estimate' ? 'Estimate/Proforma' : doc.headerMode === 'demo' ? 'Demo' : 'Clean'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-secondary-900 dark:text-white">
                        {formatCurrency(Number(header.grand_total || 0), activeBusiness.currency_symbol || '₹')}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            onClick={() => navigate(`/app/demo/${kind === 'quotation' ? 'quotations' : kind === 'sales_invoice' ? 'invoices' : 'orders'}/${doc.id}`)}
                            className="p-1.5 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="Preview document"
                            aria-label="Preview document"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleExcel(doc)}
                            className="p-1.5 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                            title="Excel export"
                            aria-label="Excel export"
                          >
                            <Layers className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(doc)}
                            className="p-1.5 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                            title="Delete demo document"
                            aria-label="Delete demo document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="px-4 pb-3 pt-1 flex justify-center">
            <ListPagination
              page={page}
              onPageChange={setPage}
              pageSize={pageSize}
              from={page * pageSize}
              total={filtered.length}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && activeBusiness) {
            deleteDemoDoc(activeBusiness.id, deleteTarget.id);
            refresh();
            toast('Demo document deleted — no books were ever affected', 'success');
          }
          setDeleteTarget(null);
        }}
        title="Delete demo document?"
        message={`${deleteTarget?.number || 'This demo document'} will be permanently removed from the sandbox. Your real books were never affected by it.`}
        confirmText="Delete demo"
      />
    </div>
  );
}

export function DemoQuotationsPage() {
  return <DemoDocListPage kind="quotation" />;
}

export function DemoInvoicesPage() {
  return <DemoDocListPage kind="sales_invoice" />;
}

export function DemoOrdersPage() {
  return <DemoDocListPage kind="sales_order" />;
}
