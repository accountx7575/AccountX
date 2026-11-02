import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Database, Download, Upload } from 'lucide-react';
import { can, capabilityTooltip } from '@/lib/rbac';
import { buildFullLedgerJson } from '@/lib/exportLedger';
import { TallyExportPanel } from '@/components/settings/TallyExportPanel';
import { BulkImportPanel } from '@/components/settings/BulkImportPanel';

type CsvRow = Record<string, string | number | boolean | null>;

function toCsvValue(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(columns: string[], rows: CsvRow[]): string {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => toCsvValue(r[c])).join(','));
  return [header, ...body].join('\r\n');
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CUSTOMER_COLUMNS = ['name','company_name','phone','email','gstin','pan','address','city','state','pincode','opening_balance','current_balance','total_sales','credit_limit','status','notes','created_at'];
const SUPPLIER_COLUMNS = ['name','company_name','phone','email','gstin','pan','address','city','state','pincode','opening_balance','current_balance','status','notes','created_at'];
const PRODUCT_COLUMNS = ['name','sku','barcode','type','hsn_sac','unit','purchase_price','selling_price','tax_rate','tax_inclusive','opening_stock','current_stock','minimum_stock','description','is_active','created_at'];
const SALES_INVOICE_COLUMNS = ['invoice_number','invoice_date','due_date','customer','status','payment_status','place_of_supply','subtotal','discount_amount','taxable_amount','cgst_amount','sgst_amount','igst_amount','cess_amount','round_off','grand_total','paid_amount','balance_amount','product_name','hsn_sac','quantity','unit','rate','line_discount_amount','tax_rate','line_taxable_amount','line_cgst_amount','line_sgst_amount','line_igst_amount','line_total_amount'];
const PURCHASE_BILL_COLUMNS = ['bill_number','bill_date','due_date','supplier','status','payment_status','subtotal','discount_amount','taxable_amount','cgst_amount','sgst_amount','igst_amount','cess_amount','round_off','grand_total','paid_amount','balance_amount','product_name','hsn_sac','quantity','unit','rate','line_discount_amount','tax_rate','line_taxable_amount','line_cgst_amount','line_sgst_amount','line_igst_amount','line_total_amount'];

/**
 * Data Export + Bulk Import, formerly hosted on the Settings page —
 * rehomed to Admin → Database & Backup per PBS-116 (concern separation).
 * Self-contained: resolves the active business from AuthContext itself.
 */
export function DataExportPanel() {
  const { activeBusiness, activeRole } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState<string | null>(null);
  const canExportData = can(activeRole, 'data.export');

  function downloadJson(filename: string, json: string) {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportFullLedger() {
    if (!activeBusiness) return;
    setExporting('full-ledger');
    try {
      const bundle = await buildFullLedgerJson(activeBusiness.id);
      downloadJson(`accountx-full-ledger_${activeBusiness.name.replace(/[^a-z0-9]+/gi, '-')}_${bundle.fiscalYear.replace(/\s+/g, '')}.json`, JSON.stringify(bundle, null, 2));
      toast('Full-ledger backup downloaded', 'success');
    } catch (err: any) {
      toast(err.message || 'Backup failed', 'error');
    } finally {
      setExporting(null);
    }
  }

  async function fetchAll<T>(table: string, orderCol: string): Promise<T[]> {
    if (!activeBusiness) throw new Error('No active business');
    const { data, error } = await supabase.from(table).select('*').eq('business_id', activeBusiness.id).order(orderCol);
    if (error) throw error;
    return (data || []) as T[];
  }

  async function exportTable(key: string, label: string, table: string, orderCol: string, columns: string[]) {
    setExporting(key);
    try {
      const rows = await fetchAll<CsvRow>(table, orderCol);
      downloadCsv(`${activeBusiness?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'accountx'}-${key}.csv`, toCsv(columns, rows));
      toast(`${label} exported (${rows.length} rows)`, 'success');
    } catch (err: any) {
      toast(err.message || `Failed to export ${label}`, 'error');
    } finally {
      setExporting(null);
    }
  }

  async function exportSalesInvoices() {
    setExporting('sales-invoices');
    try {
      if (!activeBusiness) throw new Error('No active business');
      const bid = activeBusiness.id;
      const { data: invoices, error: invError } = await supabase
        .from('sales_invoices')
        .select('*, customer:customers(name)')
        .eq('business_id', bid)
        .order('invoice_date');
      if (invError) throw invError;
      const list = (invoices || []) as (Record<string, unknown> & { id: string; customer?: { name: string } | null })[];
      const ids = list.map((i) => i.id);
      const { data: lines, error: lineError } = ids.length
        ? await supabase.from('sales_invoice_items').select('*').in('invoice_id', ids)
        : { data: [], error: null };
      if (lineError) throw lineError;
      const lineRows = ((lines || []) as Record<string, unknown>[]);
      const linesByInvoice = new Map<string, Record<string, unknown>[]>();
      lineRows.forEach((l) => {
        const arr = linesByInvoice.get(l.invoice_id as string) || [];
        arr.push(l);
        linesByInvoice.set(l.invoice_id as string, arr);
      });
      const rows: CsvRow[] = [];
      list.forEach((inv) => {
        const docLines = linesByInvoice.get(inv.id) || [{}];
        docLines.forEach((l) => {
          rows.push({
            invoice_number: inv.invoice_number as string,
            invoice_date: inv.invoice_date as string,
            due_date: (inv.due_date as string) || '',
            customer: inv.customer?.name || '',
            status: inv.status as string,
            payment_status: inv.payment_status as string,
            place_of_supply: (inv.place_of_supply as string) || '',
            subtotal: inv.subtotal as number,
            discount_amount: inv.discount_amount as number,
            taxable_amount: inv.taxable_amount as number,
            cgst_amount: inv.cgst_amount as number,
            sgst_amount: inv.sgst_amount as number,
            igst_amount: inv.igst_amount as number,
            cess_amount: inv.cess_amount as number,
            round_off: inv.round_off as number,
            grand_total: inv.grand_total as number,
            paid_amount: inv.paid_amount as number,
            balance_amount: inv.balance_amount as number,
            product_name: (l.product_name as string) || '',
            hsn_sac: (l.hsn_sac as string) || '',
            quantity: l.quantity as number,
            unit: (l.unit as string) || '',
            rate: l.rate as number,
            line_discount_amount: l.discount_amount as number,
            tax_rate: l.tax_rate as number,
            line_taxable_amount: l.taxable_amount as number,
            line_cgst_amount: l.cgst_amount as number,
            line_sgst_amount: l.sgst_amount as number,
            line_igst_amount: l.igst_amount as number,
            line_total_amount: l.total_amount as number,
          });
        });
      });
      downloadCsv(`${activeBusiness?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'accountx'}-sales-invoices.csv`, toCsv(SALES_INVOICE_COLUMNS, rows));
      toast(`Sales invoices exported (${rows.length} line items)`, 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to export sales invoices', 'error');
    } finally {
      setExporting(null);
    }
  }

  async function exportPurchaseBills() {
    setExporting('purchase-bills');
    try {
      if (!activeBusiness) throw new Error('No active business');
      const bid = activeBusiness.id;
      const { data: bills, error: billError } = await supabase
        .from('purchase_bills')
        .select('*, supplier:suppliers(name)')
        .eq('business_id', bid)
        .order('bill_date');
      if (billError) throw billError;
      const list = (bills || []) as (Record<string, unknown> & { id: string; supplier?: { name: string } | null })[];
      const ids = list.map((b) => b.id);
      const { data: lines, error: lineError } = ids.length
        ? await supabase.from('purchase_bill_items').select('*').in('bill_id', ids)
        : { data: [], error: null };
      if (lineError) throw lineError;
      const lineRows = ((lines || []) as Record<string, unknown>[]);
      const linesByBill = new Map<string, Record<string, unknown>[]>();
      lineRows.forEach((l) => {
        const arr = linesByBill.get(l.bill_id as string) || [];
        arr.push(l);
        linesByBill.set(l.bill_id as string, arr);
      });
      const rows: CsvRow[] = [];
      list.forEach((bill) => {
        const docLines = linesByBill.get(bill.id) || [{}];
        docLines.forEach((l) => {
          rows.push({
            bill_number: bill.bill_number as string,
            bill_date: bill.bill_date as string,
            due_date: (bill.due_date as string) || '',
            supplier: bill.supplier?.name || '',
            status: bill.status as string,
            payment_status: bill.payment_status as string,
            subtotal: bill.subtotal as number,
            discount_amount: bill.discount_amount as number,
            taxable_amount: bill.taxable_amount as number,
            cgst_amount: bill.cgst_amount as number,
            sgst_amount: bill.sgst_amount as number,
            igst_amount: bill.igst_amount as number,
            cess_amount: bill.cess_amount as number,
            round_off: bill.round_off as number,
            grand_total: bill.grand_total as number,
            paid_amount: bill.paid_amount as number,
            balance_amount: bill.balance_amount as number,
            product_name: (l.product_name as string) || '',
            hsn_sac: (l.hsn_sac as string) || '',
            quantity: l.quantity as number,
            unit: (l.unit as string) || '',
            rate: l.rate as number,
            line_discount_amount: l.discount_amount as number,
            tax_rate: l.tax_rate as number,
            line_taxable_amount: l.taxable_amount as number,
            line_cgst_amount: l.cgst_amount as number,
            line_sgst_amount: l.sgst_amount as number,
            line_igst_amount: l.igst_amount as number,
            line_total_amount: l.total_amount as number,
          });
        });
      });
      downloadCsv(`${activeBusiness?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'accountx'}-purchase-bills.csv`, toCsv(PURCHASE_BILL_COLUMNS, rows));
      toast(`Purchase bills exported (${rows.length} line items)`, 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to export purchase bills', 'error');
    } finally {
      setExporting(null);
    }
  }

  if (!activeBusiness) return null;

  const exportBtnTitle = capabilityTooltip('data.export', activeRole) || undefined;

  return (
    <>
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-lg bg-secondary-100 dark:bg-secondary-800 p-2.5">
          <Database className="h-5 w-5 text-secondary-600 dark:text-secondary-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Data Export</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Download your data as CSV or JSON files</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" loading={exporting === 'customers'} disabled={!canExportData} title={exportBtnTitle} onClick={() => exportTable('customers', 'Customers', 'customers', 'name', CUSTOMER_COLUMNS)}>
          <Download className="h-4 w-4" /> Customers CSV
        </Button>
        <Button variant="secondary" loading={exporting === 'suppliers'} disabled={!canExportData} title={exportBtnTitle} onClick={() => exportTable('suppliers', 'Suppliers', 'suppliers', 'name', SUPPLIER_COLUMNS)}>
          <Download className="h-4 w-4" /> Suppliers CSV
        </Button>
        <Button variant="secondary" loading={exporting === 'products'} disabled={!canExportData} title={exportBtnTitle} onClick={() => exportTable('products', 'Products', 'products', 'name', PRODUCT_COLUMNS)}>
          <Download className="h-4 w-4" /> Products CSV
        </Button>
        <Button variant="secondary" loading={exporting === 'sales-invoices'} disabled={!canExportData} title={exportBtnTitle} onClick={exportSalesInvoices}>
          <Download className="h-4 w-4" /> Sales Invoices CSV
        </Button>
        <Button variant="secondary" loading={exporting === 'purchase-bills'} disabled={!canExportData} title={exportBtnTitle} onClick={exportPurchaseBills}>
          <Download className="h-4 w-4" /> Purchase Bills CSV
        </Button>
        <Button variant="secondary" loading={exporting === 'full-ledger'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={exportFullLedger}>
          <Database className="h-4 w-4" /> Full-Ledger Backup (JSON)
        </Button>
      </div>

      <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
        <TallyExportPanel
          businessId={activeBusiness.id}
          companyName={activeBusiness.name}
          business={activeBusiness}
        />
      </div>

      <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
            <Upload className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Bulk Import</h3>
            <p className="text-xs text-secondary-500 dark:text-secondary-400">Bring in customers, suppliers and products from CSV</p>
          </div>
        </div>
        <BulkImportPanel businessId={activeBusiness.id} />
      </div>
    </>
  );
}
