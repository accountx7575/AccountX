import { useCallback, useState, useEffect } from 'react';
import { useSuperAdmin } from '@/hooks/useSuperAdmin';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/context/ToastContext';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { ArrowLeftRight, ShieldCheck, Loader2, X, Building2, Users, FileText } from 'lucide-react';
import { useMemo } from 'react';
import { Modal } from '@/components/ui/Modal';

type TenantRow = {
  business_id: string;
  legal_name: string | null;
  owner_email: string;
  gstin: string | null;
  created_at: string;
  is_active: boolean;
};

export function SuperAdminPage() {
  const { activeRole } = useAuth();

  const { fetchMetrics, fetchTenants, toggleTenantStatus } = useSuperAdmin();

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<TenantRow | null>(null);

  useEffect(() => {
    let mounted = true;
    ;(async () => {
      try {
        const t = await fetchTenants();
        if (mounted) {
          const mapped: TenantRow[] = (t ?? []).map((b: any) => ({
            business_id: b.id,
            legal_name: b.legal_name,
            owner_email: b.owner_email || b.owner_id?.slice(0, 8) || '—',
            gstin: b.gstin || '',
            created_at: b.created_at,
            is_active: b.is_active,
          }));
          setTenants(mapped);
        }
      } catch (err) {
        // handle gracefully
      }
    })();
    return () => { mounted = false };
  }, [fetchTenants]);

  const handleRefresh = useCallback(async () => {
    try {
      const t = await fetchTenants();
      if (t) {
        const mapped: TenantRow[] = t.map((b: any) => ({
          business_id: b.id,
          legal_name: b.legal_name,
          owner_email: b.owner_email || b.owner_id?.slice(0, 8) || '—',
          gstin: b.gstin || '',
          created_at: b.created_at,
          is_active: b.is_active,
        }));
        setTenants(mapped);
      }
    } catch (err) {
      // handle gracefully
    }
  }, [fetchTenants]);

  const filteredTenants = useMemo(() => {
    if (!searchQuery) return tenants;
    return tenants.filter((t) => {
      const nameMatch = t.legal_name?.toLowerCase().includes(searchQuery.toLowerCase());
      const gstinMatch = (t.gstin ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      return nameMatch || gstinMatch;
    });
  }, [tenants, searchQuery]);

  const columns: DataTableColumn<TenantRow>[] = [
    {
      key: 'legal_name',
      label: 'Business Legal Name',
      align: undefined,
      render: (row: TenantRow) => {
        return (
          <div className="truncate whitespace-normal max-w-xs">
            {row.legal_name || '—'}
          </div>
        );
      },
    },
    {
      key: 'owner_email',
      label: 'Owner Email',
      align: undefined,
      render: (row: TenantRow) => {
        return <span className="truncate whitespace-normal max-w-xs">{row.owner_email}</span>;
      },
    },
    {
      key: 'gstin',
      label: 'GSTIN',
      align: undefined,
      render: (row: TenantRow) => {
        return (
          <span className="truncate whitespace-normal max-w-xs"
            title={row.gstin || ''}
          >
            {row.gstin || '—'}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      label: 'Created Date',
      align: undefined,
      render: (row: TenantRow) => {
        return (
          <span className="text-[10px] text-secondary-500 dark:text-secondary-400 whitespace-nowrap">
            {row.created_at.slice(0, 10)}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      align: undefined,
      render: (row: TenantRow) => {
        const variant = row.is_active ? 'success' : 'error';
        return (
          <Badge variant={variant} className="text-xs">
            {row.is_active ? 'Active' : 'Suspended'}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      label: 'Action',
      align: 'center',
      render: (row: TenantRow) => {
        return (
          <Button
            variant={row.is_active ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setEditingTenant(row);
              setModalOpen(true);
            }}
            className="text-xs px-2 py-1"
          >
            {row.is_active ? 'Suspend' : 'Activate'}
          </Button>
        );
      },
    },
  ];

  const quickSearchPlaceholder = searchQuery
    ? searchQuery.length > 3 ? 'GSTIN…' : 'business name…'
    : 'Search by business name or GSTIN…';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin Control Center"
        subtitle={`Platform overview — ${activeRole || 'no role'}`}
        meta={
          <Badge variant="primary">Live</Badge>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <h3 className="text-sm font-medium text-secondary-900 dark:text-secondary-100 mb-3">Platform Metrics</h3>
          <div className="grid grid-cols-2 gap-2">
            <span className="text-xs text-secondary-500 dark:text-secondary-400">Total Businesses: </span>
            <span id="total-businesses" className="font-medium"></span>
            <br />
            <span className="text-xs text-secondary-500 dark:text-secondary-400">Total Users: </span>
            <span id="total-users" className="font-medium"></span>
            <br />
            <span className="text-xs text-secondary-500 dark:text-secondary-400">Invoices: </span>
            <span id="total-invoices" className="font-medium"></span>
            <br />
            <span className="text-xs text-secondary-500 dark:text-secondary-400">System Status: </span>
            <span id="system-status" className="font-medium"></span>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <Input
            placeholder={quickSearchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
            aria-label="Quick search tenants by business name or GSTIN"
          />
          <Button variant="secondary" size="sm" onClick={handleRefresh}>
            <Loader2 className="h-4 w-4" /> Refresh
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={filteredTenants}
          rowKey={(r) => r.business_id}
          loading={tenants.length === 0 && searchQuery === ''}
          stickyHeader
          emptyState={
            <div className="px-4 py-10 text-center text-sm text-secondary-400">
              No tenants found.{" "}
              {searchQuery && <p className="text-xs text-secondary-500">Try adjusting your search term.</p>}
            </div>
          }
        />

        <Modal
          open={modalOpen}
          onClose={() => {
            setEditingTenant(null);
            setModalOpen(false);
          }}
          title="Tenant Status Toggle"
          size="sm"
        >
          <div className="space-y-4 pt-1">
            {editingTenant != null && (
              <p className="text-sm text-secondary-500 dark:text-secondary-400">
                {editingTenant.is_active ? 'Suspend this tenant?' : 'Activate this tenant?'}
              </p>
            )}
            <p className="text-xs text-secondary-500 dark:text-secondary-400">
              Business: {editingTenant?.legal_name || '—'} (GSTIN: {editingTenant?.gstin || '—'})
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (editingTenant) {
                    toggleTenantStatus(editingTenant.business_id, !editingTenant.is_active);
                    setEditingTenant(null);
                    setModalOpen(false);
                    handleRefresh();
                  }
                }}
                disabled={editingTenant == null}
                loading={editingTenant == null}
              >
                {editingTenant?.is_active ? 'Activate' : 'Suspend'}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}