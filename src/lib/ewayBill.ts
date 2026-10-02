/**
 * e-Way Bill — local/mock persistence + NIC-schema helpers.
 *
 * Bills are stored per-business in localStorage (key `ax-ewaybills:<businessId>`)
 * so generated bills appear in the e-Way Bill table without a backend.
 * When a Supabase `eway_bills` table lands, swap the storage fns — the
 * component contracts (EWayBill record shape) stay the same.
 */

export type EWayBillStatus = 'generated' | 'pending_dispatch' | 'cancelled';

export type EWaySubType = 'Supply' | 'Export' | 'Job Work';

export type EWayTransportMode = 'Road' | 'Rail' | 'Air' | 'Ship';

export interface EWayBill {
  id: string;
  businessId: string;
  /** 12-digit NIC e-Way Bill number (mock-generated locally). */
  ewayBillNo: string;
  invoiceId: string | null;
  invoiceNumber: string;
  docType: string;
  docDate: string;
  customerName: string;
  subType: EWaySubType;
  fromAddress: string;
  fromPincode: string;
  toAddress: string;
  toPincode: string;
  transportMode: EWayTransportMode;
  distanceKm: number;
  transporterName: string;
  transporterId: string;
  vehicleNo: string;
  lrNo: string;
  lrDate: string;
  totalValue: number;
  status: EWayBillStatus;
  validUntil: string;
  createdAt: string;
}

export interface EWayBillInput {
  businessId: string;
  invoiceId: string | null;
  invoiceNumber: string;
  docType: string;
  docDate: string;
  customerName: string;
  subType: EWaySubType;
  fromAddress: string;
  fromPincode: string;
  toAddress: string;
  toPincode: string;
  transportMode: EWayTransportMode;
  distanceKm: number;
  transporterName: string;
  transporterId: string;
  vehicleNo: string;
  lrNo: string;
  lrDate: string;
  totalValue: number;
}

const keyFor = (businessId: string) => `ax-ewaybills:${businessId}`;

function readAll(businessId: string): EWayBill[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyFor(businessId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EWayBill[]) : [];
  } catch {
    return [];
  }
}

function writeAll(businessId: string, bills: EWayBill[]): void {
  try {
    localStorage.setItem(keyFor(businessId), JSON.stringify(bills));
  } catch {
    /* storage full / unavailable — table simply won't persist */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ewb-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Mock 12-digit e-Way Bill number (NIC format: 12 digits). */
export function generateEWayBillNo(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 10).toString();
  return s;
}

/** Validity: 1 day per 200 km (min 1 day), from now. */
export function computeValidUntil(distanceKm: number, from = new Date()): string {
  const days = Math.max(1, Math.ceil(Number(distanceKm || 0) / 200));
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export function listEWayBills(businessId: string): EWayBill[] {
  return readAll(businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findEWayBillByInvoiceId(businessId: string, invoiceId: string): EWayBill | null {
  return readAll(businessId).find((b) => b.invoiceId === invoiceId && b.status !== 'cancelled') || null;
}

export function createEWayBill(input: EWayBillInput): EWayBill {
  const now = new Date().toISOString();
  const bill: EWayBill = {
    ...input,
    id: uid(),
    ewayBillNo: generateEWayBillNo(),
    distanceKm: Number(input.distanceKm) || 0,
    totalValue: Number(input.totalValue) || 0,
    status: 'generated',
    validUntil: computeValidUntil(input.distanceKm),
    createdAt: now,
  };
  const all = readAll(input.businessId);
  all.push(bill);
  writeAll(input.businessId, all);
  return bill;
}

export function updateEWayBillVehicle(
  businessId: string,
  id: string,
  patch: { vehicleNo: string; transporterName?: string; transporterId?: string; lrNo?: string; lrDate?: string }
): EWayBill | null {
  const all = readAll(businessId);
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  all[idx] = {
    ...all[idx],
    vehicleNo: patch.vehicleNo,
    transporterName: patch.transporterName ?? all[idx].transporterName,
    transporterId: patch.transporterId ?? all[idx].transporterId,
    lrNo: patch.lrNo ?? all[idx].lrNo,
    lrDate: patch.lrDate ?? all[idx].lrDate,
    status: all[idx].status === 'generated' ? 'pending_dispatch' : all[idx].status,
  };
  writeAll(businessId, all);
  return all[idx];
}

export function cancelEWayBill(businessId: string, id: string): EWayBill | null {
  const all = readAll(businessId);
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status: 'cancelled' };
  writeAll(businessId, all);
  return all[idx];
}

/**
 * NIC-schema JSON payload for upload at ewaybillgst.gov.in
 * (offline JSON structure: supply type, doc details, trans parties, vehicle).
 */
export function buildNicPayload(bill: EWayBill, opts: { gstin: string | null; hsnSummary?: string }): Record<string, unknown> {
  return {
    version: '1.0.0621',
    billLists: [
      {
        ewbNo: bill.ewayBillNo,
        supplyType: bill.subType === 'Export' ? 'E' : bill.subType === 'Job Work' ? 'J' : 'O',
        subSupplyType: bill.subType,
        docType: bill.docType,
        docNo: bill.invoiceNumber,
        docDate: bill.docDate,
        fromGstin: opts.gstin || '',
        fromTrdName: '',
        fromAddr1: bill.fromAddress,
        fromPincode: bill.fromPincode,
        toTrdName: bill.customerName,
        toAddr1: bill.toAddress,
        toPincode: bill.toPincode,
        totalValue: bill.totalValue,
        hsnSummary: opts.hsnSummary || '',
        transporterId: bill.transporterId,
        transporterName: bill.transporterName,
        transMode: bill.transportMode,
        transDistance: bill.distanceKm,
        vehicleNo: bill.vehicleNo,
        lrNo: bill.lrNo || undefined,
        lrDate: bill.lrDate || undefined,
      },
    ],
  };
}

export function downloadNicJson(bill: EWayBill, gstin: string | null): void {
  const blob = new Blob([JSON.stringify(buildNicPayload(bill, { gstin }), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EWB_${bill.ewayBillNo}_${bill.invoiceNumber}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isExpiringToday(bill: EWayBill): boolean {
  if (bill.status === 'cancelled') return false;
  const now = new Date();
  const v = new Date(bill.validUntil);
  return (
    v.getFullYear() === now.getFullYear() &&
    v.getMonth() === now.getMonth() &&
    v.getDate() === now.getDate()
  );
}

export const EWAY_SUB_TYPES: EWaySubType[] = ['Supply', 'Export', 'Job Work'];

export const EWAY_TRANSPORT_MODES: EWayTransportMode[] = ['Road', 'Rail', 'Air', 'Ship'];
