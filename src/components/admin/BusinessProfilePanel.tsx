import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { FormSection } from '@/components/ui/FormSection';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select, Textarea } from '@/components/ui/Input';
import { capabilityTooltip } from '@/lib/rbac';
import { Building2, Save } from 'lucide-react';

const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Puducherry'];

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BusinessProfilePanel() {
  const { activeBusiness, activeRole, refreshBusinesses } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '', legal_name: '', phone: '', email: '', address: '', city: '', state: 'Maharashtra',
    gstin: '', pan: '', financial_year: '2026-27', currency_symbol: '₹', invoice_prefix: 'INV',
    gst_registered: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const canEditSettings = activeRole === 'owner' || activeRole === 'admin';

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
      });
    }
  }, [activeBusiness]);

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
      };
      if (form.gst_registered) {
        payload.gstin = form.gstin || null;
      }
      const { error } = await supabase.from('businesses').update(payload).eq('id', activeBusiness.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshBusinesses();
      toast('Business profile updated successfully', 'success');
    },
    onError: (err: Error) => toast(err.message || 'Failed to update profile', 'error'),
  });

  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
          <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Business Profile</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Identity, tax registration and document defaults</p>
        </div>
      </div>

      <FormSection title="Identity" description="Appears on invoices, reports and exports">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Business Name" required error={errors.name}>
            <Input value={form.name} disabled={!canEditSettings} onChange={(e) => { clearError('name'); setForm({ ...form, name: e.target.value }); }} />
          </FormField>
          <FormField label="Legal Name">
            <Input value={form.legal_name} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
          </FormField>
          <FormField label="Phone"><Input type="tel" value={form.phone} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
          <FormField label="Email" error={errors.email}>
            <Input type="email" value={form.email} disabled={!canEditSettings} onChange={(e) => { clearError('email'); setForm({ ...form, email: e.target.value }); }} />
          </FormField>
          <FormField label="City"><Input value={form.city} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, city: e.target.value })} /></FormField>
          <FormField label="State">
            <Select value={form.state} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, state: e.target.value })}>
              {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="mt-4">
          <FormField label="Address"><Textarea value={form.address} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} /></FormField>
        </div>
      </FormSection>

      <FormSection title="GST & Tax" description="Registration drives GST behaviour across documents" className="mt-6">
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
      </FormSection>

      <FormSection title="Invoice Defaults" description="Numbering prefix, fiscal year and currency symbol" className="mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Invoice Prefix"><Input value={form.invoice_prefix} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} placeholder="INV" /></FormField>
          <FormField label="Financial Year">
            <Select value={form.financial_year} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, financial_year: e.target.value })}>
              {Array.from({ length: 5 }, (_, i) => {
                const y = new Date().getFullYear() + 1 - i;
                return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
              }).map((fy) => <option key={fy} value={fy}>{fy}</option>)}
            </Select>
          </FormField>
          <FormField label="Currency Symbol"><Input value={form.currency_symbol} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} placeholder="₹" /></FormField>
        </div>
      </FormSection>

      <div className="flex justify-end mt-6 pt-5 border-t border-secondary-200/80 dark:border-secondary-800">
        <Button
          onClick={() => { if (validate()) saveMutation.mutate(); }}
          loading={saveMutation.isPending}
          disabled={!canEditSettings}
          title={!canEditSettings ? capabilityTooltip('settings.edit', activeRole) || undefined : undefined}
        >
          <Save className="h-4 w-4" /> Save Profile
        </Button>
      </div>
    </section>
  );
}
