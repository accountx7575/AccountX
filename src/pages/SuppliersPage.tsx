import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { usePagedList, likePattern } from '@/hooks/usePagedList';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { Truck, Plus, Pencil, Trash2, Mail } from 'lucide-react';
import { formatCurrency, formatDate, getInitials } from '@/lib/utils';
import { buildSupplierUpdate } from '@/lib/payloads';
import { SendDialog } from '@/components/comms/SendDialog';
import type { Supplier } from '@/types/db';

const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Puducherry'];

const emptyForm = {
  name: '', company_name: '', phone: '', email: '', gstin: '', pan: '',
  address: '', city: '', state: 'Maharashtra', pincode: '', opening_balance: '0', notes: '',
};

export function SuppliersPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const list = usePagedList();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statementFor, setStatementFor] = useState<Supplier | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['suppliers', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as Supplier[], total: 0 };
      let q = supabase
        .from('suppliers')
        .select('*', { count: 'exact' })
        .eq('business_id', activeBusiness.id);
      if (list.debouncedSearch) {
        const p = likePattern(list.debouncedSearch);
        q = q.or(`name.ilike."${p}",phone.ilike."${p}",email.ilike."${p}",gstin.ilike."${p}"`);
      }
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(list.from, list.to);
      if (error) throw error;
      return { rows: (data || []) as Supplier[], total: count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const suppliers = data?.rows ?? [];
  const totalSuppliers = data?.total ?? 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!editing) throw new Error('No supplier selected');
      const payload = buildSupplierUpdate(form);
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', activeBusiness?.id] });
      toast('Supplier updated successfully', 'success');
      setDrawerOpen(false);
    },
    onError: (err: any) => toast(err.message || 'Failed to save supplier', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('suppliers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers', activeBusiness?.id] });
      toast('Supplier deleted', 'success');
      setDeleteId(null);
    },
    onError: (err: any) => toast(err.message || 'Failed to delete supplier', 'error'),
  });

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name, company_name: s.company_name || '', phone: s.phone || '', email: s.email || '',
      gstin: s.gstin || '', pan: s.pan || '', address: s.address || '', city: s.city || '',
      state: s.state || 'Maharashtra', pincode: s.pincode || '',
      opening_balance: String(s.opening_balance), notes: s.notes || '',
    });
    setDrawerOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${totalSuppliers} supplier${totalSuppliers !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/suppliers/new')}><Plus className="h-4 w-4" /> Add Supplier</Button>}
      />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by name, phone, GSTIN..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />

        {isError ? (
          <ErrorState title="Unable to load suppliers." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
          </div>
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No suppliers yet"
            description="Add your first supplier to start recording purchases"
            action={<Button onClick={() => navigate('/app/suppliers/new')}><Plus className="h-4 w-4" /> Add Supplier</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">GSTIN</th>
                  <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Total Purchases</th>
                  <th className="text-center px-4 py-3 font-medium hidden xl:table-cell">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 flex items-center justify-center text-xs font-semibold shrink-0">
                          {getInitials(s.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-secondary-900 dark:text-secondary-100 truncate">{s.name}</p>
                          {s.company_name && <p className="text-xs text-secondary-400 truncate">{s.company_name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-secondary-600 dark:text-secondary-300">{s.phone || '—'}</p>
                      <p className="text-xs text-secondary-400">{s.email || ''}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-secondary-600 dark:text-secondary-300 font-mono text-xs">{s.gstin || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={Number(s.current_balance) > 0 ? 'text-error-600 dark:text-error-400 font-medium' : 'text-secondary-500'}>
                        {formatCurrency(s.current_balance, activeBusiness?.currency_symbol)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300 hidden sm:table-cell">
                      {formatCurrency(s.total_purchases, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-center hidden xl:table-cell">
                      <Badge variant={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(s)} className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setStatementFor(s)} title="Send account statement" className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(s.id)} className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ListPagination
          page={list.page}
          onPageChange={list.setPage}
          pageSize={list.pageSize}
          from={list.from}
          total={totalSuppliers}
          isLoading={isLoading}
        />
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Edit Supplier"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDrawerOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} className="flex-1">
              Update Supplier
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Supplier Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="XYZ Distributors" />
            </FormField>
            <FormField label="Company Name">
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="XYZ Distributors Pvt Ltd" />
            </FormField>
            <FormField label="Phone">
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="xyz@example.com" />
            </FormField>
            <FormField label="GSTIN">
              <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" maxLength={15} />
            </FormField>
            <FormField label="PAN">
              <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} />
            </FormField>
          </div>
          <FormField label="Address">
            <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="123 Industrial Area" />
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
          <FormField label="Opening Balance">
            <Input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
          </FormField>
          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </FormField>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Supplier?"
        message="This will permanently remove the supplier. This action cannot be undone."
        confirmText="Delete"
        loading={deleteMutation.isPending}
      />

      <SendDialog
        open={!!statementFor}
        onClose={() => setStatementFor(null)}
        contextLabel={`Statement — ${statementFor?.name ?? ''}`}
        docType="statement"
        docNumber="STATEMENT"
        templateKey="statement_supplier"
        templateVariables={{
          supplier_name: statementFor?.name || '',
          business_name: activeBusiness?.name || '',
          period_start: formatDate(new Date(Date.now() - 90 * 86400000)),
          period_end: formatDate(new Date()),
          balance: formatCurrency(Number(statementFor?.current_balance || 0), activeBusiness?.currency_symbol),
        }}
        defaultSubject={`Supplier statement from ${activeBusiness?.name || 'us'}`}
        defaultMessage={`Dear ${statementFor?.name || 'supplier'}, please find your account statement attached. Closing balance: ${formatCurrency(Number(statementFor?.current_balance || 0), activeBusiness?.currency_symbol)}.`}
        recipients={[
          {
            label: statementFor?.company_name || statementFor?.name || 'Supplier on record',
            email: statementFor?.email,
            phone: statementFor?.phone,
          },
        ]}
        attachments={[
          {
            id: 'statement-csv',
            label: 'Account statement (CSV)',
            filename: `statement-${(statementFor?.name || 'supplier').replace(/\W+/g, '-').toLowerCase()}.csv`,
            build: async () => {
              if (!activeBusiness || !statementFor) throw new Error('Statement is not ready.');
              const { data, error } = await supabase.rpc('get_supplier_statement', {
                p_business_id: activeBusiness.id,
                p_supplier_id: statementFor.id,
                p_from_date: null,
                p_to_date: null,
              });
              if (error) throw new Error(error.message);
              const rows = (data || []) as { entry_date: string; description: string; doc_number: string | null; debit_amount: number; credit_amount: number; running_balance: number }[];
              const header = ['Date', 'Description', 'Doc No', 'Debit', 'Credit', 'Balance'];
              const lines = rows.map((r) =>
                [r.entry_date, `"${r.description.replace(/"/g, '""')}"`, r.doc_number || '', r.debit_amount, r.credit_amount, r.running_balance].join(',')
              );
              return new Blob([`\uFEFF${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
            },
          },
        ]}
      />
    </div>
  );
}
