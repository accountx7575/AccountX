import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
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
import { listTallyLedgerMappings, recordTallyExport } from '@/lib/tally/history';
import type { TallyCompanyInfo, TallyValidationIssue, TallyVoucher } from '@/lib/tally/types';
import type { Business } from '@/types/db';
import {
  fetchCashBankAccounts,
  fetchCashBankWindowMovement,
  fetchPayablesAging,
  fetchReceivablesAging,
} from '@/lib/gst/client';
import { Download, FileCode2, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { DatePicker } from '@/components/common/DatePicker';

interface TallyExportPanelProps {
  businessId: string;
  companyName: string;
  /** Optional full business row - enriches the export header (legal name/address/GSTIN/state). */
  business?: Business | null;
}

const DEFAULT_FROM = (() => {
  const d = new Date();
  return new Date(d.getFullYear(), 3, 1).toISOString().slice(0, 10); // FY start (Apr 1)
})();
const DEFAULT_TO = new Date().toISOString().slice(0, 10);

/** Day before the window start = opening-balance as-of date. */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function TallyExportPanel({ businessId, companyName, business }: TallyExportPanelProps) {
  const { toast } = useToast();
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(DEFAULT_TO);
  const [format, setFormat] = useState<'xml' | 'csv'>('xml');
  const [includeSales, setIncludeSales] = useState(true);
  const [includePurchases, setIncludePurchases] = useState(true);
  const [includePayments, setIncludePayments] = useState(true);
  const [includeJournals, setIncludeJournals] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeStockItems, setIncludeStockItems] = useState(true);
  const [includeOpening, setIncludeOpening] = useState(true);
  const [issues, setIssues] = useState<TallyValidationIssue[] | null>(null);
  const [generating, setGenerating] = useState(false);

  const companyInfo: TallyCompanyInfo = {
    name: companyName,
    legalName: business?.legal_name ?? null,
    address: [business?.address, business?.city].filter(Boolean).join(', ') || null,
    gstin: business?.gstin ?? null,
    state: business?.state ?? null,
  };

  const handleGenerate = async () => {
    if (from > to) {
      toast('The period end date is before the start date', 'error');
      return;
    }
    setGenerating(true);
    try {
      // Party masters
      const [{ data: customers }, { data: suppliers }] = await Promise.all([
        supabase.from('customers').select('name, gstin, state, address, pincode').eq('business_id', businessId),
        supabase.from('suppliers').select('name, gstin, state, address, pincode').eq('business_id', businessId),
      ]);
      const ledgers = mapPartiesToMasters(customers || [], suppliers || []);
      let stockItems: ReturnType<typeof mapProductsToStockMasters> = [];

      if (includeStockItems) {
        const { data: products, error } = await supabase
          .from('products')
          .select('name, unit, hsn_sac, description')
          .eq('business_id', businessId)
          .eq('is_active', true);
        if (error) throw error;
        stockItems = mapProductsToStockMasters(products || []);
      }

      const vouchers: TallyVoucher[] = [];
      const rawInvoices: any[] = [];
      const rawBills: any[] = [];
      const rawPayments: { payment_number: string; date: string; type: string; amount: number | null; party_name?: string | null }[] = [];
      const rawCreditNotes: any[] = [];
      const rawDebitNotes: any[] = [];

      if (includeSales) {
        const { data, error } = await supabase
          .from('sales_invoices')
          .select('invoice_number, invoice_date, status, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, grand_total, customer:customers(name, gstin)')
          .eq('business_id', businessId)
          .gte('invoice_date', from)
          .lte('invoice_date', to);
        if (error) throw error;
        rawInvoices.push(...(data || []));
        for (const row of data || []) {
          const v = mapInvoiceToVoucher(row as never);
          if (v) vouchers.push(v);
        }
      }

      if (includePurchases) {
        const { data, error } = await supabase
          .from('purchase_bills')
          .select('bill_number, bill_date, status, taxable_amount, cgst_amount, sgst_amount, igst_amount, cess_amount, round_off, grand_total, supplier:suppliers(name, gstin)')
          .eq('business_id', businessId)
          .gte('bill_date', from)
          .lte('bill_date', to);
        if (error) throw error;
        rawBills.push(...(data || []));
        for (const row of data || []) {
          const v = mapBillToVoucher(row as never);
          if (v) vouchers.push(v);
        }
      }

      if (includePayments) {
        const { data, error } = await supabase
          .from('payments')
          .select('payment_number, date, type, payment_method, amount, party_type, party_id')
          .eq('business_id', businessId)
          .in('type', [...EXPORTABLE_PAYMENT_TYPES])
          .gte('date', from)
          .lte('date', to);
        if (error) throw error;

        // Resolve party display names in one pass per side.
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

      if (includeJournals) {
        // REAL journal_entry_lines columns (migration 001): account_name /
        // debit_amount / credit_amount. System journals whose reference is a
        // source document are skipped - that document's own voucher above
        // already covers them.
        const { data: jes, error } = await supabase
          .from('journal_entries')
          .select('entry_number, date, narration, reference_type, lines:journal_entry_lines(account_name, debit_amount, credit_amount)')
          .eq('business_id', businessId)
          .eq('status', 'posted')
          .gte('date', from)
          .lte('date', to);
        if (error) throw error;
        for (const je of jes || []) {
          const refType = String(je.reference_type || '');
          if (refType && !refType.startsWith('manual')) continue;
          const v = mapJournalToVoucher(je as never);
          if (v) vouchers.push(v);
        }
      }

      if (includeNotes) {
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
        if (cnRes.error) throw cnRes.error;
        if (dnRes.error) throw dnRes.error;
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

      if (includeOpening) {
        const openingAsOf = dayBefore(from);
        const [arRows, apRows, cashAccounts, movement] = await Promise.all([
          fetchReceivablesAging(businessId, openingAsOf),
          fetchPayablesAging(businessId, openingAsOf),
          fetchCashBankAccounts(businessId),
          fetchCashBankWindowMovement(businessId, from, to),
        ]);
        const sumByParty = (rows: typeof arRows) => {
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

      // Pre-export preflight: doc-level issues BEFORE bundle build. Feeds the
      // same rows the mappers consumed, so every reported issue is a real
      // data-quality signal, never a row that would be skipped anyway.
      const preflightIssues = runPreflight({
        invoices: includeSales ? rawInvoices : [],
        bills: includePurchases ? rawBills : [],
        payments: rawPayments,
        notes: [
          ...rawCreditNotes.map((r) => ({
            note_number: r.credit_note_number,
            note_date: r.date,
            status: r.status,
            kind: 'credit' as const,
            taxable_amount: r.taxable_amount,
            cgst_amount: r.cgst_amount,
            sgst_amount: r.sgst_amount,
            igst_amount: r.igst_amount,
            cess_amount: r.cess_amount,
            round_off: r.round_off,
            grand_total: r.grand_total,
            party_name: r.customer?.name ?? null,
          })),
          ...rawDebitNotes.map((r) => ({
            note_number: r.debit_note_number,
            note_date: r.date,
            status: r.status,
            kind: 'debit' as const,
            taxable_amount: r.taxable_amount,
            cgst_amount: r.cgst_amount,
            sgst_amount: r.sgst_amount,
            igst_amount: r.igst_amount,
            cess_amount: r.cess_amount,
            round_off: r.round_off,
            grand_total: r.grand_total,
            party_name: r.supplier?.name ?? null,
          })),
        ],
        stockItems,
        gstRegistered: business?.gst_registered === true,
      });

      const bundle = applyLedgerOverrides(
        { companyName, ledgers, vouchers, stockItems, company: companyInfo },
        await listTallyLedgerMappings(businessId),
      );
      const allIssues = [...preflightIssues, ...validateBundle(bundle.ledgers, bundle.vouchers)];
      const errors = allIssues.filter((i) => i.severity === 'error');

      if (errors.length > 0 || allIssues.length > 0) {
        setIssues(allIssues);
      } else {
        setIssues(null);
      }

      if (errors.length > 0) {
        toast(`Export blocked: ${errors.length} validation error(s). First: ${errors[0].voucherNumber || ''} ${errors[0].message}`, 'error');
        return;
      }

      if (vouchers.length === 0) {
        toast('No exportable transactions found in the selected period', 'info');
        return;
      }

      const stamp = `${from}_${to}`;
      const base = `tally-export-${companyName.replace(/[^a-z0-9]+/gi, '-')}-${stamp}`;
      const content =
        format === 'xml'
          ? generateTallyXml(bundle)
          : generateTallyCsv(bundle);
      const blob = new Blob(
        [content],
        { type: format === 'xml' ? 'application/xml;charset=utf-8;' : 'text/csv;charset=utf-8;' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'xml' ? `${base}.xml` : `${base}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const warnCount = allIssues.filter((i) => i.severity === 'warning').length;
      toast(
        `Tally ${format.toUpperCase()} exported: ${vouchers.length} voucher(s), ${ledgers.length} ledger master(s)${stockItems.length ? `, ${stockItems.length} stock item(s)` : ''}${warnCount ? `, ${warnCount} warning(s)` : ''}`,
        'success',
      );

      // History flow (057): every successful generate is recorded via the
      // definer RPC with metadata sufficient for deterministic re-download.
      try {
        await recordTallyExport({
          businessId,
          dateFrom: from,
          dateTo: to,
          exportTypes: [
            includeSales && 'sales',
            includePurchases && 'purchase',
            includePayments && 'payments',
            includeJournals && 'journal',
            includeNotes && 'credit_debit_notes',
            includeOpening && 'opening_balances',
          ].filter(Boolean) as string[],
          recordCount: vouchers.length,
          successCount: vouchers.length,
          warningCount: warnCount,
          errorCount: 0,
          status: 'completed',
          metadata: {
            format,
            company_name: companyName,
            stock_item_count: stockItems.length,
            ledger_master_count: bundle.ledgers.length,
          },
        });
      } catch (histErr: any) {
        toast(`File downloaded, but export history could not be recorded: ${histErr?.message || 'unknown error'}`, 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Tally export failed', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const checkboxCls = "h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        <FileCode2 className="h-4 w-4 text-primary-600" /> Tally Export
      </div>
      <p className="text-xs text-secondary-500 dark:text-secondary-400">
        Generates a Tally-import file (Import Data envelope): party + stock item masters plus Sales / Purchase / Receipt / Payment / Journal / Credit Note / Debit Note vouchers and consolidated opening balances. Cancelled documents and drafts are excluded; refund-type payments ride inside their note voucher. Stock item HSN import is best-effort across Tally releases - voucher accounting never depends on it. Openings are computed from aging as of the day before the period start and live Cash/Bank balances less in-window movement; accuracy assumes books kept in AccountX.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        <label className="text-sm">
          <span className="block mb-1 text-secondary-600 dark:text-secondary-300">From</span>
          <DatePicker value={from} onChange={(v) => setFrom(v)}
            className="w-full rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block mb-1 text-secondary-600 dark:text-secondary-300">To</span>
          <DatePicker value={to} onChange={(v) => setTo(v)}
            className="w-full rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-3xl">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSales} onChange={(e) => setIncludeSales(e.target.checked)} className={checkboxCls} /> Sales</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includePurchases} onChange={(e) => setIncludePurchases(e.target.checked)} className={checkboxCls} /> Purchases</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includePayments} onChange={(e) => setIncludePayments(e.target.checked)} className={checkboxCls} /> Payments</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeJournals} onChange={(e) => setIncludeJournals(e.target.checked)} className={checkboxCls} /> Journals</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} className={checkboxCls} /> Credit/Debit Notes</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeStockItems} onChange={(e) => setIncludeStockItems(e.target.checked)} className={checkboxCls} /> Stock Items</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeOpening} onChange={(e) => setIncludeOpening(e.target.checked)} className={checkboxCls} /> Opening Balances</label>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" name="tally-format" checked={format === 'xml'} onChange={() => setFormat('xml')} className={checkboxCls} /> XML</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="tally-format" checked={format === 'csv'} onChange={() => setFormat('csv')} className={checkboxCls} /> CSV</label>
        </div>
      </div>
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
      >
        <Download className="h-4 w-4" />
        {generating ? 'Generating…' : format === 'xml' ? 'Generate & Download XML' : 'Generate & Download CSV'}
      </button>
      {issues && issues.length > 0 && (
        <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 divide-y divide-secondary-100 dark:divide-secondary-800 max-h-56 overflow-y-auto">
          {issues.map((iss, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs">
              {iss.severity === 'error'
                ? <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                : iss.severity === 'warning'
                  ? <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                  : <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-sky-500 shrink-0" />}
              <span className="text-secondary-600 dark:text-secondary-300">
                <span className="font-medium">{iss.voucherNumber}</span> — {iss.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
