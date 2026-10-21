import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { GSTIN_REGEX, PAN_REGEX } from '@/lib/validation';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select, Textarea } from '@/components/ui/Input';
import { Settings, Building2, Save, ShieldCheck, Upload, X, BellRing, FileText, Landmark, Sun, Moon, ArrowRight, Hash } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CommunicationCenterPanel } from '@/components/settings/CommunicationCenterPanel';
import { MessageTemplatesPanel } from '@/components/settings/MessageTemplatesPanel';
import { ScheduledReportsPanel } from '@/components/settings/ScheduledReportsPanel';
import { can, capabilityTooltip, roleLabel } from '@/lib/rbac';
import { PageMotion } from '@/lib/motion';
import {
  clearBusinessExtras,
  DRIFTED_EXTRAS_KEYS,
  flushBusinessColumnStash,
  isMissingColumnError,
  stashBusinessColumns,
  stashBusinessExtras,
  type BusinessExtras,
} from '@/lib/businessExtras';
import {
  discoverBusinessColumns,
  parseMissingColumnNames,
  planBusinessSave,
  trimPayloadValues,
} from '@/lib/businessSchema';
import {
  readDocPrefixes,
  stashDocPrefixes,
  normalizePrefix,
  DEFAULT_PREFIXES,
  DOC_PREFIX_KEYS,
  NEW_PREFIX_KEYS,
  type DocPrefixKey,
} from '@/lib/docPrefixes';
import { saveTncCache, readTncCache, STANDARD_TNC_DEFAULTS, type TncDocType } from '@/lib/tncDefaults';

const tncMirrorFromPayload = (payload: Record<string, unknown>): Record<TncDocType, string | null> => ({
  sales_invoice: (payload.tnc_invoice as string | null) || null,
  quotation: (payload.tnc_quotation as string | null) || null,
  sales_order: (payload.tnc_sales_order as string | null) || null,
  purchase: (payload.tnc_purchase as string | null) || null,
});

const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Puducherry'];

const UPI_ID_REGEX = /^[A-Za-z0-9.@-]{2,60}$/;
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
          <span className="text-[11px] text-secondary-500 px-4 text-center leading-tight">No image uploaded</span>
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
          accept="image/*"
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

function SectionHeader({ icon, tone, title, subtitle }: { icon: ReactNode; tone: 'primary' | 'accent' | 'success' | 'secondary'; title: string; subtitle: string }) {
  const tones = {
    primary: 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400',
    accent: 'bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400',
    success: 'bg-success-100 dark:bg-success-900/30 text-success-600 dark:text-success-400',
    secondary: 'bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300',
  };
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`rounded-lg p-2.5 ${tones[tone]}`}>{icon}</div>
      <div>
        <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">{title}</h3>
        <p className="text-xs text-secondary-500 dark:text-secondary-400">{subtitle}</p>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { activeBusiness, activeRole, refreshBusinesses } = useAuth();
  const { theme, setThemePreference } = useTheme();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '', legal_name: '', phone: '', email: '', address: '', city: '', state: 'Maharashtra',
    pincode: '',
    gstin: '', pan: '', financial_year: '2026-27', currency_symbol: '₹', invoice_prefix: 'INV',
    quotation_prefix: 'QT', sales_order_prefix: 'SO', purchase_order_prefix: 'PO',
    purchase_bill_prefix: 'PB', credit_note_prefix: 'CN', debit_note_prefix: 'DN',
    gst_registered: false,
    stamp_url: '' as string | null,
    logo_url: '' as string | null,
    signature_url: '' as string | null,
    upi_id: '',
    upi_qr_url: '' as string | null,
    invoice_footer_text: '',
    invoice_signature_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc_code: '',
    account_name: '',
    tnc_invoice: '',
    tnc_quotation: '',
    tnc_sales_order: '',
    tnc_purchase: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // PBS-121: strict exclusive tab rendering (human spec) — one card in the DOM
  // at a time; the tab pin is a render switch, not an anchor scroll. Form state
  // lives at page level, so switching never remounts or resets unsaved edits.
  type SettingsTab = 'profile' | 'bank' | 'tnc' | 'numbering' | 'taxes' | 'preferences';
  const TAB_TO_HASH: Record<SettingsTab, string> = {
    profile: 'settings-profile',
    bank: 'settings-bank',
    tnc: 'settings-docs',
    numbering: 'settings-numbering',
    taxes: 'settings-tax',
    preferences: 'settings-prefs',
  };
  const HASH_TO_TAB: Record<string, SettingsTab> = {
    'settings-profile': 'profile',
    'settings-bank': 'bank',
    'settings-docs': 'tnc',
    'settings-numbering': 'numbering',
    'settings-tax': 'taxes',
    'settings-prefs': 'preferences',
  };
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    try {
      const h = window.location.hash.replace('#', '');
      return HASH_TO_TAB[h] || 'profile';
    } catch {
      return 'profile';
    }
  });
  const switchTab = (id: SettingsTab) => {
    setActiveTab(id);
    try {
      window.history.replaceState(null, '', `#${TAB_TO_HASH[id]}`);
    } catch {
      /* hash update is best-effort */
    }
  };

  const canEditSettings = can(activeRole, 'settings.edit');
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
        pincode: activeBusiness.pincode || '',
        gstin: activeBusiness.gstin || '',
        pan: activeBusiness.pan || '',
        financial_year: activeBusiness.financial_year || '2026-27',
        currency_symbol: activeBusiness.currency_symbol || '₹',
        ...readDocPrefixes(activeBusiness),
        gst_registered: activeBusiness.gst_registered,
        stamp_url: activeBusiness.stamp_url || '',
        logo_url: activeBusiness.logo_url || '',
        signature_url: activeBusiness.signature_url || '',
        upi_id: activeBusiness.upi_id || '',
        upi_qr_url: activeBusiness.upi_qr_url || '',
        invoice_footer_text: activeBusiness.invoice_footer_text || '',
        invoice_signature_name: activeBusiness.invoice_signature_name || '',
        bank_name: activeBusiness.bank_name || '',
        bank_account_number: activeBusiness.bank_account_number || '',
        bank_ifsc_code: activeBusiness.bank_ifsc_code || '',
        account_name: activeBusiness.account_name || '',
        tnc_invoice: activeBusiness.tnc_invoice || readTncCache(activeBusiness.id, 'sales_invoice') || '',
        tnc_quotation: activeBusiness.tnc_quotation || readTncCache(activeBusiness.id, 'quotation') || '',
        tnc_sales_order: activeBusiness.tnc_sales_order || readTncCache(activeBusiness.id, 'sales_order') || '',
        tnc_purchase: activeBusiness.tnc_purchase || readTncCache(activeBusiness.id, 'purchase') || '',
      });
    }
  }, [activeBusiness]);

  /* ------------------------------ image reader ------------------------------- */

  const readImageFile = (file: File, field: 'stamp_url' | 'logo_url' | 'signature_url' | 'upi_qr_url') => {
    if (!file.type.startsWith('image/')) {
      toast('Please upload an image file (PNG, JPG, or SVG)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (file.type === 'image/svg+xml' || file.size < 600 * 1024) {
        setForm((prev) => ({ ...prev, [field]: result }));
        toast('Image selected successfully! Click "Save All Settings" below.', 'info');
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = Math.min(img.width, MAX_WIDTH);
        canvas.height = img.width > MAX_WIDTH ? img.height * scaleSize : img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png', 0.9);
        setForm((prev) => ({ ...prev, [field]: dataUrl }));
        toast('Image selected and optimized! Click "Save All Settings" below.', 'info');
      };
      img.src = result;
    };
    reader.onerror = () => toast('Could not read the selected image', 'error');
    reader.readAsDataURL(file);
  };

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

  /** Live sample numbers for the Numbering Prefixes tab, e.g. QT/26-27/1. */
  const prefixPreview = useMemo(() => {
    const m = /^(\d{4})-(\d{2})$/.exec(form.financial_year || '');
    const fy = m ? `${m[1].slice(2)}-${m[2]}` : form.financial_year || 'FY';
    return DOC_PREFIX_KEYS.map((key) => {
      const prefix = normalizePrefix(form[key]) || DEFAULT_PREFIXES[key];
      return `${prefix}/${fy}/1`;
    });
  }, [form]);

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
    if (form.pincode.trim() && !/^[0-9]{6}$/.test(form.pincode.trim())) e.pincode = 'Invalid PIN — expected 6 digits';
    if (form.upi_id.trim() && !UPI_ID_REGEX.test(form.upi_id.trim())) e.upi_id = 'Invalid UPI ID — use only letters, numbers, dots, @ and dashes (e.g. business@upi)';
    if (form.bank_ifsc_code.trim() && !IFSC_REGEX.test(form.bank_ifsc_code.trim())) e.bank_ifsc_code = 'Invalid IFSC - format SBIN0001234';
    if (form.bank_account_number.trim() && !/^[0-9][0-9 -]{4,18}[0-9]$/.test(form.bank_account_number.trim())) e.bank_account_number = 'Account number must be 6-20 digits (spaces/dashes allowed)';
    for (const key of DOC_PREFIX_KEYS) {
      if (!normalizePrefix(form[key])) e[key] = 'Prefix is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<{ stashed: string[] }> => {
      if (!activeBusiness) throw new Error('No active business');
      const payload: Record<string, unknown> = {
        name: form.name,
        legal_name: form.legal_name || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state,
        pincode: form.pincode.trim() || null,
        pan: form.pan || null,
        financial_year: form.financial_year,
        currency_symbol: form.currency_symbol,
        invoice_prefix: form.invoice_prefix,
        quotation_prefix: normalizePrefix(form.quotation_prefix),
        sales_order_prefix: normalizePrefix(form.sales_order_prefix),
        purchase_order_prefix: normalizePrefix(form.purchase_order_prefix),
        purchase_bill_prefix: normalizePrefix(form.purchase_bill_prefix),
        credit_note_prefix: normalizePrefix(form.credit_note_prefix),
        debit_note_prefix: normalizePrefix(form.debit_note_prefix),
        gst_registered: form.gst_registered,
        stamp_url: form.stamp_url || null,
        logo_url: form.logo_url || null,
        signature_url: form.signature_url || null,
        upi_id: form.upi_id || null,
        upi_qr_url: form.upi_qr_url || null,
        invoice_footer_text: form.invoice_footer_text.trim() || null,
        invoice_signature_name: form.invoice_signature_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_account_number: form.bank_account_number || null,
        bank_ifsc_code: form.bank_ifsc_code.toUpperCase() || null,
        account_name: form.account_name.trim() || null,
        tnc_invoice: form.tnc_invoice.trim() || null,
        tnc_quotation: form.tnc_quotation.trim() || null,
        tnc_sales_order: form.tnc_sales_order.trim() || null,
        tnc_purchase: form.tnc_purchase.trim() || null,
      };
      if (form.gst_registered) {
        payload.gstin = form.gstin || null;
      }
      // Trim every string once; addresses keep their '#', '-', '/', ',' characters.
      const trimmed = trimPayloadValues(payload);

      // Mirror on save: localStorage fallback while the businesses T&C columns migration is pending.
      saveTncCache(activeBusiness.id, tncMirrorFromPayload(trimmed));

      // PBS-149: discover the columns public.businesses actually has (cached
      // select-probe) so the save sends ONE PATCH with only existing columns —
      // no 400 from unmigrated columns, no console error.
      const existingColumns = await discoverBusinessColumns();

      // Values stashed while a column was missing are flushed back now that the
      // column exists (post-migration).
      const flushable = flushBusinessColumnStash(activeBusiness.id, existingColumns);

      const { send, missing, missingValues, stashed, prefixStash, extrasStash } = planBusinessSave(
        { ...flushable, ...trimmed },
        existingColumns,
        { prefixKeys: DOC_PREFIX_KEYS, extrasKeys: DRIFTED_EXTRAS_KEYS, normalizePrefix },
      );

      // Columns the DB does not have (yet) are stashed locally, never sent.
      if (missing.length) {
        stashBusinessColumns(activeBusiness.id, missingValues);
        if (Object.keys(prefixStash).length) {
          stashDocPrefixes(activeBusiness.id, prefixStash as Record<DocPrefixKey, string>);
        }
        if (Object.keys(extrasStash).length) {
          stashBusinessExtras(activeBusiness.id, extrasStash as BusinessExtras);
        }
      }

      const tryUpdate = async (p: Record<string, unknown>) => {
        const { error } = await supabase.from('businesses').update(p).eq('id', activeBusiness.id);
        return error;
      };

      const firstError = await tryUpdate(send);
      if (!firstError) {
        // The values are persisted server-side now: drop the legacy local copies
        // so the render overlay can never show a stale value for a cleared field.
        clearBusinessExtras(
          activeBusiness.id,
          DRIFTED_EXTRAS_KEYS.filter((k) => k in send),
        );
        return { stashed };
      }

      if (!isMissingColumnError(firstError)) throw firstError;

      // Safety net only: the schema changed between the probe and the PATCH.
      // Drop the columns the server names, stash them and retry once — the
      // normal path above never reaches this branch (single 200/204 PATCH).
      const errMsg = typeof (firstError as { message?: unknown })?.message === 'string'
        ? String((firstError as { message?: unknown }).message)
        : '';
      const named = parseMissingColumnNames(errMsg);
      if (!named.length) {
        // The server did not name a column: do NOT guess and do NOT retry with
        // a stripped payload (that could wipe the profile). Surface it.
        throw firstError;
      }
      const retry: Record<string, unknown> = { ...send };
      const lateStash: Record<string, unknown> = {};
      for (const k of named) {
        if (!(k in retry)) continue;
        const v = retry[k];
        delete retry[k];
        if (v !== null && v !== undefined && v !== '') lateStash[k] = v;
      }
      if (Object.keys(lateStash).length) {
        stashBusinessColumns(activeBusiness.id, lateStash);
        for (const k of Object.keys(lateStash)) stashed.push(k);
      }
      const secondError = await tryUpdate(retry);
      if (secondError) throw secondError;
      clearBusinessExtras(
        activeBusiness.id,
        DRIFTED_EXTRAS_KEYS.filter((k) => k in retry),
      );
      return { stashed };
    },
    onSuccess: async ({ stashed }) => {
      await refreshBusinesses();
      toast(
        stashed.length
          ? `Settings saved — ${stashed.length} field${stashed.length > 1 ? 's' : ''} kept locally until the DB migration is applied`
          : 'Business settings updated successfully',
        stashed.length ? 'info' : 'success'
      );
    },
    onError: (err: any) => toast(err.message || 'Failed to update settings', 'error'),
  });

  if (!activeBusiness) return null;

  return (
    <PageMotion>
      <PageHeader title="Settings" subtitle="Business & operational configuration" />

      <nav aria-label="Settings sections" className="sticky top-[64px] z-20 -mx-1 mb-4 flex gap-2 overflow-x-auto py-2 px-1 backdrop-blur-sm">
        {[
          { id: 'profile', card: 'settings-profile', label: '1. Business Profile' },
          { id: 'bank', card: 'settings-bank', label: '2. Bank & UPI' },
          { id: 'tnc', card: 'settings-docs', label: '3. Terms & Conditions' },
          { id: 'numbering', card: 'settings-numbering', label: '4. Numbering Prefixes' },
          { id: 'taxes', card: 'settings-tax', label: '5. Taxes & Currency' },
          { id: 'preferences', card: 'settings-prefs', label: '6. Preferences' },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => switchTab(s.id as SettingsTab)}
            aria-current={activeTab === s.id}
            className={activeTab === s.id
              ? 'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium bg-primary-600 text-white shadow-sm transition-colors'
              : 'shrink-0 rounded-full border border-secondary-200 dark:border-secondary-700 bg-white/80 dark:bg-zinc-900/80 px-3.5 py-1.5 text-xs font-medium text-secondary-600 dark:text-secondary-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors'}
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
        {/* 1. Business Profile */}
        {activeTab === 'profile' && (
        <div id="settings-profile" className="card p-6 scroll-mt-28">
          <SectionHeader icon={<Building2 className="h-5 w-5" />} tone="primary" title="Business Profile" subtitle="Identity, tax registration and print branding" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Business Name" required error={errors.name}>
              <Input value={form.name} disabled={!canEditSettings} title={!canEditSettings ? settingsLockTooltip : undefined} onChange={(e) => { clearError('name'); setForm({ ...form, name: e.target.value }); }} />
            </FormField>
            <FormField label="Legal Name"><Input value={form.legal_name} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></FormField>
            <FormField label="GSTIN" error={errors.gstin}>
              <Input
                value={form.gstin}
                onChange={(e) => { clearError('gstin'); setForm({ ...form, gstin: e.target.value.toUpperCase() }); }}
                onBlur={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase().trim() })}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
                disabled={!form.gst_registered || !canEditSettings}
              />
              {!form.gst_registered && <p className="text-xs text-secondary-400 mt-1">Enable GST registration in Taxes &amp; Currency to edit</p>}
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
            <FormField label="Phone"><Input type="tel" value={form.phone} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
            <FormField label="Email" error={errors.email}>
              <Input type="email" value={form.email} disabled={!canEditSettings} onChange={(e) => { clearError('email'); setForm({ ...form, email: e.target.value }); }} />
            </FormField>
          </div>
          <div className="mt-4">
            <FormField label="Registered Address"><Textarea value={form.address} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} /></FormField>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <FormField label="City"><Input value={form.city} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, city: e.target.value })} /></FormField>
              <FormField label="State">
                <Select value={form.state} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </FormField>
              <FormField label="PIN Code" error={errors.pincode}>
                <Input
                  value={form.pincode}
                  disabled={!canEditSettings}
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="400001"
                  onChange={(e) => { clearError('pincode'); setForm({ ...form, pincode: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) }); }}
                />
              </FormField>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <StampSignatureSlot
              title="Company / Firm Logo"
              hint="Rendered top-left on quotation and sales invoice header (PNG, JPG or SVG)"
              value={form.logo_url}
              disabled={!canEditSettings}
              onPick={(f) => readImageFile(f, 'logo_url')}
              onRemove={() => setForm((prev) => ({ ...prev, logo_url: '' }))}
            />
            <StampSignatureSlot
              title="Company / Firm Stamp & Sign"
              hint="Transparent PNG recommended - sits above the sign line (PNG, JPG or SVG)"
              value={form.signature_url}
              disabled={!canEditSettings}
              onPick={(f) => readImageFile(f, 'signature_url')}
              onRemove={() => setForm((prev) => ({ ...prev, signature_url: '' }))}
            />
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
            <FormField label="Financial Year">
              <Select value={form.financial_year} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, financial_year: e.target.value })}>
                {fyList.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
              </Select>
            </FormField>
            <FormField label="Invoice Footer Text">
              <Textarea
                value={form.invoice_footer_text}
                disabled={!canEditSettings}
                rows={2}
                placeholder="e.g. Goods once sold will not be taken back. Subject to Barabanki jurisdiction."
                onChange={(e) => setForm((prev) => ({ ...prev, invoice_footer_text: e.target.value }))}
              />
              <p className="text-xs text-secondary-400 mt-1">Rendered as a centred line under invoice totals when set</p>
            </FormField>
          </div>
        </div>
        )}


        {/* 2. Bank & UPI */}
        {activeTab === 'bank' && (
        <div id="settings-bank" className="card p-6 scroll-mt-28">
          <SectionHeader icon={<Landmark className="h-5 w-5" />} tone="secondary" title="Bank &amp; UPI" subtitle="Payment details printed on invoices and quotations" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid grid-cols-1 gap-4">
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
              <FormField label="Account Holder Name">
                <Input
                  value={form.account_name}
                  disabled={!canEditSettings}
                  maxLength={80}
                  placeholder="Rajesh Kumar"
                  onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                />
                <p className="text-xs text-secondary-400 mt-1">Printed as A/c Name on invoices</p>
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
              <StampSignatureSlot
                title="UPI QR Code"
                hint="Uploaded QR shown on invoices (PNG, JPG or SVG)"
                value={form.upi_qr_url}
                disabled={!canEditSettings}
                onPick={(f) => readImageFile(f, 'upi_qr_url')}
                onRemove={() => setForm((prev) => ({ ...prev, upi_qr_url: '' }))}
              />
            </div>
          </div>
        </div>
        )}


        {/* 3. Terms & Conditions */}
        {activeTab === 'tnc' && (
        <div id="settings-docs" className="card p-6 scroll-mt-28">
          <SectionHeader icon={<FileText className="h-5 w-5" />} tone="accent" title="Terms &amp; Conditions" subtitle="Defaults printed when a record has no stored terms" />
          <div className="flex flex-col gap-6 mt-1">
              <FormField label="Invoices">
                <Textarea rows={4} className="w-full min-h-[110px] border border-secondary-200 dark:border-secondary-700 rounded-lg p-3 text-xs md:text-sm" value={form.tnc_invoice} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, tnc_invoice: e.target.value })} placeholder={STANDARD_TNC_DEFAULTS.sales_invoice} />
              </FormField>
              <FormField label="Quotations">
                <Textarea rows={4} className="w-full min-h-[110px] border border-secondary-200 dark:border-secondary-700 rounded-lg p-3 text-xs md:text-sm" value={form.tnc_quotation} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, tnc_quotation: e.target.value })} placeholder={STANDARD_TNC_DEFAULTS.quotation} />
              </FormField>
              <FormField label="Sales Orders">
                <Textarea rows={4} className="w-full min-h-[110px] border border-secondary-200 dark:border-secondary-700 rounded-lg p-3 text-xs md:text-sm" value={form.tnc_sales_order} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, tnc_sales_order: e.target.value })} placeholder={STANDARD_TNC_DEFAULTS.sales_order} />
              </FormField>
              <FormField label="Purchase Documents">
                <Textarea rows={4} className="w-full min-h-[110px] border border-secondary-200 dark:border-secondary-700 rounded-lg p-3 text-xs md:text-sm" value={form.tnc_purchase} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, tnc_purchase: e.target.value })} placeholder={STANDARD_TNC_DEFAULTS.purchase} />
              </FormField>
            </div>
            <p className="mt-3 text-[11px] text-secondary-500 dark:text-secondary-400">Leave empty to use standard defaults. Saved with business settings; while the database migration is pending these are stored on this device only.</p>
        </div>
        )}


        {/* 4. Numbering Prefixes */}
        {activeTab === 'numbering' && (
        <div id="settings-numbering" className="card p-6 scroll-mt-28">
          <SectionHeader icon={<Hash className="h-5 w-5" />} tone="primary" title="Document Numbering Prefixes" subtitle="Prefixes used in every document number (e.g., QT/26-27/2). Letters, numbers, dash, underscore and dot only, max 12 characters" />
          <div className="max-w-[260px]">
            <FormField label="Financial Year">
              <Select value={form.financial_year} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, financial_year: e.target.value })}>
                {fyList.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <FormField label="Tax Invoice Prefix" error={errors.invoice_prefix}>
              <Input
                value={form.invoice_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="INV"
                onChange={(e) => { clearError('invoice_prefix'); setForm({ ...form, invoice_prefix: e.target.value }); }}
              />
            </FormField>
            <FormField label="Quotation / Estimate Prefix" error={errors.quotation_prefix}>
              <Input
                value={form.quotation_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="QT"
                onChange={(e) => { clearError('quotation_prefix'); setForm({ ...form, quotation_prefix: e.target.value }); }}
              />
            </FormField>
            <FormField label="Sales Order Prefix" error={errors.sales_order_prefix}>
              <Input
                value={form.sales_order_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="SO"
                onChange={(e) => { clearError('sales_order_prefix'); setForm({ ...form, sales_order_prefix: e.target.value }); }}
              />
            </FormField>
            <FormField label="Purchase Order Prefix" error={errors.purchase_order_prefix}>
              <Input
                value={form.purchase_order_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="PO"
                onChange={(e) => { clearError('purchase_order_prefix'); setForm({ ...form, purchase_order_prefix: e.target.value }); }}
              />
            </FormField>
            <FormField label="Purchase Bill Prefix" error={errors.purchase_bill_prefix}>
              <Input
                value={form.purchase_bill_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="PB"
                onChange={(e) => { clearError('purchase_bill_prefix'); setForm({ ...form, purchase_bill_prefix: e.target.value }); }}
              />
            </FormField>
            <FormField label="Credit Note Prefix" error={errors.credit_note_prefix}>
              <Input
                value={form.credit_note_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="CN"
                onChange={(e) => { clearError('credit_note_prefix'); setForm({ ...form, credit_note_prefix: e.target.value }); }}
              />
            </FormField>
            <FormField label="Debit Note Prefix" error={errors.debit_note_prefix}>
              <Input
                value={form.debit_note_prefix}
                disabled={!canEditSettings}
                maxLength={12}
                placeholder="DN"
                onChange={(e) => { clearError('debit_note_prefix'); setForm({ ...form, debit_note_prefix: e.target.value }); }}
              />
            </FormField>
          </div>
          <div className="mt-5 rounded-lg border border-secondary-200 dark:border-secondary-700 bg-secondary-50/60 dark:bg-secondary-800/40 p-4">
            <p className="text-xs font-medium text-secondary-700 dark:text-secondary-300 mb-2">Preview</p>
            <div className="flex flex-wrap gap-2">
              {prefixPreview.map((sample) => (
                <span
                  key={sample}
                  className="rounded-md border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900/60 px-2 py-1 font-mono text-xs text-secondary-700 dark:text-secondary-300"
                >
                  {sample}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-secondary-500 dark:text-secondary-400">
              Sequence numbers continue from the highest number already used for that document type.
            </p>
          </div>
        </div>
        )}


        {/* 5. Taxes & Currency */}
        {activeTab === 'taxes' && (
        <div id="settings-tax" className="card p-6 scroll-mt-28">
          <SectionHeader icon={<Settings className="h-5 w-5" />} tone="success" title="Taxes &amp; Currency" subtitle="GST behaviour and currency display" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Currency Symbol">
              <Input value={form.currency_symbol} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} placeholder="₹" />
              <p className="text-xs text-secondary-400 mt-1">Used across documents and totals</p>
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
            <p className="mt-2 text-xs text-secondary-400">Disable GST registration to clear the GSTIN in Business Profile.</p>
          )}
          <p className="mt-3 text-xs text-secondary-400">Tax rates are configured per product; documents compute line tax and round-off automatically.</p>
        </div>
        )}


        {/* 5. Preferences */}
        {activeTab === 'preferences' && (
        <div id="settings-prefs" className="card p-6 scroll-mt-28">
          <SectionHeader icon={<BellRing className="h-5 w-5" />} tone="accent" title="Preferences" subtitle="Appearance and notifications" />
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-secondary-600 dark:text-secondary-400 mr-1">Default appearance:</p>
            <button
              type="button"
              onClick={() => setThemePreference('light')}
              aria-pressed={theme === 'light'}
              className={theme === 'light'
                ? 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white'
                : 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-700 transition-colors'}
            >
              <Sun className="h-3.5 w-3.5" /> Light
            </button>
            <button
              type="button"
              onClick={() => setThemePreference('dark')}
              aria-pressed={theme === 'dark'}
              className={theme === 'dark'
                ? 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-primary-600 text-white'
                : 'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-700 transition-colors'}
            >
              <Moon className="h-3.5 w-3.5" /> Dark
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
            <div className="flex items-center gap-3 mb-4">
              <div>
                <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Notifications &amp; Communication</h4>
                <p className="text-xs text-secondary-500 dark:text-secondary-400">Email toggles, providers, templates, test sends and scheduled report delivery</p>
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
        </div>
        )}


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
