import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Settings, Building2, Save, Database, Download, FileDown, Users, UserMinus, ShieldCheck, PenTool, Upload, X, BellRing, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CommunicationCenterPanel } from '@/components/settings/CommunicationCenterPanel';
import { MessageTemplatesPanel } from '@/components/settings/MessageTemplatesPanel';
import { ScheduledReportsPanel } from '@/components/settings/ScheduledReportsPanel';
import { can, capabilityTooltip, roleLabel, type Role } from '@/lib/rbac';
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry';
import { buildFullLedgerJson } from '@/lib/exportLedger';
import { TallyExportPanel } from '@/components/settings/TallyExportPanel';
import { BulkImportPanel } from '@/components/settings/BulkImportPanel';
import { PageMotion } from '@/lib/motion';
import { formatDate } from '@/lib/utils';

const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Puducherry'];

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI_ID_REGEX = /^[A-Za-z0-9.@-]{2,60}$/;
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function StampSignatureSlot({
  title,
  hint,
  value,
  disabled,
  onPick,
  onRemove,
}: {
  title: string;
  hint: string;
  value: string | null | undefined;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputId = `img-${title.replace(/[^a-z]+/gi, '-').toLowerCase()}`;
  return (
    <div className="rounded-xl border border-secondary-200 dark:border-secondary-700 p-4">
      <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{title}</p>
      <p className="text-xs text-secondary-400 mt-0.5 mb-3">{hint}</p>
      <div className="h-20 rounded-lg border border-dashed border-secondary-300 dark:border-secondary-600 bg-secondary-50/60 dark:bg-secondary-800/40 flex items-center justify-center overflow-hidden mb-3">
        {value ? (
          <img src={value} alt={title} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[11px] text-secondary-300 px-4 text-center leading-tight">No image uploaded</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className={
            disabled
              ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-400 cursor-not-allowed'
              : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/50 cursor-pointer transition-colors'
          }
        >
          <Upload className="h-3.5 w-3.5" />
          {value ? 'Replace' : 'Upload Image'}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = '';
          }}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove image"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

type BusinessMemberRow = {
  membership_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role | string;
  is_active: boolean | null;
  invited_at: string | null;
  joined_at: string | null;};

export function SettingsPage() {
  const { activeBusiness, activeRole, user, refreshBusinesses } = useAuth();
  const { toast } = useToast();
  const { logAdminEvent } = useAdminTelemetry();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', legal_name: '', phone: '', email: '', address: '', city: '', state: 'Maharashtra',
    gstin: '', pan: '', financial_year: '2026-27', currency_symbol: '₹', invoice_prefix: 'INV',
    gst_registered: false,
    stamp_url: '' as string | null,
    signature_url: '' as string | null,
    upi_id: '',
    invoice_footer_text: '',
    invoice_signature_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc_code: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState<string | null>(null);

  const canEditSettings = can(activeRole, 'settings.edit');
  const canManageMembers = can(activeRole, 'members.manage');
  const canExportData = can(activeRole, 'data.export');
  const settingsLockTooltip = capabilityTooltip('settings.edit', activeRole);

  useEffect(() => {
    if (activeBusiness) {
      setForm({
        name: activeBusiness.name || '',
        legal_name: activeBusiness.legal_name || '',
        phone: activeBusiness.phone || '',
        email: activeBusiness.email || '',
        address: activeBusiness.address || '',
        city: activeBusiness.city || '',
        state: activeBusiness.state || 'Maharashtra',
        gstin: activeBusiness.gstin || '',
        pan: activeBusiness.pan || '',
        financial_year: activeBusiness.financial_year || '2026-27',
        currency_symbol: activeBusiness.currency_symbol || '₹',
        invoice_prefix: activeBusiness.invoice_prefix || 'INV',
        gst_registered: activeBusiness.gst_registered,
        stamp_url: activeBusiness.stamp_url || '',
        signature_url: activeBusiness.signature_url || '',
        upi_id: activeBusiness.upi_id || '',
        invoice_footer_text: activeBusiness.invoice_footer_text || '',
        invoice_signature_name: activeBusiness.invoice_signature_name || '',
        bank_name: activeBusiness.bank_name || '',
        bank_account_number: activeBusiness.bank_account_number || '',
        bank_ifsc_code: activeBusiness.bank_ifsc_code || '',
      });
    }
  }, [activeBusiness]);

  /* ------------------------------ members ------------------------------- */

  const readImageFile = (file: File, field: 'stamp_url' | 'signature_url') => {
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      toast('Use a PNG or JPG image', 'error');
      return;
    }
    if (file.size > 500 * 1024) {
      toast('Image must be under 500 KB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, [field]: String(reader.result) }));
    reader.onerror = () => toast('Could not read that image', 'error');
    reader.readAsDataURL(file);
  };

  const ownerFallbackRows = (): BusinessMemberRow[] => {
    if (!user) return [];
    return [{
      membership_id: `fallback-${user.id}`,
      user_id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.name as string | undefined) ?? null,
      role: activeRole ?? 'owner',
      is_active: true,
      invited_at: null,
      joined_at: null,
    }];
  };

  const membersQuery = useQuery({
    queryKey: ['business-members', activeBusiness?.id],
    queryFn: async (): Promise<BusinessMemberRow[]> => {
      if (!activeBusiness || !user) return ownerFallbackRows();
      try {
        const { data, error } = await supabase
          .from('v_member_directory')
          .select('membership_id, user_id, email, full_name, role, is_active, invited_at, joined_at')
          .eq('business_id', activeBusiness.id)
          .order('joined_at');
        if (error) throw error;
        const rows = (data ?? []) as BusinessMemberRow[];
        if (rows.length === 0) return ownerFallbackRows();
        return rows;
      } catch {
        return ownerFallbackRows();
      }
    },
    enabled: !!activeBusiness,
    retry: false,
  });

  const removeMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      if (!activeBusiness) throw new Error('No active business');
      const { data, error } = await supabase.rpc('remove_business_member', {
        p_business_id: activeBusiness.id,
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast('Member removed from business', 'success');
      await queryClient.invalidateQueries({ queryKey: ['business-members', activeBusiness?.id] });
      await refreshBusinesses();
    },
    onError: (err: Error) => toast(err.message || 'Failed to remove member', 'error'),
  });

  function removalBlockReason(m: BusinessMemberRow): string | null {
    if (!canManageMembers) return capabilityTooltip('members.manage', activeRole);
    if (m.user_id === user?.id) return "You can't remove yourself";
    if (m.role === 'owner') return 'The business owner cannot be removed';
    return null;
  }

  function confirmRemove(m: BusinessMemberRow) {
    // Impersonation guard: a super-admin viewing a tenant dashboard must not
    // accidentally mutate mission-critical tenant settings (member removal,
    // business deletion). Block with an audit event instead.
    let impersonating = false;
    try {
      impersonating =
        localStorage.getItem('super_admin_impersonating') === 'true' ||
        localStorage.getItem('accountx_impersonating') === 'true';
    } catch {
      impersonating = false;
    }
    if (impersonating) {
      toast('Disabled in Super Admin support mode — exit to Admin Control Center to manage members.', 'error');
      void logAdminEvent('DESTRUCTIVE_BLOCKED', activeBusiness?.id ?? null, {
        attempted: 'remove_business_member',
        target_user_id: m.user_id,
      });
      return;
    }
    const reason = removalBlockReason(m);
    if (reason) return;
    if (window.confirm('Remove this member from the business? Their access ends immediately.')) {
      removeMutation.mutate(m.user_id);
    }
  }

  /* ----------------------------- settings ------------------------------- */

  const fyOptions = useMemo(() => {
    const nowYear = new Date().getFullYear();
    const options: string[] = [];
    for (let y = nowYear + 1; y >= nowYear - 3; y--) {
      options.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
    }
    return options;
  }, []);

  const fyList = useMemo(() => {
    if (form.financial_year && !fyOptions.includes(form.financial_year)) {
      return [...fyOptions, form.financial_year];
    }
    return fyOptions;
  }, [fyOptions, form.financial_year]);

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Business name is required';
    if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) e.email = 'Enter a valid email address';
    if (form.gst_registered) {
      if (!form.gstin.trim()) e.gstin = 'GSTIN is required for GST-registered businesses';
      else if (!GSTIN_REGEX.test(form.gstin.trim())) e.gstin = 'Invalid GSTIN — expected 15 chars: 2-digit state code + PAN + entity number + Z + checksum';
    } else if (form.gstin.trim() && !GSTIN_REGEX.test(form.gstin.trim())) {
      e.gstin = 'Invalid GSTIN — expected 15 chars: 2-digit state code + PAN + entity number + Z + checksum';
    }
    if (form.pan.trim() && !PAN_REGEX.test(form.pan.trim())) e.pan = 'Invalid PAN — expected 10 chars like ABCDE1234F';
    if (form.upi_id.trim() && !UPI_ID_REGEX.test(form.upi_id.trim())) e.upi_id = 'Invalid UPI ID — use only letters, numbers, dots, @ and dashes (e.g. business@upi)';
    if (form.bank_ifsc_code.trim() && !IFSC_REGEX.test(form.bank_ifsc_code.trim())) e.bank_ifsc_code = 'Invalid IFSC - format SBIN0001234';
    if (form.bank_account_number.trim() && !/^[0-9][0-9 -]{4,18}[0-9]$/.test(form.bank_account_number.trim())) e.bank_account_number = 'Account number must be 6-20 digits (spaces/dashes allowed)';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      const payload: Record<string, unknown> = {
        name: form.name,
        legal_name: form.legal_name || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state,
        pan: form.pan || null,
        financial_year: form.financial_year,
        currency_symbol: form.currency_symbol,
        invoice_prefix: form.invoice_prefix,
        gst_registered: form.gst_registered,
        stamp_url: form.stamp_url || null,
        signature_url: form.signature_url || null,
        upi_id: form.upi_id || null,
        invoice_footer_text: form.invoice_footer_text.trim() || null,
        invoice_signature_name: form.invoice_signature_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_account_number: form.bank_account_number || null,
        bank_ifsc_code: form.bank_ifsc_code.toUpperCase() || null,
      };
      if (form.gst_registered) {
        payload.gstin = form.gstin || null;
      }
      const { error } = await supabase.from('businesses').update(payload).eq('id', activeBusiness.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshBusinesses();
      toast('Business settings updated successfully', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to update settings', 'error'),
  });

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

  function downloadJson(filename: string, json: string) {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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

  const sym = '₹';

  if (!activeBusiness) return null;

  return (
    <PageMotion>
      <PageHeader title="Settings" subtitle="Manage your business configuration" />

      <nav aria-label="Settings sections" className="sticky top-[64px] z-20 -mx-1 mb-4 flex gap-2 overflow-x-auto py-2 px-1 backdrop-blur-sm">
        {[
          { id: 'settings-members', label: 'Members' },
          { id: 'settings-profile', label: 'Business Profile' },
          { id: 'settings-gst', label: 'GST & Tax' },
          { id: 'settings-signature', label: 'Signature & Stamp' },
          { id: 'settings-invoice', label: 'Invoice' },
          { id: 'settings-comms', label: 'Notifications & Comms' },
          { id: 'settings-export', label: 'Data Export' },
          { id: 'settings-import', label: 'Bulk Import' },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="shrink-0 rounded-full border border-secondary-200 dark:border-secondary-700 bg-white/80 dark:bg-zinc-900/80 px-3.5 py-1.5 text-xs font-medium text-secondary-600 dark:text-secondary-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            {s.label}
          </button>
        ))}
      </nav>

      {!canEditSettings && (
        <div className="card p-4 mb-6 flex items-center gap-3 border-warning-300 dark:border-warning-700">
          <ShieldCheck className="h-5 w-5 text-warning-500 shrink-0" />
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            You have <span className="font-semibold text-secondary-900 dark:text-secondary-100">{roleLabel(activeRole)}</span> access — business settings are read-only for you.
          </p>
        </div>
      )}

      <div className="space-y-6 scroll-mt-24">
        {/* Members */}
        <div id="settings-members" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <Users className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Team Members</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">People with access to this business</p>
            </div>
          </div>

          {membersQuery.isLoading ? (
            <div className="animate-pulse space-y-2" aria-busy="true">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-secondary-100 dark:bg-secondary-800" />
              ))}
            </div>
          ) : (membersQuery.data ?? []).length === 0 ? (
            <EmptyState icon={Users} title="No members listed" description="Membership records could not be loaded for this business." />
          ) : (
            <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {(membersQuery.data ?? []).map((m) => {
                const blockReason = removalBlockReason(m);
                const isYou = m.user_id === user?.id;
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3 px-2 -mx-2 rounded-lg transition-colors hover:bg-secondary-50/70 dark:hover:bg-secondary-800/40">
                    <div className={
                      m.role === 'owner'
                        ? 'h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0'
                        : 'h-9 w-9 rounded-full bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center text-xs font-semibold text-secondary-600 dark:text-secondary-300 shrink-0'
                    } aria-hidden="true">
                      {m.role === 'owner' ? '★' : roleLabel(m.role).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">
                        {m.full_name || (isYou ? user?.email || 'You' : m.email) || `Member ${m.user_id.slice(0, 8)}…`}
                        {isYou && <span className="ml-1.5 text-xs font-normal text-primary-500">(you)</span>}
                      </p>
                      <p className="figure text-xs text-secondary-400 truncate">{m.email || (m.joined_at ? `Joined ${formatDate(m.joined_at)}` : 'Join date unavailable')}</p>
                    </div>
                    {m.is_active === false && (
                      <Badge variant="error">deactivated</Badge>
                    )}
                    <Badge variant={m.role === 'owner' ? 'primary' : m.is_active === false ? 'neutral' : 'info'}>
                      {roleLabel(m.role)}
                      {m.is_active === false ? ' · inactive' : ''}
                    </Badge>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => confirmRemove(m)}
                      disabled={!!blockReason}
                      loading={removeMutation.isPending && removeMutation.variables === m.user_id}
                      title={blockReason ?? `Remove ${roleLabel(m.role)} from this business`}
                      aria-label={`Remove member with role ${roleLabel(m.role)}`}
                    >
                      <UserMinus className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {!canManageMembers && (
            <p className="mt-4 text-xs text-secondary-400">
              Member management requires owner or admin access — removal stays disabled until then.
            </p>
          )}
        </div>

        {/* Business Profile */}
        <div id="settings-profile" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Business Profile</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Update your business information</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Business Name" required error={errors.name}>
              <Input value={form.name} disabled={!canEditSettings} title={!canEditSettings ? settingsLockTooltip : undefined} onChange={(e) => { clearError('name'); setForm({ ...form, name: e.target.value }); }} />
            </FormField>
            <FormField label="Legal Name"><Input value={form.legal_name} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></FormField>
            <FormField label="Phone"><Input type="tel" value={form.phone} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
            <FormField label="Email" error={errors.email}>
              <Input type="email" value={form.email} disabled={!canEditSettings} onChange={(e) => { clearError('email'); setForm({ ...form, email: e.target.value }); }} />
            </FormField>
            <FormField label="City"><Input value={form.city} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, city: e.target.value })} /></FormField>
            <FormField label="UPI ID" error={errors.upi_id}>
              <Input
                value={form.upi_id}
                disabled={!canEditSettings}
                maxLength={60}
                placeholder="business@upi"
                onChange={(e) => { clearError('upi_id'); setForm({ ...form, upi_id: e.target.value.trim() }); }}
              />
              <p className="text-xs text-secondary-400 mt-1">Shown on invoices for UPI QR payments</p>
            </FormField>
            <FormField label="Bank Name">
              <Input
                value={form.bank_name}
                disabled={!canEditSettings}
                maxLength={80}
                placeholder="HDFC Bank"
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              />
            </FormField>
            <FormField label="Account Number" error={errors.bank_account_number}>
              <Input
                value={form.bank_account_number}
                disabled={!canEditSettings}
                maxLength={20}
                placeholder="1234567890"
                onChange={(e) => { clearError('bank_account_number'); setForm({ ...form, bank_account_number: e.target.value }); }}
              />
              <p className="text-xs text-secondary-400 mt-1">Printed on documents - never shared</p>
            </FormField>
            <FormField label="IFSC Code" error={errors.bank_ifsc_code}>
              <Input
                value={form.bank_ifsc_code}
                disabled={!canEditSettings}
                maxLength={11}
                placeholder="SBIN0001234"
                onChange={(e) => { clearError('bank_ifsc_code'); setForm({ ...form, bank_ifsc_code: e.target.value.toUpperCase() }); }}
              />
            </FormField>
            <FormField label="State">
              <Select value={form.state} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </FormField>
          </div>
          <div className="mt-4">
            <FormField label="Address"><Textarea value={form.address} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} /></FormField>
          </div>
        </div>

        {/* GST & Tax */}
        <div id="settings-gst" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-success-100 dark:bg-success-900/30 p-2.5">
              <Settings className="h-5 w-5 text-success-600 dark:text-success-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">GST & Tax Settings</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Configure GST registration details</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="GSTIN" error={errors.gstin}>
              <Input
                value={form.gstin}
                onChange={(e) => { clearError('gstin'); setForm({ ...form, gstin: e.target.value.toUpperCase() }); }}
                onBlur={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase().trim() })}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
                disabled={!form.gst_registered || !canEditSettings}
              />
            </FormField>
            <FormField label="PAN" error={errors.pan}>
              <Input
                value={form.pan}
                onChange={(e) => { clearError('pan'); setForm({ ...form, pan: e.target.value.toUpperCase() }); }}
                onBlur={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().trim() })}
                maxLength={10}
                placeholder="ABCDE1234F"
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-3 mt-4 p-4 rounded-lg border border-secondary-200 dark:border-secondary-700 cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800/50">
            <input
              type="checkbox"
              checked={form.gst_registered}
              onChange={(e) => {
                if (!canEditSettings) return;
                const checked = e.target.checked;
                setForm((f) => ({ ...f, gst_registered: checked, gstin: checked ? f.gstin : '' }));
                if (checked) clearError('gstin');
              }}
              disabled={!canEditSettings}
              className="h-4 w-4 rounded accent-primary-600"
            />
            <div>
              <span className="text-sm font-medium text-secondary-900 dark:text-secondary-100">GST Registered Business</span>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Enable GST calculations on invoices and purchases</p>
            </div>
          </label>
          {!form.gst_registered && (
            <p className="mt-2 text-xs text-secondary-400">Disable GST registration to clear and hide GSTIN entry.</p>
          )}
        </div>

        {/* Signature & Stamp */}
        <div id="settings-signature" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <PenTool className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Signature &amp; Stamp</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Auto-rendered on every tax invoice (PNG/JPG up to 500 KB)</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StampSignatureSlot
              title="Company Stamp / Seal"
              hint="Square seal renders top-right of the signatory block"
              value={form.stamp_url}
              disabled={!canEditSettings}
              onPick={(f) => readImageFile(f, 'stamp_url')}
              onRemove={() => setForm((prev) => ({ ...prev, stamp_url: '' }))}
            />
            <StampSignatureSlot
              title="Authorized Signatory Signature"
              hint="Transparent PNG recommended - sits above the sign line"
              value={form.signature_url}
              disabled={!canEditSettings}
              onPick={(f) => readImageFile(f, 'signature_url')}
              onRemove={() => setForm((prev) => ({ ...prev, signature_url: '' }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <FormField label="Signature Name">
              <Input
                value={form.invoice_signature_name}
                disabled={!canEditSettings}
                maxLength={80}
                placeholder="e.g. Rajesh Kumar - Proprietor"
                onChange={(e) => setForm((prev) => ({ ...prev, invoice_signature_name: e.target.value }))}
              />
              <p className="text-xs text-secondary-400 mt-1">Printed above the signature block when set</p>
            </FormField>
            <FormField label="Invoice Footer Text">
              <Textarea
                value={form.invoice_footer_text}
                disabled={!canEditSettings}
                rows={2}
                placeholder="e.g. Goods once sold will not be taken back. Subject to Mumbai jurisdiction."
                onChange={(e) => setForm((prev) => ({ ...prev, invoice_footer_text: e.target.value }))}
              />
              <p className="text-xs text-secondary-400 mt-1">Rendered as a centred line under invoice totals when set</p>
            </FormField>
          </div>
          <p className="mt-3 text-xs text-secondary-400">
            Saved with Business Settings below. Invoices render these automatically - no per-invoice action needed.
          </p>
        </div>

        {/* Invoice Settings */}
        <div id="settings-invoice" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <FileDown className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Invoice Settings</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Customize invoice numbering and currency</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Invoice Prefix"><Input value={form.invoice_prefix} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} placeholder="INV" /></FormField>
            <FormField label="Financial Year">
              <Select value={form.financial_year} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, financial_year: e.target.value })}>
                {fyList.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
              </Select>
            </FormField>
            <FormField label="Currency Symbol"><Input value={form.currency_symbol} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} placeholder={sym} /></FormField>
          </div>
        </div>

        {/* Data Export */}
        <div id="settings-export" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-secondary-100 dark:bg-secondary-800 p-2.5">
              <Database className="h-5 w-5 text-secondary-600 dark:text-secondary-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Data Export</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Download your data as CSV files</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" loading={exporting === 'customers'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={() => exportTable('customers', 'Customers', 'customers', 'name', CUSTOMER_COLUMNS)}>
              <Download className="h-4 w-4" /> Customers CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'suppliers'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={() => exportTable('suppliers', 'Suppliers', 'suppliers', 'name', SUPPLIER_COLUMNS)}>
              <Download className="h-4 w-4" /> Suppliers CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'products'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={() => exportTable('products', 'Products', 'products', 'name', PRODUCT_COLUMNS)}>
              <Download className="h-4 w-4" /> Products CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'sales-invoices'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={exportSalesInvoices}>
              <Download className="h-4 w-4" /> Sales Invoices CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'purchase-bills'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={exportPurchaseBills}>
              <Download className="h-4 w-4" /> Purchase Bills CSV
            </Button>
            <Button
              variant="secondary"
              loading={exporting === 'full-ledger'}
              disabled={!canExportData}
              title={capabilityTooltip('data.export', activeRole) || 'Full-ledger JSON backup (current fiscal year)'}
              onClick={exportFullLedger}
            >
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
        </div>

        {/* Bulk Import */}
        <div id="settings-import" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
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

        {/* Notifications & Communication */}
        <div id="settings-comms" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <BellRing className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Notifications &amp; Communication</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Providers, templates, test sends, preferences and scheduled report delivery</p>
            </div>
            <Link
              to="/app/communications"
              className="ml-auto inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              Delivery history <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <CommunicationCenterPanel />

          <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
            <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-1">Message templates</h4>
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-4">Edit the wording used by every send across the app</p>
            <MessageTemplatesPanel />
          </div>

          <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
            <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-1">Scheduled reports</h4>
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-4">Recurring report delivery by email on your cadence</p>
            <ScheduledReportsPanel />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={() => { if (validate()) saveMutation.mutate(); }}
            loading={saveMutation.isPending}
            size="lg"
            disabled={!canEditSettings}
            title={!canEditSettings ? settingsLockTooltip : undefined}
          >
            <Save className="h-4 w-4" /> Save All Settings
          </Button>
        </div>
      </div>
    </PageMotion>
  );
}
