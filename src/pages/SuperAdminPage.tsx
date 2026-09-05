import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Building2, Users, LogOut, ShieldCheck, Search, CheckCircle, Ban, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Tenant {
  id: string;
  name: string;
  tradeName: string;
  ownerEmail: string;
  gstin: string;
  createdAt: string;
  isActive: boolean;
  type: string;
}

export function SuperAdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadRealData = async () => {
    setLoading(true);
    try {
      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
        .order('created_at', { ascending: false });

      if (bizData && bizData.length > 0) {
        const formatted: Tenant[] = bizData.map((b: any) => ({
          id: b.id,
          name: b.legal_name || b.name || 'Unnamed Business',
          tradeName: b.trade_name || b.legal_name || '—',
          ownerEmail: b.email || 'abc.solar7575@gmail.com',
          gstin: b.gstin || '09AABPQ3096M1Z5',
          createdAt: new Date(b.created_at || Date.now()).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
          }),
          isActive: b.is_active ?? true,
          type: b.business_type || 'Services'
        }));
        setTenants(formatted);
      }
    } catch (err) {
      console.error('Failed to load real business data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRealData();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    setTenants(prev => prev.map(t => t.id === id ? { ...t, isActive: nextStatus } : t));
    await supabase.from('businesses').update({ is_active: nextStatus }).eq('id', id);
  };

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.ownerEmail.toLowerCase().includes(search.toLowerCase()) ||
    t.gstin.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = tenants.filter(t => t.isActive).length;
  const blockedCount = tenants.length - activeCount;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 p-6 sm:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-slate-200 dark:border-zinc-800 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 dark:bg-primary-950/50 rounded-lg text-primary-600 dark:text-primary-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Super Admin Control Center</h1>
              <Badge variant="primary">Production Live</Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Real-time multi-tenant database records</p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadRealData}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Sync DB
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleSignOut}
              className="flex items-center gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          </div>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Total Businesses</span>
              <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-lg"><Building2 className="w-5 h-5" /></div>
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-3">{tenants.length}</div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Active Tenants</span>
              <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 rounded-lg"><CheckCircle className="w-5 h-5" /></div>
            </div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-3">{activeCount}</div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Suspended / Blocked</span>
              <div className="p-2 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg"><Ban className="w-5 h-5" /></div>
            </div>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-3">{blockedCount}</div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Registered Tenants</span>
              <div className="p-2 bg-purple-50 dark:bg-purple-950/50 text-purple-600 rounded-lg"><Users className="w-5 h-5" /></div>
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-3">{tenants.length}</div>
          </div>
        </div>

        {/* Search & Actions Bar */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search by legal name, email or GSTIN..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <span className="text-xs text-slate-500 font-medium">Showing {filteredTenants.length} live database records</span>
        </div>

        {/* Tenants Table */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-slate-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-zinc-800/50 border-b border-slate-200 dark:border-zinc-800 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Business Legal Name</th>
                  <th className="px-6 py-4">Owner Email</th>
                  <th className="px-6 py-4">GSTIN</th>
                  <th className="px-6 py-4">Created Date</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-400">Syncing live tenants from Supabase...</td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-400">No tenants registered yet.</td>
                  </tr>
                ) : (
                  filteredTenants.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{t.name}</div>
                        <div className="text-xs text-slate-400">{t.type}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-zinc-300 font-mono text-xs">{t.ownerEmail}</td>
                      <td className="px-6 py-4 text-slate-600 dark:text-zinc-300 font-mono text-xs">{t.gstin}</td>
                      <td className="px-6 py-4 text-slate-500 text-xs">{t.createdAt}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          t.isActive 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400' 
                            : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400'
                        }`}>
                          {t.isActive ? 'Active' : 'Blocked'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          size="sm"
                          variant={t.isActive ? 'secondary' : 'primary'}
                          onClick={() => toggleStatus(t.id, t.isActive)}
                          className={`text-xs ${t.isActive ? 'text-rose-600 hover:bg-rose-50' : ''}`}
                        >
                          {t.isActive ? 'Block Tenant' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
