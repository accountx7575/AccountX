import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { capabilityTooltip } from '@/lib/rbac';
import { buildFullLedgerJson } from '@/lib/exportLedger';
import { Database, Lock, LockOpen, FileDown, ShieldCheck, Archive } from 'lucide-react';

type FyLockRow = { fy_label: string; created_at?: string | null };

export function DataBackupsPanel() {
  const { activeBusiness, activeRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [backupExporting, setBackupExporting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'close' | 'reopen' | null>(null);

  const canEditSettings = activeRole === 'owner' || activeRole === 'admin';
  const canExportData = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'manager' || activeRole === 'accountant';

  const lockQuery = useQuery({
    queryKey: ['fy-lock', activeBusiness?.id],
    queryFn: async (): Promise<FyLockRow | null> => {
      if (!activeBusiness) return null;
      const { data, error } = await supabase
        .from('fiscal_year_closes')
        .select('fy_label, created_at')
        .eq('business_id', activeBusiness.id)
        .maybeSingle();
      if (error) throw error;
      return (data as FyLockRow | null) ?? null;
    },
    enabled: !!activeBusiness,
  });

  const fyMutation = useMutation({
    mutationFn: async (action: 'close' | 'reopen') => {
      if (!activeBusiness) throw new Error('No active business');
      const rpc = action === 'close' ? 'close_fiscal_year' : 'reopen_fiscal_year';
      const { error } = await supabase.rpc(rpc, { p_business_id: activeBusiness.id });
      if (error) throw error;
    },
    onSuccess: async (_data, action) => {
      await queryClient.invalidateQueries({ queryKey: ['fy-lock', activeBusiness?.id] });
      toast(action === 'close' ? 'Fiscal year closed — documents in it are now read-only' : 'Fiscal year reopened', 'success');
      setConfirmAction(null);
    },
    onError: (err: Error) => {
      toast(err.message || 'Fiscal year operation failed', 'error');
      setConfirmAction(null);
    },
  });

  async function exportFullLedger() {
    if (!activeBusiness) return;
    setExporting(true);
    try {
      const bundle = await buildFullLedgerJson(activeBusiness.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accountx-full-ledger_${activeBusiness.name.replace(/[^a-z0-9]+/gi, '-')}_${bundle.fiscalYear.replace(/\s+/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Full-ledger backup downloaded', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Backup failed', 'error');
    } finally {
      setExporting(false);
    }
  }

  async function exportBusinessBackup() {
    if (!activeBusiness) return;
    setBackupExporting(true);
    try {
      const { data: snapshot, error } = await supabase.rpc('export_business_backup', { p_business_id: activeBusiness.id });
      if (error) throw error;
      const doc = (snapshot ?? {}) as Record<string, unknown>;
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const day = typeof doc.generated_at === 'string' ? doc.generated_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
      a.download = `business-backup-${day}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Business backup downloaded', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/not authenticated/i.test(msg)) {
        toast('Your session has expired. Please sign in again to export a backup.', 'error');
      } else if (/not a member/i.test(msg)) {
        toast('You do not have permission to back up this business.', 'error');
      } else {
        toast(msg || 'Business backup failed', 'error');
      }
    } finally {
      setBackupExporting(false);
    }
  }

  const locked = lockQuery.data;
  const busy = fyMutation.isPending;

  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
          <Database className="h-5 w-5 text-accent-600 dark:text-accent-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Data & Backups</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Business data &amp; full-ledger exports and fiscal-year integrity controls</p>
        </div>
      </div>

      <div className="rounded-xl border border-secondary-200 dark:border-secondary-700 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <FileDown className="h-5 w-5 text-secondary-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">Full-Ledger Backup</p>
            <p className="text-xs text-secondary-500 dark:text-secondary-400">Current fiscal year as one JSON bundle — day book, P&L, balance sheet, cash flow, GST, aging.</p>
          </div>
          <Button variant="secondary" size="sm" loading={exporting} disabled={!canExportData} title={canExportData ? 'Download the current fiscal year as one JSON bundle' : capabilityTooltip('data.export', activeRole) || undefined} onClick={() => void exportFullLedger()}>
            Download JSON
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-secondary-200 dark:border-secondary-700 p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Archive className="h-5 w-5 text-secondary-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">Business Backup / Data Export</p>
            <p className="text-xs text-secondary-500 dark:text-secondary-400">
              Point-in-time business data, not a full disaster-recovery backup. One JSON snapshot of all business records:
              customers, suppliers, products, warehouses, invoices, bills, payments, accounts, journals and stock movements.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={backupExporting}
            disabled={!canExportData}
            title={canExportData ? 'Download a point-in-time JSON snapshot of this business' : capabilityTooltip('data.export', activeRole) || undefined}
            onClick={() => void exportBusinessBackup()}
          >
            Download JSON
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-secondary-200 dark:border-secondary-700 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {locked ? <Lock className="h-5 w-5 text-error-500 shrink-0" aria-hidden="true" /> : <LockOpen className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">
              Fiscal Year {lockQuery.isLoading ? '…' : locked ? locked.fy_label : 'Open'}
              {!lockQuery.isLoading && <span className={`ml-2 badge ${locked ? 'tone-error' : 'tone-success'}`}>{locked ? 'Locked' : 'Open'}</span>}
            </p>
            <p className="text-xs text-secondary-500 dark:text-secondary-400">
              Closing transfers the P&L to capital and freezes the year&apos;s documents server-side. Reopening reverses the close.
            </p>
          </div>
          {locked ? (
            <Button variant="secondary" size="sm" disabled={!canEditSettings || busy} loading={busy && confirmAction === 'reopen'} title={!canEditSettings ? capabilityTooltip('settings.edit', activeRole) || undefined : 'Reverse the closing entry and unfreeze the year'} onClick={() => setConfirmAction('reopen')}>
              <LockOpen className="h-3.5 w-3.5" /> Reopen FY
            </Button>
          ) : (
            <Button variant="danger" size="sm" disabled={!canEditSettings || busy} loading={busy && confirmAction === 'close'} title={!canEditSettings ? capabilityTooltip('settings.edit', activeRole) || undefined : 'Freeze this year and carry profit to capital'} onClick={() => setConfirmAction('close')}>
              <ShieldCheck className="h-3.5 w-3.5" /> Close FY
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === 'close'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => fyMutation.mutate('close')}
        title="Close fiscal year?"
        message={`This closes FY ${activeBusiness?.financial_year || ''}: profit-and-loss balances transfer to capital and every document dated inside the year becomes read-only. You can reopen later.`}
        confirmText="Close Fiscal Year"
        danger
        loading={busy}
      />
      <ConfirmDialog
        open={confirmAction === 'reopen'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => fyMutation.mutate('reopen')}
        title="Reopen fiscal year?"
        message="A reversing entry restores the income statement for this year and unfreezes its documents."
        confirmText="Reopen Fiscal Year"
        danger={false}
        loading={busy}
      />
    </section>
  );
}
