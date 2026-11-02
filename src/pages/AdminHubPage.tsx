import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ShieldCheck, Users, ScrollText, Database, Building2, Check, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { roleLabel, can, capabilityTooltip, ALL_ROLES, type Capability } from '@/lib/rbac';
import { TeamPanel } from '@/components/admin/TeamPanel';
import { AuditLogPanel } from '@/components/admin/AuditLogPanel';
import { DataBackupsPanel } from '@/components/admin/DataBackupsPanel';
import { DataExportPanel } from '@/components/settings/DataExportPanel';

const CAPABILITY_MATRIX: { capability: Capability; label: string; roles: string[] }[] = [
  { capability: 'settings.edit', label: 'Edit business settings', roles: ['owner', 'admin'] },
  { capability: 'members.manage', label: 'Manage members & roles', roles: ['owner', 'admin'] },
  { capability: 'data.export', label: 'Export data', roles: ['owner', 'admin', 'manager', 'accountant'] },
];

function RoleMatrix() {
  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-lg bg-success-100 dark:bg-success-900/30 p-2.5">
          <ShieldCheck className="h-5 w-5 text-success-600 dark:text-success-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Role &amp; permissions matrix</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Mirrors migration 024 server policies — the database remains the source of truth</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary-500 dark:text-secondary-400">
              <th className="pb-2 pr-4 font-medium">Role</th>
              {CAPABILITY_MATRIX.map((c) => (
                <th key={c.capability} className="pb-2 pr-4 font-medium text-center">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
            {ALL_ROLES.map((role) => (
              <tr key={role}>
                <td className="py-2.5 pr-4 font-medium text-secondary-900 dark:text-secondary-100 whitespace-nowrap">{roleLabel(role)}</td>
                {CAPABILITY_MATRIX.map((c) => (
                  <td key={c.capability} className="py-2.5 pr-4 text-center">
                    {can(role, c.capability) ? (
                      <Check className="h-4 w-4 text-success-500 inline" aria-label={`${roleLabel(role)} can ${c.label}`} />
                    ) : (
                      <span className="text-secondary-300 dark:text-secondary-600" aria-hidden="true">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-secondary-400">Gated actions stay disabled-with-tooltip for restricted roles — never hidden-only.</p>
    </section>
  );
}

function SubscriptionOrgPanel() {
  const { businesses, activeBusiness, activeRole, setActiveBusiness, user } = useAuth();

  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
          <Building2 className="h-5 w-5 text-accent-600 dark:text-accent-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Subscription &amp; Organization</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Your organizations and account context</p>
        </div>
      </div>

      <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-3">
        Multi-business switcher — switch the workspace without leaving the Admin page:
      </p>
      <ul className="divide-y divide-secondary-100 dark:divide-secondary-800 border border-secondary-200 dark:border-secondary-700 rounded-xl overflow-hidden mb-4">
        {businesses.map((b) => {
          const isActive = activeBusiness?.id === b.id;
          return (
            <li key={b.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">
                  {b.name}
                  {isActive && <Badge variant="primary">active</Badge>}
                </p>
                <p className="text-xs text-secondary-400 truncate">
                  {b.legal_name || b.name} · FY {b.financial_year}
                </p>
              </div>
              {isActive ? (
                <Badge variant="neutral"><Check className="h-3.5 w-3.5" /> Current</Badge>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setActiveBusiness(b)} title={`Switch to ${b.name}`}>
                  Switch workspace
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/app/settings"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-200 dark:hover:bg-secondary-700 transition-colors"
        >
          Business settings <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <p className="mt-4 text-xs text-secondary-500 dark:text-secondary-400">
        Signed in as <span className="font-medium text-secondary-900 dark:text-secondary-100">{user?.email || '—'}</span> · {roleLabel(activeRole)} access ·
        {' '}plan &amp; usage limits are not wired to billing in this build (no subscription tables yet) — functional organization controls only.
      </p>
    </section>
  );
}

// PBS-121: strict exclusive tab rendering (human spec) — render switch, not
// anchors; only the active card is in the DOM.
type AdminTab = 'users' | 'audit' | 'data' | 'org';
const TAB_TO_HASH: Record<AdminTab, string> = {
  users: 'admin-users',
  audit: 'admin-audit',
  data: 'admin-data',
  org: 'admin-org',
};
const HASH_TO_TAB: Record<string, AdminTab> = {
  'admin-users': 'users',
  'admin-audit': 'audit',
  'admin-data': 'data',
  'admin-org': 'org',
};

const TABS = [
  { id: 'users', label: '1. User & Role Management' },
  { id: 'audit', label: '2. Audit Logs & Activity' },
  { id: 'data', label: '3. Database & Backup' },
  { id: 'org', label: '4. Subscription & Organization' },
];

export function AdminHubPage() {
  const { activeRole, activeBusiness } = useAuth();
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    try {
      const h = window.location.hash.replace('#', '');
      return HASH_TO_TAB[h] || 'users';
    } catch {
      return 'users';
    }
  });
  const switchTab = (id: AdminTab) => {
    setActiveTab(id);
    try {
      window.history.replaceState(null, '', `#${TAB_TO_HASH[id]}`);
    } catch {
      /* hash update is best-effort */
    }
  };

  return (
    <div>
      <PageHeader
        title="Admin"
        subtitle={`Platform & user governance for ${activeBusiness?.name || 'your business'}`}
        meta={<Badge variant={isAdmin ? 'primary' : 'neutral'}>{roleLabel(activeRole)}</Badge>}
      />

      <nav aria-label="Admin sections" className="sticky top-[64px] z-20 -mx-1 mb-4 flex gap-2 overflow-x-auto py-2 px-1 backdrop-blur-sm">
        {TABS.map((s) => (
          <button
            key={s.id}
            onClick={() => switchTab(s.id as AdminTab)}
            aria-current={activeTab === s.id}
            className={activeTab === s.id
              ? 'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium bg-primary-600 text-white shadow-sm transition-colors'
              : 'shrink-0 rounded-full border border-secondary-200 dark:border-secondary-700 bg-white/80 dark:bg-zinc-900/80 px-3.5 py-1.5 text-xs font-medium text-secondary-600 dark:text-secondary-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors'}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {!isAdmin && (
        <div className="card p-4 mb-6 flex items-center gap-3 border-warning-300 dark:border-warning-700">
          <ShieldCheck className="h-5 w-5 text-warning-500 shrink-0" />
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            You have <span className="font-semibold text-secondary-900 dark:text-secondary-100">{roleLabel(activeRole)}</span> access — team management and fiscal-year controls are disabled for your role.
          </p>
        </div>
      )}

      <div className="space-y-6 scroll-mt-24">
        {/* 1. User & Role Management */}
        {activeTab === 'users' && (
        <div id="admin-users" className="scroll-mt-28 space-y-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <Users className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <h2 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">User &amp; Role Management</h2>
          </div>
          <TeamPanel />
          <RoleMatrix />
        </div>
        )}


        {/* 2. Audit Logs & Activity */}
        {activeTab === 'audit' && (
        <div id="admin-audit" className="scroll-mt-28 space-y-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-secondary-100 dark:bg-secondary-800 p-2.5">
              <ScrollText className="h-5 w-5 text-secondary-600 dark:text-secondary-300" />
            </div>
            <h2 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Audit Logs &amp; Activity</h2>
          </div>
          <AuditLogPanel />
        </div>
        )}


        {/* 3. Database & Backup */}
        {activeTab === 'data' && (
        <div id="admin-data" className="scroll-mt-28 space-y-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success-100 dark:bg-success-900/30 p-2.5">
              <Database className="h-5 w-5 text-success-600 dark:text-success-400" />
            </div>
            <h2 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Database &amp; Backup</h2>
          </div>
          <DataBackupsPanel />
          <section className="card p-6">
            <DataExportPanel />
          </section>
        </div>
        )}


        {/* 4. Subscription & Organization */}
        {activeTab === 'org' && (
        <div id="admin-org" className="scroll-mt-28 space-y-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Subscription &amp; Organization</h2>
          </div>
          <SubscriptionOrgPanel />
        </div>
        )}
      </div>
    </div>
  );
}
