import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/ui/StatCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EWayBillModal } from '@/components/eway/EWayBillModal';
import {
  cancelEWayBill,
  downloadNicJson,
  isExpiringToday,
  listEWayBills,
  updateEWayBillVehicle,
  type EWayBill,
} from '@/lib/ewayBill';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Truck, Plus, Search, Printer, Eye, Pencil, Ban, FileDown, CheckCircle2, XCircle,
} from 'lucide-react';

type Tab = 'all' | 'generated' | 'pending_dispatch' | 'cancelled';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'generated', label: 'Generated' },
  { key: 'pending_dispatch', label: 'Pending Dispatch' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function EWayBillPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const businessId = activeBusiness?.id || '';

  const [refresh, setRefresh] = useState(0);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [detail, setDetail] = useState<EWayBill | null>(null);
  const [editVehicle, setEditVehicle] = useState<EWayBill | null>(null);
  const [cancelTarget, setCancelTarget] = useState<EWayBill | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Part-B edit fields
  const [evVehicle, setEvVehicle] = useState('');
  const [evTransporter, setEvTransporter] = useState('');
  const [evTransporterId, setEvTransporterId] = useState('');

  const bills = useMemo(
    () => (businessId ? listEWayBills(businessId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [businessId, refresh]
  );

  const stats = useMemo(() => {
    const live = bills.filter((b) => b.status !== 'cancelled');
    return {
      active: live.length,
      expiring: live.filter(isExpiringToday).length,
      cancelled: bills.filter((b) => b.status === 'cancelled').length,
      totalValue: live.reduce((s, b) => s + Number(b.totalValue || 0), 0),
    };
  }, [bills]);

  const filtered = useMemo(
    () =>
      bills.filter((b) => {
        if (tab !== 'all' && b.status !== tab) return false;
        const q = search.toLowerCase();
        return (
          !q ||
          b.ewayBillNo.includes(q) ||
          b.invoiceNumber.toLowerCase().includes(q) ||
          b.customerName.toLowerCase().includes(q) ||
          b.vehicleNo.toLowerCase().includes(q)
        );
      }),
    [bills, tab, search]
  );

  const reload = () => setRefresh((r) => r + 1);

  const statusVariant = (s: string) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
      generated: 'success',
      pending_dispatch: 'warning',
      cancelled: 'error',
    };
    return map[s] || 'neutral';
  };

  const handlePrint = (bill: EWayBill) => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) {
      toast('Could not open print window — allow popups', 'error');
      return;
    }
    w.document.write(
      `<html><head><title>e-Way Bill ${bill.ewayBillNo}</title>` +
        `<style>body{font-family:Arial,sans-serif;padding:24px;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}h1{font-size:18px}</style></head><body>` +
        `<h1>e-Way Bill ${bill.ewayBillNo}</h1>` +
        `<table>` +
        `<tr><th>Invoice</th><td>${bill.docType} ${bill.invoiceNumber} (${bill.docDate})</td></tr>` +
        `<tr><th>Recipient</th><td>${bill.customerName}</td></tr>` +
        `<tr><th>From</th><td>${bill.fromAddress} — ${bill.fromPincode}</td></tr>` +
        `<tr><th>To</th><td>${bill.toAddress} — ${bill.toPincode}</td></tr>` +
        `<tr><th>Vehicle / Transporter</th><td>${bill.vehicleNo} / ${bill.transporterName || '—'} (${bill.transporterId || '—'})</td></tr>` +
        `<tr><th>Mode / Distance</th><td>${bill.transportMode} / ${bill.distanceKm} km</td></tr>` +
        `<tr><th>Value</th><td>Rs.${Number(bill.totalValue).toLocaleString('en-IN')}</td></tr>` +
        `<tr><th>Valid Until</th><td>${new Date(bill.validUntil).toLocaleString()}</td></tr>` +
        `<tr><th>Status</th><td>${bill.status}</td></tr>` +
        `</table>` +
        `<script>window.onload=function(){window.print()}</script></body></html>`
    );
    w.document.close();
  };

  const openEditVehicle = (bill: EWayBill) => {
    setEditVehicle(bill);
    setEvVehicle(bill.vehicleNo);
    setEvTransporter(bill.transporterName);
    setEvTransporterId(bill.transporterId);
    setOpenMenu(null);
  };

  const saveVehicle = () => {
    if (!editVehicle || !businessId) return;
    const v = evVehicle.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/.test(v)) {
      toast('Invalid vehicle number — e.g. UP32AB1234', 'error');
      return;
    }
    updateEWayBillVehicle(businessId, editVehicle.id, {
      vehicleNo: v,
      transporterName: evTransporter,
      transporterId: evTransporterId,
    });
    toast('Part-B vehicle details updated', 'success');
    setEditVehicle(null);
    reload();
  };

  const doCancel = () => {
    if (!cancelTarget || !businessId) return;
    cancelEWayBill(businessId, cancelTarget.id);
    toast(`e-Way Bill ${cancelTarget.ewayBillNo} cancelled`, 'success');
    setCancelTarget(null);
    reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="e-Way Bill Management"
        subtitle="Generate, track and manage e-Way Bills for goods movement"
        actions={
          <Button onClick={() => setGenerateOpen(true)}>
            <Plus className="h-4 w-4" /> Generate e-Way Bill
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Active" value={stats.active} icon={CheckCircle2} tone="inflow" />
        <StatCard label="Expiring Today" value={stats.expiring} icon={Truck} tone="warn" />
        <StatCard label="Cancelled" value={stats.cancelled} icon={XCircle} tone="outflow" />
        <StatCard
          label="Total Value"
          value={<span className="figure">{formatCurrency(stats.totalValue, activeBusiness?.currency_symbol)}</span>}
          icon={Truck}
          tone="cash"
        />
      </div>

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-secondary-500 hover:bg-secondary-100 dark:hover:bg-secondary-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-sm sm:ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input placeholder="Search bill no / invoice / customer / vehicle..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No e-Way Bills yet"
            description="Generate an e-Way Bill from an invoice over Rs.50,000, or use the button above"
            action={<Button onClick={() => navigate('/app/sales-invoices')}><Plus className="h-4 w-4" /> Go to Invoices</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">e-Way Bill No.</th>
                  <th className="text-left px-4 py-3 font-medium">Doc Type / Invoice No.</th>
                  <th className="text-left px-4 py-3 font-medium">Document Date</th>
                  <th className="text-left px-4 py-3 font-medium">Customer / Recipient</th>
                  <th className="text-left px-4 py-3 font-medium">Vehicle No. / Transporter ID</th>
                  <th className="text-left px-4 py-3 font-medium">From / To Pincode</th>
                  <th className="text-left px-4 py-3 font-medium">Valid Until</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-mono font-semibold text-primary-600 dark:text-primary-400">{b.ewayBillNo}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-secondary-500">{b.docType}</p>
                      <p className="font-medium">{b.invoiceNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-secondary-500">{formatDate(b.docDate)}</td>
                    <td className="px-4 py-3">{b.customerName}</td>
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium">{b.vehicleNo}</p>
                      <p className="text-xs text-secondary-500">{b.transporterId || '—'}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{b.fromPincode} → {b.toPincode}</td>
                    <td className="px-4 py-3 text-secondary-500 text-xs">{new Date(b.validUntil).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={statusVariant(b.status)}>{b.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === b.id ? null : b.id)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-800"
                      >
                        Actions ▾
                      </button>
                      {openMenu === b.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                          <div className="absolute right-4 z-20 w-52 rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 shadow-xl p-1 text-left">
                            <button onClick={() => { setOpenMenu(null); handlePrint(b); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800">
                              <Printer className="h-4 w-4" /> Print PDF
                            </button>
                            <button onClick={() => { setOpenMenu(null); setDetail(b); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800">
                              <Eye className="h-4 w-4" /> View Details
                            </button>
                            <button onClick={() => downloadNicJson(b, activeBusiness?.gstin ?? null)} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800">
                              <FileDown className="h-4 w-4" /> NIC JSON Export
                            </button>
                            {b.status !== 'cancelled' && (
                              <>
                                <button onClick={() => openEditVehicle(b)} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800">
                                  <Pencil className="h-4 w-4" /> Update Vehicle Part-B
                                </button>
                                <button onClick={() => { setOpenMenu(null); setCancelTarget(b); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-error-600 hover:bg-error-50 dark:hover:bg-error-900/20">
                                  <Ban className="h-4 w-4" /> Cancel
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Generate-from-invoice picker: jump to invoices; modal lives on invoice pages too */}
      {generateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setGenerateOpen(false)} />
          <div className="relative bg-white dark:bg-secondary-900 rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h2 className="text-lg font-bold">Generate e-Way Bill</h2>
            <p className="text-sm text-secondary-500">
              Pick an invoice over ₹50,000 from Sales Invoices — the generation form auto-fills dispatch and ship-to addresses.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setGenerateOpen(false)}>Close</Button>
              <Button onClick={() => navigate('/app/sales-invoices')}>Go to Sales Invoices</Button>
            </div>
          </div>
        </div>
      )}

      {/* Details drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative bg-white dark:bg-secondary-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3">
            <h2 className="text-lg font-bold">e-Way Bill <span className="font-mono">{detail.ewayBillNo}</span></h2>
            <dl className="text-sm space-y-1.5">
              {[['Invoice', `${detail.docType} ${detail.invoiceNumber} (${detail.docDate})`],
                ['Recipient', detail.customerName],
                ['From', `${detail.fromAddress} — ${detail.fromPincode}`],
                ['To', `${detail.toAddress} — ${detail.toPincode}`],
                ['Mode / Distance', `${detail.transportMode} / ${detail.distanceKm} km`],
                ['Transporter', `${detail.transporterName || '—'} (${detail.transporterId || '—'})`],
                ['Vehicle', detail.vehicleNo],
                ['LR/RR', detail.lrNo ? `${detail.lrNo}${detail.lrDate ? ` (${detail.lrDate})` : ''}` : '—'],
                ['Value', formatCurrency(detail.totalValue, activeBusiness?.currency_symbol)],
                ['Valid Until', new Date(detail.validUntil).toLocaleString()],
                ['Status', detail.status],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-32 shrink-0 text-secondary-500">{k}</dt>
                  <dd className="font-medium break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="secondary" onClick={() => handlePrint(detail)}>
                <Printer className="h-4 w-4" /> Print PDF
              </Button>
              <Button variant="secondary" onClick={() => downloadNicJson(detail, activeBusiness?.gstin ?? null)}>
                <FileDown className="h-4 w-4" /> NIC JSON
              </Button>
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Part-B vehicle update */}
      {editVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditVehicle(null)} />
          <div className="relative bg-white dark:bg-secondary-900 rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h2 className="text-lg font-bold">Update Vehicle (Part-B)</h2>
            <p className="text-sm text-secondary-500 font-mono">{editVehicle.ewayBillNo}</p>
            <label className="text-sm block">
              <span className="block mb-1 font-medium">Vehicle No.</span>
              <Input value={evVehicle} onChange={(e) => setEvVehicle(e.target.value.toUpperCase())} placeholder="UP32AB1234" />
            </label>
            <label className="text-sm block">
              <span className="block mb-1 font-medium">Transporter Name</span>
              <Input value={evTransporter} onChange={(e) => setEvTransporter(e.target.value)} />
            </label>
            <label className="text-sm block">
              <span className="block mb-1 font-medium">Transporter ID</span>
              <Input value={evTransporterId} onChange={(e) => setEvTransporterId(e.target.value.slice(0, 15))} />
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setEditVehicle(null)}>Cancel</Button>
              <Button onClick={saveVehicle}>Save Part-B</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={doCancel}
        title="Cancel e-Way Bill?"
        message={`This will mark e-Way Bill ${cancelTarget?.ewayBillNo || ''} as cancelled.`}
        confirmText="Cancel e-Way Bill"
      />
    </div>
  );
}
