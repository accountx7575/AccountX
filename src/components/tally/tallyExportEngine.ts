import { supabase } from '@/lib/supabase';
import { generateTallyCsv, generateTallyXml, applyLedgerOverrides, validateBundle } from '@/lib/tally/generator';
import {
  buildApOpeningVoucher,
  buildArOpeningVoucher,
  buildCashBankOpeningVoucher,
  deriveCashBankOpening,
  mapBillToVoucher,
  mapCreditNoteToVoucher,
  mapDebitNoteToVoucher,
  mapInvoiceToVoucher,
  mapJournalToVoucher,
  mapPartiesToMasters,
  mapPaymentToVoucher,
  mapProductsToStockMasters,
  openingOffsetMaster,
  EXPORTABLE_PAYMENT_TYPES,
} from '@/lib/tally/mapping';
import { runPreflight } from '@/lib/tally/preflight';
import { listTallyLedgerMappings } from '@/lib/tally/history';
import type { TallyCompanyInfo, TallyExportBundle, TallyValidationIssue, TallyVoucher } from '@/lib/tally/types';

/* ============================================================================
 * Tally export engine wrapper (T104). Mirrors the data assembly of
 * SettingsPanel/TallyExportPanel.tsx (Stanley's surface stays working until
 * god's integration swap); wizard + history re-download consume THIS module.
 * Pure-ish: one async build per call, no hidden caching - a re-download
 * regenerates from live data for the STORED params (documented honestly).
 * ==========================================================================*/

export interface TallySelection {
  sales: boolean;
  purchases: boolean;
  payments: boolean;
  journals: boolean;
  notes: boolean;
  stockItems: boolean;
  opening: boolean;
}

export const ALL_SELECTION: TallySelection = {
  sales: true, purchases: true, payments: true, journals: true, notes: true, stockItems: true, opening: true,
};

export const EXPORT_TYPE_KEYS: Record<keyof TallySelection, string> = {
  sales: 'sales',
  purchases: 'purchase',
  payments: 'payments',
  journals: 'journal',
  notes: 'credit_debit_notes',
  stockItems: 'stock_items',
  opening: 'opening_balances',
};

export interface BuildTallyArgs {
  businessId: string;
  companyName: string;
  companyInfo: TallyCompanyInfo;
  gstRegistered: boolean;
  from: string;
  to: string;
  selection: TallySelection;
}

export interface BuiltTallyExport {
  bundle: TallyExportBundle;
  /** preflight + bundle validation, sorted errors-first */
  issues: TallyValidationIssue[];
  errorCount: number;
  warningCount: number;
  voucherCount: number;
  ledgerCount: number;
  stockItemCount: number;
}

/** Day before the window start = opening-balance as-of date (panel convention). */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function buildTallyExport(args: BuildTallyArgs): Promise<BuiltTallyExport> {
  const { businessId, companyName, companyInfo, gstRegistered, from, to, selection } = args;

  // Party masters always ship (harmless duplicates in Tally).
  const [{ data: customers }, { data: suppliers }] = await Promise.all([
    supabase.from('customers').select('name, gstin, state, address, pincode').eq('business_id', businessId),
    supabase.from('suppliers').select('name, gstin, state, address, pincode').eq('business_id', businessId),
  ]);
  const ledgers = mapPartiesToMasters(customers || [], suppliers || []);
  let stockItems: ReturnType<typeof mapProductsToStockMasters> = [];

  if (selection.stockItems) {
    const { data: products, error } = await supabase
      .from('products')
      .select('name, unit, hsn_sac, description')
      .eq('business_id', businessId)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    stockItems = mapProductsToStockMasters(products || []);
  }

  const vouchers: TallyVoucher[] = [];
  const rawInvoices: unknown[] = [];
  const rawBills: unknown[] = [];
  const rawPayments: { payment_number: string; date: string; type: string; amount: number | null; party_name?: string | null }[] = [];
  const rawCreditNotes: unknown[] = [];
  const rawDebitNotes: unknown[] = [];

  if (selection.sales) {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('invoice_number, invoice_date, status, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, grand_total, customer:customers(name, gstin)')
      .eq('business_id', businessId)
      .gte('invoice_date', from)
      .lte('invoice_date', to);
    if (error) throw new Error(error.message);
    rawInvoices.push(...(data || []));
    for (const row of data || []) {
      const v = mapInvoiceToVoucher(row as never);
      if (v) vouchers.push(v);
    }
  }

  if (selection.purchases) {
    const { data, error } = await supabase
      .from('purchase_bills')
      .select('bill_number, bill_date, status, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, grand_total, supplier:suppliers(name, gstin)')
      .eq('business_id', businessId)
      .gte('bill_date', from)
      .lte('bill_date', to);
    if (error) throw new Error(error.message);
    rawBills.push(...(data || []));
    for (const row of data || []) {
      const v = mapBillToVoucher(row as never);
      if (v) vouchers.push(v);
    }
  }

  if (selection.payments) {
    const { data, error } = await supabase
      .from('payments')
      .select('payment_number, date, type, payment_method, amount, party_type, party_id')
      .eq('business_id', businessId)
      .in('type', [...EXPORTABLE_PAYMENT_TYPES])
      .gte('date', from)
      .lte('date', to);
    if (error) throw new Error(error.message);

    const customerIds = [...new Set((data || []).filter((p: any) => p.party_type === 'customer').map((p: any) => p.party_id))];
    const supplierIds = [...new Set((data || []).filter((p: any) => p.party_type === 'supplier').map((p: any) => p.party_id))];
    const nameById = new Map<string, string>();
    if (customerIds.length) {
      const { data: cs } = await supabase.from('customers').select('id, name').in('id', customerIds);
      for (const c of cs || []) nameById.set(c.id, c.name);
    }
    if (supplierIds.length) {
      const { data: ss } = await supabase.from('suppliers').select('id, name').in('id', supplierIds);
      for (const s of ss || []) nameById.set(s.id, s.name);
    }
    for (const p of data || []) {
      const party_name = nameById.get((p as any).party_id) || null;
      rawPayments.push({
        payment_number: (p as any).payment_number,
        date: (p as any).date,
        type: (p as any).type,
        amount: (p as any).amount ?? null,
        party_name,
      });
      const v = mapPaymentToVoucher({ ...(p as any), party_name });
      if (v) vouchers.push(v);
    }
  }

  if (selection.journals) {
    // System journals referencing source docs are skipped - that document's own
    // voucher above already covers them (panel convention, kept identical).
    const { data: jes, error } = await supabase
      .from('journal_entries')
      .select('entry_number, date, narration, reference_type, lines:journal_entry_lines(account_name, debit_amount, credit_amount)')
      .eq('business_id', businessId)
      .eq('status', 'posted')
      .gte('date', from)
      .lte('date', to);
    if (error) throw new Error(error.message);
    for (const je of jes || []) {
      const refType = String(je.reference_type || '');
      if (refType && !refType.startsWith('manual')) continue;
      const v = mapJournalToVoucher(je as never);
      if (v) vouchers.push(v);
    }
  }

  if (selection.notes) {
    const [cnRes, dnRes] = await Promise.all([
      supabase
        .from('credit_notes')
        .select('credit_note_number, date, status, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, grand_total, reason, customer:customers(name, gstin)')
        .eq('business_id', businessId)
        .in('status', ['issued', 'applied'])
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('debit_notes')
        .select('debit_note_number, date, status, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, grand_total, reason, supplier:suppliers(name, gstin)')
        .eq('business_id', businessId)
        .in('status', ['issued', 'applied'])
        .gte('date', from)
        .lte('date', to),
    ]);
    if (cnRes.error) throw new Error(cnRes.error.message);
    if (dnRes.error) throw new Error(dnRes.error.message);
    rawCreditNotes.push(...(cnRes.data || []));
    rawDebitNotes.push(...(dnRes.data || []));
    for (const row of cnRes.data || []) {
      const v = mapCreditNoteToVoucher(row as never);
      if (v) vouchers.push(v);
    }
    for (const row of dnRes.data || []) {
      const v = mapDebitNoteToVoucher(row as never);
      if (v) vouchers.push(v);
    }
  }

  if (selection.opening) {
    const openingAsOf = dayBefore(from);
    const [arRows, apRows, cashAccounts, movement] = await Promise.all([
      import('@/lib/gst/client').then((m) => m.fetchReceivablesAging(businessId, openingAsOf)),
      import('@/lib/gst/client').then((m) => m.fetchPayablesAging(businessId, openingAsOf)),
      import('@/lib/gst/client').then((m) => m.fetchCashBankAccounts(businessId)),
      import('@/lib/gst/client').then((m) => m.fetchCashBankWindowMovement(businessId, from, to)),
    ]);
    const sumByParty = (rows: { party_name?: string | null; outstanding?: number | null }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const name = String(r.party_name || '').trim();
        if (!name) continue;
        m.set(name, Math.round(((m.get(name) || 0) + Number(r.outstanding || 0)) * 100) / 100);
      }
      return [...m.entries()].map(([partyName, amount]) => ({ partyName, amount }));
    };
    const ar = buildArOpeningVoucher(sumByParty(arRows), openingAsOf);
    const ap = buildApOpeningVoucher(sumByParty(apRows), openingAsOf);
    const cashBank = buildCashBankOpeningVoucher(
      cashAccounts.map((a) => ({
        ledgerName: a.name,
        opening: deriveCashBankOpening(Number(a.current_balance), a.name === 'Cash' ? movement.Cash : movement.Bank),
      })),
      openingAsOf,
    );
    for (const v of [ar, ap, cashBank]) {
      if (v) {
        vouchers.push(v);
        ledgers.push(openingOffsetMaster());
      }
    }
  }

  vouchers.sort((a, b) => a.date.localeCompare(b.date));

  const preflightIssues = runPreflight({
    invoices: selection.sales ? (rawInvoices as never[]) : [],
    bills: selection.purchases ? (rawBills as never[]) : [],
    payments: rawPayments,
    notes: [
      ...rawCreditNotes.map((r) => normalizeNote(r, 'credit')),
      ...rawDebitNotes.map((r) => normalizeNote(r, 'debit')),
    ],
    stockItems,
    gstRegistered,
  });

  const bundle = applyLedgerOverrides(
    { companyName, ledgers, vouchers, stockItems, company: companyInfo },
    await listTallyLedgerMappings(businessId),
  );
  const allIssues = [...preflightIssues, ...validateBundle(bundle.ledgers, bundle.vouchers)].sort(sortIssues);

  return {
    bundle,
    issues: allIssues,
    errorCount: allIssues.filter((i) => i.severity === 'error').length,
    warningCount: allIssues.filter((i) => i.severity === 'warning').length,
    voucherCount: vouchers.length,
    ledgerCount: bundle.ledgers.length,
    stockItemCount: stockItems.length,
  };
}

function normalizeNote(r: any, kind: 'credit' | 'debit') {
  return {
    note_number: kind === 'credit' ? r.credit_note_number : r.debit_note_number,
    note_date: r.date,
    status: r.status,
    kind,
    taxable_amount: r.taxable_amount,
    cgst_amount: r.cgst_amount,
    sgst_amount: r.sgst_amount,
    igst_amount: r.igst_amount,
    cess_amount: r.cess_amount,
    round_off: r.round_off,
    grand_total: r.grand_total,
    party_name: (kind === 'credit' ? r.customer?.name : r.supplier?.name) ?? null,
  };
}

function sortIssues(a: TallyValidationIssue, b: TallyValidationIssue): number {
  if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
  return (a.voucherNumber || '').localeCompare(b.voucherNumber || '');
}

/** Serialize + download. Returns the exact filename used. */
export function downloadTallyExport(bundle: TallyExportBundle, format: 'xml' | 'csv', companyName: string, from: string, to: string): string {
  const stamp = `${from}_${to}`;
  const base = `tally-export-${companyName.replace(/[^a-z0-9]+/gi, '-')}-${stamp}`;
  const content = format === 'xml' ? generateTallyXml(bundle) : generateTallyCsv(bundle);
  const blob = new Blob([content], { type: format === 'xml' ? 'application/xml;charset=utf-8;' : 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = format === 'xml' ? `${base}.xml` : `${base}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return format === 'xml' ? `${base}.xml` : `${base}.csv`;
}
