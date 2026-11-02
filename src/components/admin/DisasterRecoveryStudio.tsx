import { useState } from 'react';
import { Database, Download, Gauge, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry';

const MAINTENANCE_FLAG = 'accountx_maintenance_mode';

type PingRound = { round: number; restMs: number; rpcMs: number };

function isMaintenanceOn(): boolean {
  try {
    return localStorage.getItem(MAINTENANCE_FLAG) === 'true';
  } catch {
    return false;
  }
}

/**
 * Disaster Recovery Studio — snapshot export, ping benchmark, and the
 * maintenance-mode sentinel. Rendered inside the System Telemetry tab.
 */
export function DisasterRecoveryStudio() {
  const { logAdminEvent } = useAdminTelemetry();
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);
  const [pingBusy, setPingBusy] = useState(false);
  const [rounds, setRounds] = useState<PingRound[]>([]);
  const [maintenance, setMaintenance] = useState<boolean>(isMaintenanceOn());
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  const handleSnapshot = async () => {
    setSnapshotBusy(true);
    setSnapshotMsg(null);
    try {
      const { data, error } = await supabase.rpc('admin_export_full_platform_dump');
      if (error) throw error;
      const payload = JSON.stringify(
        { exported_at: new Date().toISOString(), snapshot: data },
        null,
        2,
      );
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.href = url;
      a.download = `accountx_snapshot_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSnapshotMsg('Snapshot downloaded.');
      void logAdminEvent('PLATFORM_SNAPSHOT_EXPORTED', null, { file: a.download });
    } catch (err) {
      setSnapshotMsg(err instanceof Error ? err.message : 'Snapshot export failed.');
    } finally {
      setSnapshotBusy(false);
    }
  };

  const handlePingBenchmark = async () => {
    setPingBusy(true);
    setRounds([]);
    try {
      const results: PingRound[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const restStart = performance.now();
        await supabase.from('businesses').select('id', { count: 'exact', head: true });
        const restMs = Math.round(performance.now() - restStart);

        const rpcStart = performance.now();
        await supabase.rpc('is_super_admin');
        const rpcMs = Math.round(performance.now() - rpcStart);

        results.push({ round: i, restMs, rpcMs });
        setRounds([...results]);
      }
    } finally {
      setPingBusy(false);
    }
  };

  const handleMaintenanceToggle = async () => {
    const next = !maintenance;
    setMaintenanceBusy(true);
    try {
      try {
        localStorage.setItem(MAINTENANCE_FLAG, String(next));
      } catch {
        /* flag is best-effort */
      }
      if (next) {
        // Broadcast a maintenance notice tenants will see in the announcement bar.
        await supabase.from('platform_announcements').insert({
          title: 'Scheduled maintenance',
          message:
            'The platform is in read-only maintenance mode. Invoice creation is temporarily paused for tenants.',
          severity: 'maintenance',
          is_active: true,
        });
      } else {
        // Retire active maintenance broadcasts.
        await supabase
          .from('platform_announcements')
          .update({ is_active: false, expires_at: new Date().toISOString() })
          .eq('severity', 'maintenance')
          .eq('is_active', true);
      }
      setMaintenance(next);
      void logAdminEvent(
        next ? 'MAINTENANCE_MODE_ENABLED' : 'MAINTENANCE_MODE_DISABLED',
      );
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const all = rounds.flatMap((r) => [r.restMs, r.rpcMs]);
  const stats =
    all.length > 0
      ? {
          min: Math.min(...all),
          max: Math.max(...all),
          avg: Math.round(all.reduce((a, b) => a + b, 0) / all.length),
        }
      : null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-slate-200 dark:border-zinc-800 p-5">
      <div className="flex items-center gap-2 mb-1">
        <Database className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Disaster Recovery Studio
        </h3>
      </div>
      <p className="text-xs text-slate-500 dark:text-zinc-400 mb-4">
        Snapshots, latency benchmarks, and the maintenance sentinel.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Snapshot */}
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Platform snapshot</p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            Sanitized schema + rollups as a JSON download.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSnapshot}
            loading={snapshotBusy}
            className="mt-3 w-full"
          >
            <Download className="w-4 h-4" /> Generate Full Platform Snapshot
          </Button>
          {snapshotMsg && <p className="text-xs text-slate-500 mt-2">{snapshotMsg}</p>}
        </div>

        {/* Ping benchmark */}
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Database ping benchmark</p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            5 roundtrips against REST + RPC layers.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePingBenchmark}
            loading={pingBusy}
            className="mt-3 w-full"
          >
            <Gauge className="w-4 h-4" /> Run Benchmark
          </Button>
          {stats && (
            <div className="mt-3 text-xs text-slate-600 dark:text-zinc-300 space-y-1">
              <p>
                min <span className="font-mono">{stats.min}ms</span> · max{' '}
                <span className="font-mono">{stats.max}ms</span> · avg{' '}
                <span className="font-mono">{stats.avg}ms</span>
              </p>
              <ul className="font-mono text-[11px] text-slate-500">
                {rounds.map((r) => (
                  <li key={r.round}>
                    #{r.round} rest {r.restMs}ms / rpc {r.rpcMs}ms
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Maintenance sentinel */}
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
          <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-500" /> Maintenance sentinel
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            Read-only mode for tenants; super-admin access stays active.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={maintenance}
            onClick={handleMaintenanceToggle}
            disabled={maintenanceBusy}
            className={`mt-3 w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              maintenance
                ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
                : 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
            }`}
          >
            <span>{maintenance ? 'Maintenance ON' : 'Maintenance OFF'}</span>
            <span
              className={`inline-block h-5 w-9 rounded-full p-0.5 transition-colors ${
                maintenance ? 'bg-amber-500' : 'bg-slate-300 dark:bg-zinc-600'
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  maintenance ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
