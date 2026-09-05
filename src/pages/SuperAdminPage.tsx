import React, { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/ui/StatCard';
import { Input } from '@/components/ui/Input';
import { Building2, Users, FileText, Activity, LogOut, ShieldCheck, Search, CheckCircle, Ban } from 'lucide-react';
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

const INITIAL_TENANTS: Tenant[] = [
  { id: '1', name: 'Avadh Boring Company', tradeName: 'Avadh Boring Works', ownerEmail: 'abc.solar7575@gmail.com', gstin: '09AABCU9603R1ZM', createdAt: '05 Sep 2026', isActive: true, type: 'Services' },
  { id: '2', name: 'Reliance Retail Logistics Ltd', tradeName: 'RR Logistics', ownerEmail: 'logistics@reliance.in', gstin: '27AABCR1234F1Z5', createdAt: '02 Sep 2026', isActive: true, type: 'Logistics' },
  { id: '3', name: 'Bharat Electronics & Motors', tradeName: 'BEM Industrial', ownerEmail: 'orders@bharatmotors.com', gstin: '07AAACB9876Q1Z2', createdAt: '28 Aug 2026', isActive: true, type: 'Manufacturing' },
  { id: '4', name: 'Apex Cloud Infotech Pvt Ltd', tradeName: 'Apex Infotech', ownerEmail: 'finance@apexcloud.io', gstin: '29ABCDE1122C1Z4', createdAt: '20 Aug 2026', isActive: true, type: 'SaaS' },
  { id: '5', name: 'Kashi Textiles & Handloom', tradeName: 'Kashi Weaves', ownerEmail: 'contact@kashitextiles.in', gstin: '09AABCK5544H1Z8', createdAt: '15 Aug 2026', isActive: false, type: 'Retail' },
  { id: '6', name: 'Deccan Agro Commodities', tradeName: 'Deccan Agro', ownerEmail: 'ops@deccanagro.com', gstin: '36AABCD9988G1Z1', createdAt: '10 Aug 2026', isActive: true, type: 'Trading' },
];

export function SuperAdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>(INITIAL_TENANTS);
  const [search, setSearch] = useState('');

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = '/login';
  };

  const toggleStatus = (id: string) => {
    setTenants(prev => prev.map(t => t.id === id ? { ...t, isActive: !t.isActive } : t));
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
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">Platform-level multi-tenant management & control</p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleSignOut}
            className="flex items-center gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 w-fit"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>

        {/* Metrics Overview */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Businesses" value={tenants.length} icon={Building2} />
          <StatCard title="Active Subscriptions" value={activeCount} icon={CheckCircle} />
          <StatCard title="Suspended / Blocked" value={blockedCount} icon={Ban} />
          <StatCard title="Total Platform Users" value={28} icon={Users} />
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
          <span className="text-xs text-slate-500 font-medium">Showing {filteredTenants.length} registered tenants</span>
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
                {filteredTenants.map(t => (
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
                        onClick={() => toggleStatus(t.id)}
                        className={`text-xs ${t.isActive ? 'text-rose-600 hover:bg-rose-50' : ''}`}
                      >
                        {t.isActive ? 'Block Tenant' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
