import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, History, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';
import { listTallyExports, type TallyExportHistoryRow } from '@/lib/tally/history';

/* ============================================================================
 * /app/tally/history (T104). LIVE over list_tally_exports (057 RPC).
 * Re-download = deterministic client-side regeneration from the row's stored
 * params (period + format + company) - identical bytes unless books changed
 * since; that honesty note is shown on the page.
 * ==========================================================================*/

const STATUS_BADGE: Record<TallyExportHistoryRow['status'], 'success' | 'warning' | 'error'> = {
  completed: 'success',
  partial: 'warning',
  failed: 'error',
};

export function TallyHistoryPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const businessId = activeBusiness?.id;
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['tally-export-history', businessId],
    queryFn: () => listTallyExports(businessId!),
    enabled: !!businessId,
  });

  const reDownload = async (row: TallyExportHistoryRow) => {
    if (!businessId || !activeBusiness) return;
    setRedownloadingId(row.id);
    try {
      // Deterministic regenerate from STORED params. Kept as a direct engine
      // call to avoid a circular import with the wizard page.
      const { buildTallyExport, downloadTallyExport } = await import('@/components/tally/tallyExportEngine');
      const meta = (row.metadata ?? {}) as { format?: 'xml' | 'csv' };
      const built = await buildTallyExport({
        businessId,
        companyName: activeBusiness.name,
        companyInfo: {
          name: activeBusiness.name,
          legalName: activeBusiness.legal_name ?? null,
          address: [activeBusiness.address, activeBusiness.city].filter(Boolean).join(', ') || null,
          gstin: activeBusiness.gstin ?? null,
          state: activeBusiness.state ?? null,
        },
        gstRegistered: activeBusiness.gst_registered === true,
        from: row.date_from,
        to: row.date_to,
        selection: {
          sales: row.export_types.includes('sales'),
          purchases: row.export_types.includes('purchase'),
          payments: row.export_types.includes('payments'),
          journals: row.export_types.includes('journal'),
          notes: row.export_types.includes('credit_debit_notes'),
          stockItems: true,
          opening: row.export_types.includes('opening_balances'),
        },
      });
      downloadTallyExport(built.bundle, meta.format ?? 'xml', activeBusiness.name, row.date_from, row.date_to);
      toast(`Regenerated ${row.date_from} → ${row.date_to} from current data`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Re-download failed', 'error');
    } finally {
      setRedownloadingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tally Export History"
        subtitle="Every generated export run for this business, newest first."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{history.data?.length ?? 0} runs</Badge>
            <Button variant="ghost" size="sm" onClick={() => history.refetch()} className="print:hidden">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/app/tally')}>
              <Download className="h-3.5 w-3.5" /> New export
            </Button>
          </span>
        }
      />

      {history.isError && (
        <ErrorState title="Could not load export history" message="Something went wrong reading the export log." onRetry={() => history.refetch()} />
      )}

      {history.isLoading && (
        <section className="card p-6">
          <div className="animate-pulse space-y-3 py-2" aria-busy="true">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${90 - i * 8}%` }} />
            ))}
          </div>
        </section>
      )}

      {history.isSuccess && (history.data ?? []).length === 0 && (
        <EmptyState
          icon={History}
          title="No exports recorded yet"
          description="Runs recorded here keep their parameters so you can regenerate the same export later. Try your first export from the wizard."
          action={
            <Button variant="secondary" onClick={() => navigate('/app/tally')}>
              Open the wizard
            </Button>
          }
        />
      )}

      {history.isSuccess && (history.data ?? []).length > 0 && (
        <>
          <section id="report-print-area" className="card overflow-hidden" aria-live="polite">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['When', 'Period', 'Data', 'Records', 'Warnings', 'Errors', 'Status', ''].map((h, i) => (
                      <th
                        key={i}
                        className={cn(
                          'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700',
                          i >= 3 && i <= 6 ? 'text-right' : 'text-left'
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(history.data ?? []).map((row) => {
                    const meta = (row.metadata ?? {}) as { format?: string };
                    return (
                      <tr key={row.id} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40 transition-colors">
                        <td className="px-3 py-2 whitespace-nowrap figure text-secondary-600 dark:text-secondary-400">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap figure">
                          {row.date_from} → {row.date_to}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1 max-w-[16rem]">
                            {row.export_types.map((t) => (
                              <Badge key={t} variant="neutral">{t.replace(/_/g, ' ')}</Badge>
                            ))}
                          </span>
                        </td>
                        <td className="figure px-3 py-2 text-right whitespace-nowrap">{row.record_count}</td>
                        <td className={cn('figure px-3 py-2 text-right whitespace-nowrap', row.warning_count > 0 ? 'text-warning-600 dark:text-warning-400 font-medium' : '')}>
                          {row.warning_count || ''}
                        </td>
                        <td className={cn('figure px-3 py-2 text-right whitespace-nowrap', row.error_count > 0 ? 'text-error-600 dark:text-error-400 font-semibold' : '')}>
                          {row.error_count || ''}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={STATUS_BADGE[row.status]}>
                            {row.status}{meta.format ? ` · ${meta.format.toUpperCase()}` : ''}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right print:hidden">
                          <Tooltip label="Deterministic regenerate from stored params - reflects current data for that period" side="top">
                            <Button size="sm" variant="secondary" loading={redownloadingId === row.id} onClick={() => reDownload(row)}>
                              <Download className="h-3.5 w-3.5" /> Re-download
                            </Button>
                          </Tooltip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <p className="text-xs text-secondary-400 print:hidden">
            Re-downloads rebuild the file client-side from the stored parameters against today's data - byte-identical unless the underlying
            documents changed since the original run.
          </p>
        </>
      )}
    </div>
  );
}
