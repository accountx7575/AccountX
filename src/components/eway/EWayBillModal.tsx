import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/context/ToastContext';
import type { Business, Customer } from '@/types/db';
import {
  EWAY_SUB_TYPES,
  EWAY_TRANSPORT_MODES,
  buildNicPayload,
  createEWayBill,
  downloadNicJson,
  type EWayBill,
  type EWaySubType,
  type EWayTransportMode,
} from '@/lib/ewayBill';

export interface EWayInvoiceRef {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
  customer?: { name?: string | null; company_name?: string | null; address?: string | null; city?: string | null; state?: string | null; pincode?: string | null } | null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  business: Business | null;
  invoice: EWayInvoiceRef | null;
  onCreated?: (bill: EWayBill) => void;
};

const inputCls = 'input w-full';

export function EWayBillModal({ open, onClose, business, invoice, onCreated }: Props) {
  const { toast } = useToast();
  const customer = (invoice?.customer || {}) as NonNullable<EWayInvoiceRef['customer']>;

  const businessAddr = useMemo(() => {
    if (!business) return '';
    return [business.address, [business.city, business.state].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join('\n');
  }, [business]);

  const shipAddr = useMemo(() => {
    const c = customer as Partial<Customer>;
    return [c.address, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  }, [customer]);

  const [subType, setSubType] = useState<EWaySubType>('Supply');
  const [docType, setDocType] = useState('Tax Invoice');
  const [fromAddress, setFromAddress] = useState('');
  const [fromPincode, setFromPincode] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [toPincode, setToPincode] = useState('');
  const [transportMode, setTransportMode] = useState<EWayTransportMode>('Road');
  const [distanceKm, setDistanceKm] = useState('100');
  const [transporterName, setTransporterName] = useState('');
  const [transporterId, setTransporterId] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [lrNo, setLrNo] = useState('');
  const [lrDate, setLrDate] = useState('');
  const [created, setCreated] = useState<EWayBill | null>(null);

  // Reset + auto-fill whenever a new invoice is opened.
  useEffect(() => {
    if (open && invoice) {
      setCreated(null);
      setSubType('Supply');
      setDocType('Tax Invoice');
      setFromAddress(businessAddr);
      setFromPincode('');
      setToAddress(shipAddr);
      setToPincode((customer as Partial<Customer>).pincode || '');
      setTransportMode('Road');
      setDistanceKm('100');
      setTransporterName('');
      setTransporterId('');
      setVehicleNo('');
      setLrNo('');
      setLrDate('');
    }
  }, [open, invoice, businessAddr, shipAddr, customer]);

  if (!open || !invoice) return null;

  const validVehicle = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/.test(
    vehicleNo.replace(/\s+/g, '').toUpperCase()
  );
  const canSubmit =
    fromPincode.trim().length === 6 &&
    toPincode.trim().length === 6 &&
    Number(distanceKm) > 0 &&
    validVehicle;

  const handleGenerate = () => {
    if (!business) {
      toast('No active business', 'error');
      return;
    }
    if (!canSubmit) {
      toast('Check pincodes (6 digits), distance and vehicle number', 'error');
      return;
    }
    const bill = createEWayBill({
      businessId: business.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      docType,
      docDate: invoice.invoice_date,
      customerName:
        (customer.company_name as string) || (customer.name as string) || '—',
      subType,
      fromAddress,
      fromPincode: fromPincode.trim(),
      toAddress,
      toPincode: toPincode.trim(),
      transportMode,
      distanceKm: Number(distanceKm),
      transporterName,
      transporterId: transporterId.trim(),
      vehicleNo: vehicleNo.replace(/\s+/g, '').toUpperCase(),
      lrNo,
      lrDate,
      totalValue: Number(invoice.grand_total) || 0,
    });
    setCreated(bill);
    toast(`e-Way Bill ${bill.ewayBillNo} generated`, 'success');
    onCreated?.(bill);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-secondary-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="p-5 border-b border-secondary-200 dark:border-secondary-800 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-secondary-900 dark:text-white">
              {created ? 'e-Way Bill Generated' : 'Generate e-Way Bill'}
            </h2>
            <p className="text-sm text-secondary-500">
              Invoice {invoice.invoice_number} • ₹{Number(invoice.grand_total).toLocaleString('en-IN')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {created ? (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-success-50 dark:bg-success-900/20 p-4 text-sm">
              <p className="font-semibold text-success-700 dark:text-success-300">
                e-Way Bill No. <span className="font-mono">{created.ewayBillNo}</span>
              </p>
              <p className="text-secondary-600 dark:text-secondary-400 mt-1">
                Valid until {new Date(created.validUntil).toLocaleString()} • Vehicle {created.vehicleNo}
              </p>
            </div>
            <details className="rounded-lg border border-secondary-200 dark:border-secondary-800 p-3">
              <summary className="text-sm font-medium cursor-pointer">NIC-schema JSON preview</summary>
              <pre className="mt-2 text-xs overflow-x-auto scrollbar-thin p-2 rounded bg-secondary-50 dark:bg-secondary-800">
                {JSON.stringify(buildNicPayload(created, { gstin: business?.gstin ?? null }), null, 2)}
              </pre>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => downloadNicJson(created, business?.gstin ?? null)}>
                Download NIC JSON
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 font-medium">Sub Type</span>
                <select className={inputCls} value={subType} onChange={(e) => setSubType(e.target.value as EWaySubType)}>
                  {EWAY_SUB_TYPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block mb-1 font-medium">Doc Type</span>
                <select className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option>Tax Invoice</option>
                  <option>Bill of Supply</option>
                  <option>Delivery Challan</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 font-medium">Dispatch-From (address)</span>
                <textarea className={inputCls} rows={2} value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block mb-1 font-medium">Ship-To (customer address)</span>
                <textarea className={inputCls} rows={2} value={toAddress} onChange={(e) => setToAddress(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="block mb-1 font-medium">From Pincode</span>
                <Input value={fromPincode} onChange={(e) => setFromPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN" />
              </label>
              <label className="text-sm">
                <span className="block mb-1 font-medium">To Pincode</span>
                <Input value={toPincode} onChange={(e) => setToPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN" />
              </label>
            </div>

            <div className="border-t border-secondary-200 dark:border-secondary-800 pt-4">
              <p className="text-sm font-semibold mb-3">Part-B (Transport)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="block mb-1 font-medium">Mode</span>
                  <select className={inputCls} value={transportMode} onChange={(e) => setTransportMode(e.target.value as EWayTransportMode)}>
                    {EWAY_TRANSPORT_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block mb-1 font-medium">Distance (km)</span>
                  <Input value={distanceKm} onChange={(e) => setDistanceKm(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 100" />
                </label>
                <label className="text-sm">
                  <span className="block mb-1 font-medium">Transporter Name</span>
                  <Input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} placeholder="Optional" />
                </label>
                <label className="text-sm">
                  <span className="block mb-1 font-medium">Transporter ID (15-digit GSTIN/ID)</span>
                  <Input value={transporterId} onChange={(e) => setTransporterId(e.target.value.slice(0, 15))} placeholder="Optional" />
                </label>
                <label className="text-sm">
                  <span className="block mb-1 font-medium">Vehicle No. (e.g. UP32AB1234)</span>
                  <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value.toUpperCase())} placeholder="UP32AB1234" />
                  {vehicleNo && !validVehicle && (
                    <span className="text-xs text-error-600">Invalid format — e.g. UP32AB1234</span>
                  )}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="block mb-1 font-medium">LR/RR No.</span>
                    <Input value={lrNo} onChange={(e) => setLrNo(e.target.value)} placeholder="Optional" />
                  </label>
                  <label className="text-sm">
                    <span className="block mb-1 font-medium">LR Date</span>
                    <Input type="date" value={lrDate} onChange={(e) => setLrDate(e.target.value)} />
                  </label>
                </div>
              </div>
            </div>

            <p className="text-xs text-secondary-500">
              NIC JSON export included for upload at ewaybillgst.gov.in. Bills ≥ ₹50,000 require an e-Way Bill for inter-state movement.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={!canSubmit}>Generate e-Way Bill</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
