import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { ShieldCheck } from 'lucide-react';
import { roleLabel } from '@/lib/rbac';
import { BusinessProfilePanel } from '@/components/admin/BusinessProfilePanel';
import { TeamPanel } from '@/components/admin/TeamPanel';
import { AuditLogPanel } from '@/components/admin/AuditLogPanel';
import { DataBackupsPanel } from '@/components/admin/DataBackupsPanel';

export function AdminHubPage() {
  const { activeRole, activeBusiness } = useAuth();
  const isAdmin = activeRole === 'owner' || activeRole === 'admin';

  return (
    <div>
      <PageHeader
        title="Admin"
        subtitle={`Business controls for ${activeBusiness?.name || 'your business'}`}
        meta={<Badge variant={isAdmin ? 'primary' : 'neutral'}>{roleLabel(activeRole)}</Badge>}
      />

      {!isAdmin && (
        <div className="card p-4 mb-6 flex items-center gap-3 border-warning-300 dark:border-warning-700">
          <ShieldCheck className="h-5 w-5 text-warning-500 shrink-0" />
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            You have <span className="font-semibold text-secondary-900 dark:text-secondary-100">{roleLabel(activeRole)}</span> access — team management and fiscal-year controls are disabled for your role.
          </p>
        </div>
      )}

      <div className="space-y-6">
        <BusinessProfilePanel />
        <TeamPanel />
        <AuditLogPanel />
        <DataBackupsPanel />
      </div>
    </div>
  );
}
