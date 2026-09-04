import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, Save } from 'lucide-react';
import { buildSupplierInsert } from '@/lib/payloads';

const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Puducherry'];

const emptyForm = {
  name: '', company_name: '', phone: '', email: '', gstin: '', pan: '',
  address: '', city: '', state: 'Maharashtra', pincode: '', opening_balance: '0', notes: '',
};

export function SupplierCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.name.trim()) throw new Error('Please enter a supplier name');
      const { error } = await supabase.from('suppliers').insert(buildSupplierInsert(activeBusiness.id, form));
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', activeBusiness?.id] });
      toast('Supplier added successfully', 'success');
      navigate('/app/suppliers');
    },
    onError: (err: any) => toast(err.message || 'Failed to save supplier', 'error'),
  });

  return (
    <div>
      <PageHeader
        title="New Supplier"
        actions={<Button variant="secondary" onClick={() => navigate('/app/suppliers')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection title="Contact Details" description="Primary identity and reachability">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Supplier Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sharma Traders" />
            </FormField>
            <FormField label="Company Name">
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Sharma Traders Pvt Ltd" />
            </FormField>
            <FormField label="Phone">
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="sharma@example.com" />
            </FormField>
            <FormField label="GSTIN">
              <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" maxLength={15} />
            </FormField>
            <FormField label="PAN">
              <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Address">
          <div className="space-y-4">
            <FormField label="Address">
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Business Street" rows={2} />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField label="City">
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Mumbai" />
              </FormField>
              <FormField label="State">
                <select className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="Pincode">
                <Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} placeholder="400001" />
              </FormField>
            </div>
          </div>
        </FormSection>

        <FormSection title="Financials">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Opening Balance">
              <Input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
            </FormField>
          </div>
        </FormSection>

        <FormSection title="Notes">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Internal notes about this supplier..." />
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/suppliers')}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <Save className="h-4 w-4" /> Save Supplier
          </Button>
        </div>
      </div>
    </div>
  );
}
