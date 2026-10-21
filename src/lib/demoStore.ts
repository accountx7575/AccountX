/**
 * Demo/Proforma Sandbox store (PBS-112/113).
 *
 * Demo documents live in an isolated store so creating, previewing, printing
 * and exporting them has ZERO effect on the real books: no rows in
 * quotations/sales_orders/sales_invoices, no journal entries, no stock
 * movements, no GST series consumption.
 *
 * PBS-113: demo records are also persisted to the dedicated `demo_documents`
 * table (is_demo:true by construction — see
 * supabase/migrations/20261021_demo_documents.sql, applied by the human).
 * When the table is not yet applied the localStorage mirror stays the source
 * of truth.
 */

import { supabase } from '@/lib/supabase';

export type DemoKind = 'quotation' | 'sales_invoice' | 'sales_order';

export type DemoHeaderMode = 'estimate' | 'demo' | 'clean';

export interface DemoDocRecord {
  id: string;
  kind: DemoKind;
  number: string;
  createdAt: string;
  /** Print header/watermark preset: 'estimate' | 'demo' | 'clean'. */
  headerMode: DemoHeaderMode;
  /** DB-row-shaped header (mixed quotation/sales-order/sales-invoice fields). */
  header: Record<string, unknown>;
  /** DB-row-shaped line items. */
  items: Record<string, unknown>[];
  party: Record<string, unknown> | null;
}

const keyFor = (businessId: string) => `ax-demo-docs:${businessId}`;

// Supabase persistence must never crash the sandbox — the demo_documents
// table arrives only when the human applies the migration queue.
interface DemoDbRow {
  id: string;
  kind: string;
  number: string;
  header_mode: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function lsAll(businessId: string): DemoDocRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyFor(businessId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DemoDocRecord[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(businessId: string, docs: DemoDocRecord[]): void {
  try {
    localStorage.setItem(keyFor(businessId), JSON.stringify(docs));
  } catch {
    /* storage full/unavailable — sandbox stays in-memory for the session */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `demo-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function defaultDemoNumber(kind: DemoKind, seq: number): string {
  const prefix = kind === 'quotation' ? 'D-QT' : kind === 'sales_invoice' ? 'D-INV' : 'D-SO';
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export const DEFAULT_HEADER_MODE: Record<DemoKind, DemoHeaderMode> = {
  quotation: 'demo',
  sales_invoice: 'estimate',
  sales_order: 'demo',
};

export function listDemoDocsSync(businessId: string, kind?: DemoKind): DemoDocRecord[] {
  const all = lsAll(businessId);
  const filtered = kind ? all.filter((d) => d.kind === kind) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function dbRowToRecord(row: DemoDbRow): DemoDocRecord {
  const payload = (row.payload || {}) as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.kind as DemoKind,
    number: row.number,
    createdAt: row.created_at,
    headerMode: (row.header_mode as DemoHeaderMode) || DEFAULT_HEADER_MODE[row.kind as DemoKind],
    header: (payload.header || {}) as Record<string, unknown>,
    items: (payload.items || []) as Record<string, unknown>[],
    party: (payload.party || null) as Record<string, unknown> | null,
  };
}

export async function listDemoDocs(businessId: string, kind?: DemoKind): Promise<DemoDocRecord[]> {
  const local = listDemoDocsSync(businessId, kind);

  // Demo_documents read-through (PBS-113): when the human has applied the
  // migration this returns the canonical sandbox rows; before that the
  // query 404s and the localStorage mirror is authoritative.
  try {
    const { data, error } = await supabase
      .from('demo_documents')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error && (error as { code?: string }).code === '42P01') {
      return local; // table not applied yet
    }
    if (error) return local;
    const dbRows = Array.isArray(data) ? data : [];
    const records: DemoDocRecord[] = [];
    for (const row of dbRows as DemoDbRow[]) {
      if (kind && row.kind !== kind) continue;
      records.push(dbRowToRecord(row));
    }
    // Outlive any localStorage-only rows (created before the migration).
    for (const rec of local) {
      if (!records.some((r) => r.number === rec.number)) records.push(rec);
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return local;
  }
}

export async function getDemoDoc(businessId: string, id: string): Promise<DemoDocRecord | null> {
  const all = await listDemoDocs(businessId);
  return all.find((d) => d.id === id) || null;
}

export function countDemoDocs(businessId: string, kind: DemoKind): number {
  return lsAll(businessId).filter((d) => d.kind === kind).length;
}

export function saveDemoDoc(
  businessId: string,
  kind: DemoKind,
  header: Record<string, unknown>,
  items: Record<string, unknown>[],
  party: Record<string, unknown> | null,
  headerMode?: DemoHeaderMode
): DemoDocRecord {
  const record: DemoDocRecord = {
    id: uid(),
    kind,
    number: String(header.quotation_number || header.order_number || header.invoice_number || '') || defaultDemoNumber(kind, countDemoDocs(businessId, kind) + 1),
    createdAt: new Date().toISOString(),
    headerMode: headerMode || DEFAULT_HEADER_MODE[kind],
    header,
    items,
    party,
  };
  const all = listDemoDocsSync(businessId);
  all.push(record);
  lsWrite(businessId, all);

  // PBS-113 write-through: best-effort persist into demo_documents
  // (is_demo is true by construction — all sandbox rows live here, never in
  // the accounting/stock/doc tables. Failure expected until the migration is
  // applied; the localStorage mirror keeps the sandbox fully functional.)
  void (async () => {
    try {
      await supabase.from('demo_documents').insert({
        business_id: businessId,
        kind: record.kind,
        number: record.number,
        header_mode: record.headerMode,
        is_demo: true,
        payload: { header: record.header, items: record.items, party: record.party },
      });
    } catch {
      /* table not applied yet — localStorage mirror is authoritative */
    }
  })();

  return record;
}

export function deleteDemoDoc(businessId: string, id: string): void {
  const record = lsAll(businessId).find((d) => d.id === id);
  lsWrite(
    businessId,
    lsAll(businessId).filter((d) => d.id !== id)
  );
  if (record) {
    void (async () => {
      try {
        await supabase.from('demo_documents').delete().eq('business_id', businessId).eq('number', record.number);
      } catch {
        /* table not applied yet — localStorage delete stands */
      }
    })();
  }
}

export function setDemoDocHeaderMode(businessId: string, id: string, headerMode: DemoHeaderMode): DemoDocRecord | null {
  const all = lsAll(businessId);
  const idx = all.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const updated = { ...all[idx], headerMode };
  all[idx] = updated;
  lsWrite(businessId, all);
  void (async () => {
    try {
      await supabase
        .from('demo_documents')
        .update({ header_mode: headerMode })
        .eq('business_id', businessId)
        .eq('number', updated.number);
    } catch {
      /* table not applied yet — localStorage update stands */
    }
  })();
  return updated;
}

/** Demo rows must never leak into real books — one shared guard. */
export function isDemoRow(row: { is_demo?: boolean } | null | undefined): boolean {
  return Boolean(row && (row.is_demo === true));
}

export function buildDemoCsv(
  kind: DemoKind,
  title: string,
  businessName: string,
  record: DemoDocRecord,
): { filename: string; csv: string } {
  const header = record.header as Record<string, number | string | null>;
  const party = record.party as Record<string, unknown> | null;
  const lines: string[] = [];
  const cell = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  lines.push(['Document', title].map(cell).join(','));
  lines.push(['Business', businessName].map(cell).join(','));
  lines.push(['Number', record.number].map(cell).join(','));
  lines.push(['Party', String(party?.company_name || party?.name || '—')].map(cell).join(','));
  lines.push('');
  lines.push(['Item', 'HSN/SAC', 'Qty', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'].join(','));
  for (const raw of record.items) {
    const it = raw as Record<string, number | string | null>;
    lines.push(
      [
        it.product_name || '—',
        it.hsn_sac || '—',
        it.quantity ?? '—',
        it.rate ?? 0,
        it.taxable_amount ?? '',
        it.cgst_amount ?? (kind === 'sales_invoice' ? 0 : ''),
        it.sgst_amount ?? (kind === 'sales_invoice' ? 0 : ''),
        it.igst_amount ?? 0,
        it.total_amount ?? 0,
      ]
        .map(cell)
        .join(',')
    );
  }
  lines.push('');
  lines.push(['Subtotal', header.subtotal ?? ''].map(cell).join(','));
  lines.push(['Taxable Amount', header.taxable_amount ?? ''].map(cell).join(','));
  lines.push(['Grand Total', header.grand_total ?? ''].map(cell).join(','));

  const filename = `Demo_${title.replace(/[^A-Za-z0-9]+/g, '_')}_${record.number.replace(/[/\\?%*:|"<>\n\r]+/g, '-')}.csv`;
  return { filename, csv: '\uFEFF' + lines.join('\r\n') };
}

export function downloadDemoCsv(kind: DemoKind, title: string, businessName: string, record: DemoDocRecord): void {
  const { filename, csv } = buildDemoCsv(kind, title, businessName, record);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sanitizeDemoFilename(s: string): string {
  return (s || '').replace(/[/\\?%*:|"<>\n\r]+/g, '-').trim() || 'Demo';
}
