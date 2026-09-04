import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input, Select, FormField, Textarea } from '@/components/ui/Input';
import { useToast } from '@/context/ToastContext';
import { Calculator, Building2, Check, ChevronRight, ArrowLeft } from 'lucide-react';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Chandigarh', 'Puducherry',
];

export function BusinessSetupPage() {
  const navigate = useNavigate();
  const { refreshBusinesses, setActiveBusiness, businesses } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    legal_name: '',
    business_type: 'trading',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'Maharashtra',
    gstin: '',
    pan: '',
    financial_year: '2026-27',
    currency: 'INR',
    currency_symbol: '₹',
    invoice_prefix: 'INV',
    gst_registered: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast('Business name is required', 'error');
      return;
    }
    setLoading(true);
    try {
      const { data: businessId, error: rpcError } = await supabase.rpc('create_business_with_owner', {
        p_name: form.name,
        p_legal_name: form.legal_name || form.name,
        p_business_type: form.business_type,
        p_phone: form.phone || null,
        p_email: form.email || null,
        p_address: form.address || null,
        p_city: form.city || null,
        p_state: form.state,
        p_gstin: form.gstin || null,
        p_pan: form.pan || null,
        p_financial_year: form.financial_year,
        p_currency: form.currency,
        p_currency_symbol: form.currency_symbol,
        p_invoice_prefix: form.invoice_prefix,
        p_gst_registered: form.gst_registered,
      });

      if (rpcError) throw rpcError;

      await refreshBusinesses();

      const { data: newBusiness } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .maybeSingle();

      if (newBusiness) setActiveBusiness(newBusiness as any);

      toast(`${form.name} is ready! Welcome to AccountX.`, 'success');
      navigate('/app');
    } catch (err: any) {
      toast(err.message || 'Failed to create business. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-950 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          {businesses.length > 0 && (
            <button
              onClick={() => navigate('/app')}
              className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-secondary-600 dark:text-secondary-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Dashboard
            </button>
          )}
          <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="rounded-xl bg-primary-600 p-2.5">
            <Calculator className="h-7 w-7 text-white" />
          </div>
          <span className="text-2xl font-bold text-secondary-900 dark:text-white">AccountX</span>
        </div>

        <div className="card p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <Building2 className="h-6 w-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-secondary-900 dark:text-secondary-100">Set Up Your Business</h1>
              <p className="text-sm text-secondary-500 dark:text-secondary-400">Tell us about your business to get started</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Business Name" required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ABC Traders"
                  required
                />
              </FormField>

              <FormField label="Legal Name (Optional)">
                <Input
                  value={form.legal_name}
                  onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
                  placeholder="ABC Traders Pvt Ltd"
                />
              </FormField>

              <FormField label="Business Type">
                <Select
                  value={form.business_type}
                  onChange={(e) => setForm({ ...form, business_type: e.target.value })}
                >
                  <option value="trading">Trading</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="services">Services</option>
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                </Select>
              </FormField>

              <FormField label="Phone">
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </FormField>

              <FormField label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="business@example.com"
                />
              </FormField>

              <FormField label="State">
                <Select
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                >
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </FormField>

              <FormField label="City">
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="Mumbai"
                />
              </FormField>

              <FormField label="Invoice Prefix">
                <Input
                  value={form.invoice_prefix}
                  onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })}
                  placeholder="INV"
                />
              </FormField>

              <FormField label="GSTIN">
                <Input
                  value={form.gstin}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                  placeholder="27ABCDE1234F1Z5"
                  maxLength={15}
                />
              </FormField>

              <FormField label="PAN">
                <Input
                  value={form.pan}
                  onChange={(e) => setForm({ ...form, pan: e.target.value })}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                />
              </FormField>
            </div>

            <FormField label="Address">
              <Textarea
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="123 Business Street, Industrial Area"
                rows={2}
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Financial Year">
                <Select
                  value={form.financial_year}
                  onChange={(e) => setForm({ ...form, financial_year: e.target.value })}
                >
                  <option value="2026-27">2026-27</option>
                  <option value="2025-26">2025-26</option>
                </Select>
              </FormField>

              <FormField label="Currency Symbol">
                <Input
                  value={form.currency_symbol}
                  onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })}
                  placeholder="₹"
                />
              </FormField>
            </div>

            <label className="flex items-center gap-3 p-4 rounded-lg border border-secondary-200 dark:border-secondary-700 cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors">
              <input
                type="checkbox"
                checked={form.gst_registered}
                onChange={(e) => setForm({ ...form, gst_registered: e.target.checked })}
                className="h-4 w-4 rounded accent-primary-600"
              />
              <div>
                <span className="text-sm font-medium text-secondary-900 dark:text-secondary-100">GST Registered Business</span>
                <p className="text-xs text-secondary-500 dark:text-secondary-400">Enable GST calculations on invoices and purchases</p>
              </div>
            </label>

            {businesses.length > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => navigate('/app')}
              >
                <ArrowLeft className="h-4 w-4" /> Cancel & Back to Dashboard
              </Button>
            )}

            <Button type="submit" loading={loading} size="lg" className="w-full">
              <Check className="h-4 w-4" /> Create Business & Get Started
              <ChevronRight className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
