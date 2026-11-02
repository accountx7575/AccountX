import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  CalendarRange,
  ListChecks,
  ShieldCheck,
  Download,
  History,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  FileCode2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { DatePicker } from '@/components/common/DatePicker';
import { cn } from '@/lib/utils';
import { getFiscalYear, toISODate } from '@/lib/reportsAdapter';
import {
  buildTallyExport,
  downloadTallyExport,
  dayBefore,
  ALL_SELECTION,
  EXPORT_TYPE_KEYS,
  type BuiltTallyExport,
  type TallySelection,
} from '@/components/tally/tallyExportEngine';
import { recordTallyExport } from '@/lib/tally/history';

/* ============================================================================
 * /app/tally - Tally export wizard (T104), owner 6-step spec:
 * Business -> Date Range -> Data selection -> Validate -> Export -> Download.
 * Engine calls mirror the Settings panel surface (shared module); the panel
 * keeps working until god's integration swap. Validation errors BLOCK;
 * warnings proceed and are carried into the export record.
 * ==========================================================================*/

const STEPS = [
  { icon: Building2, label: 'Business' },
  { icon: CalendarRange, label: 'Date Range' },
  { icon: ListChecks, label: 'Data' },
  { icon: ShieldCheck, label: 'Validate' },
  { icon: Download, label: 'Export' },
  { icon: History, label: 'Download' },
];

const SELECTION_ROWS: Array<{ key: keyof TallySelection; label: string; hint: string }> = [
  { key: 'sales', label: 'Sales', hint: 'Issued invoices as Sales vouchers' },
  { key: 'purchases', label: 'Purchases', hint: 'Confirmed bills as Purchase vouchers' },
  { key: 'payments', label: 'Payments', hint: 'Received/made payments as Receipt/Payment vouchers' },
  { key: 'journals', label: 'Journals', hint: 'Manual posted journal entries' },
  { key: 'notes', label: 'Credit-Debit Notes', hint: 'Issued/applied notes; refunds ride inside note vouchers' },
  { key: 'stockItems', label: 'Stock Items', hint: 'Product masters - best-effort HSN across Tally releases' },
  { key: 'opening', label: 'Opening Balances', hint: 'AR/AP from aging as of period start minus one day; Cash/Bank live balance less in-window movement' },
];

export function TallyWizardPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const businessId = activeBusiness?.id;

  const [step, setStep] = useState(0);
  const [from, setFrom] = useState(() => toISODate(getFiscalYear().start));
  const [to, setTo] = useState(() => toISODate(new Date()));
  const [selection, setSelection] = useState<TallySelection>(ALL_SELECTION);
  const [format, setFormat] = useState<'xml' | 'csv'>('xml');
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<BuiltTallyExport | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedFile, setExportedFile] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);

  if (!businessId || !activeBusiness) {
    return <ErrorState title="No active business" message="Select a business before exporting to Tally." />;
  }

  const paramsDirty = () => {
    setBuilt(null);
    setExportedFile(null);
    setHistoryNote(null);
  };

  const runValidation = async () => {
    setBuilding(true);
    setBuildError(null);
    try {
      const result = await buildTallyExport({
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
        from,
        to,
        selection,
      });
      setBuilt(result);
    } catch (e: any) {
      setBuildError(e?.message || 'Preflight failed');
      setBuilt(null);
    } finally {
      setBuilding(false);
    }
  };

  const doExport = async () => {
    if (!built || built.errorCount > 0) return;
    setExporting(true);
    try {
      // Deterministic re-generation for THIS session's validated bundle.
      const fresh = await buildTallyExport({
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
        from,
        to,
        selection,
      });
      const filename = downloadTallyExport(fresh.bundle, format, activeBusiness.name, from, to);
      setExportedFile(filename);
      setStep(5);
      try {
        await recordTallyExport({
          businessId,
          dateFrom: from,
          dateTo: to,
          exportTypes: (Object.keys(EXPORT_TYPE_KEYS) as Array<keyof TallySelection>)
            .filter((k) => selection[k])
            .map((k) => EXPORT_TYPE_KEYS[k]),
          recordCount: fresh.voucherCount,
          successCount: fresh.voucherCount,
          warningCount: fresh.warningCount,
          errorCount: fresh.errorCount,
          status: fresh.errorCount > 0 ? 'partial' : 'completed',
          metadata: { format, company_name: activeBusiness.name, stock_item_count: fresh.stockItemCount, ledger_master_count: fresh.ledgerCount },
        });
        setHistoryNote(null);
      } catch (e: any) {
        setHistoryNote(e?.message || 'unknown error');
      }
    } catch (e: any) {
      toast(e?.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tally Export"
        subtitle="Generate a Tally-importable file of your books: masters plus vouchers, validated before anything is written."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="neutral">XML / CSV</Badge>
            <Link to="/app/tally/history" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
              Export history →
            </Link>
            <Link to="/app/tally/mapping" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
              Ledger mapping →
            </Link>
          </span>
        }
      />

      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3" aria-label="Wizard steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const state = i === step ? 'current' : i < step ? 'done' : 'todo';
          return (
            <li key={s.label} className="flex items-center gap-2">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors',
                  state === 'current' && 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300',
                  state === 'done' && 'border-success-300 dark:border-success-700 bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300',
                  state === 'todo' && 'border-secondary-200 dark:border-secondary-700 text-secondary-500 dark:text-secondary-400'
                )}
              >
                {state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                {i + 1}. {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-secondary-300 dark:text-secondary-600" aria-hidden="true">—</span>}
            </li>
          );
        })}
      </ol>

      <section className="card p-6 min-h-[16rem]">
        {/* Step 1: Business */}
        {step === 0 && (
          <div className="space-y-4 max-w-xl">
            <StepTitle title="Confirm the exporting business" desc="Company header, GSTIN and state enrich the Tally file." />
            <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 p-4 space-y-1">
              <p className="font-semibold text-secondary-900 dark:text-secondary-100">{activeBusiness.name}</p>
              <p className="text-sm text-secondary-500 dark:text-secondary-400">
                {[activeBusiness.legal_name, [activeBusiness.address, activeBusiness.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'No address recorded'}
              </p>
              <p className="figure text-xs text-secondary-500 dark:text-secondary-400">
                {activeBusiness.gstin ? `GSTIN ${activeBusiness.gstin}` : 'No GSTIN'}
                {activeBusiness.state ? ` · ${activeBusiness.state}` : ''}
                {activeBusiness.gst_registered ? '' : ' · not GST-registered'}
              </p>
            </div>
            <p className="text-xs text-secondary-400">Wrong business? Switch it from the header selector before continuing.</p>
          </div>
        )}

        {/* Step 2: Date range */}
        {step === 1 && (
          <div className="space-y-4 max-w-md">
            <StepTitle title="Choose the period" desc="Vouchers are selected by document date inside this window." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block mb-1 text-secondary-600 dark:text-secondary-300">From</span>
                <DatePicker value={from} onChange={(v) => { setFrom(v); paramsDirty(); }} className="w-full rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm">
                <span className="block mb-1 text-secondary-600 dark:text-secondary-300">To</span>
                <DatePicker value={to} onChange={(v) => { setTo(v); paramsDirty(); }} className="w-full rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 px-3 py-2 text-sm" />
              </label>
            </div>
            <button
              type="button"
              onClick={() => { const fy = getFiscalYear(); setFrom(toISODate(fy.start)); setTo(toISODate(fy.end)); paramsDirty(); }}
              className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              Use current financial year ({getFiscalYear().label})
            </button>
            {from > to && <p className="text-xs text-error-600 dark:text-error-400">Period end is before the start.</p>}
            <p className="text-xs text-secondary-400">Opening balances are computed as of {dayBefore(from)} (the day before the window starts).</p>
          </div>
        )}

        {/* Step 3: Data selection */}
        {step === 2 && (
          <div className="space-y-4 max-w-2xl">
            <StepTitle title="Select what ships" desc="Drafts and cancelled documents are never exported regardless of these toggles." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SELECTION_ROWS.map((r) => (
                <label key={r.key} className="flex items-start gap-2.5 rounded-lg border border-secondary-200 dark:border-secondary-700 p-3 cursor-pointer hover:border-primary-400 transition-colors">
                  <input
                    type="checkbox"
                    checked={selection[r.key]}
                    onChange={(e) => { setSelection({ ...selection, [r.key]: e.target.checked }); paramsDirty(); }}
                    className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-secondary-900 dark:text-secondary-100">{r.label}</span>
                    <span className="block text-xs text-secondary-500 dark:text-secondary-400">{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-secondary-600 dark:text-secondary-300">Format</span>
              {(['xml', 'csv'] as const).map((f) => (
                <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="tally-format" checked={format === f} onChange={() => setFormat(f)} className="h-4 w-4 border-secondary-300 text-primary-600 focus:ring-primary-500" />
                  <span className="uppercase font-medium">{f}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Validate */}
        {step === 3 && (
          <div className="space-y-4">
            <StepTitle title="Pre-flight validation" desc="Document-level checks run BEFORE the bundle is built, so you see exactly what will be flagged or blocked - and why." />
            {!built && !buildError && (
              <Button onClick={runValidation} loading={building}>
                <ShieldCheck className="h-4 w-4" /> Run validation
              </Button>
            )}
            {buildError && (
              <ErrorState title="Could not validate" message={buildError} onRetry={runValidation} />
            )}
            {built && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {built.errorCount === 0 ? (
                    <Badge variant="success"><CheckCircle2 className="h-3 w-3 inline" /> No blocking errors</Badge>
                  ) : (
                    <Badge variant="error">{built.errorCount} blocking error(s)</Badge>
                  )}
                  <Badge variant={built.warningCount > 0 ? 'warning' : 'neutral'}>{built.warningCount} warning(s)</Badge>
                  <Badge variant="neutral">{built.voucherCount} vouchers</Badge>
                  <Badge variant="neutral">{built.ledgerCount} ledger masters</Badge>
                  {built.stockItemCount > 0 && <Badge variant="neutral">{built.stockItemCount} stock items</Badge>}
                  <Button variant="ghost" size="sm" onClick={runValidation} disabled={building} className="ml-auto">
                    <RotateCcw className="h-3.5 w-3.5" /> Re-run
                  </Button>
                </div>
                {built.issues.length === 0 ? (
                  <p className="text-sm text-success-700 dark:text-success-400">Every document passed every check.</p>
                ) : (
                  <div className="rounded-lg border border-secondary-200 dark:border-secondary-700 divide-y divide-secondary-100 dark:divide-secondary-800 max-h-72 overflow-y-auto scrollbar-thin">
                    {built.issues.map((iss, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                        {iss.severity === 'error' ? (
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                        )}
                        <span className="text-secondary-600 dark:text-secondary-300">
                          <span className="font-medium">{iss.voucherNumber}</span> — {iss.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {built.errorCount > 0 && (
                  <p className="text-xs text-error-600 dark:text-error-400">
                    Fix the blocking documents in AccountX first, then re-run validation. Warnings proceed but ride along into the export record.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 5: Export */}
        {step === 4 && (
          <div className="space-y-4">
            <StepTitle title="Generate and download" desc={`${format.toUpperCase()} file for ${from} → ${to}, named for direct Tally import.`} />
            {(!built || built.errorCount > 0) ? (
              <p className="text-sm text-secondary-500 dark:text-secondary-400">Go back one step and pass validation first.</p>
            ) : (
              <Button onClick={doExport} loading={exporting}>
                <Download className="h-4 w-4" /> Generate &amp; download {format.toUpperCase()}
              </Button>
            )}
          </div>
        )}

        {/* Step 6: Download / done */}
        {step === 5 && (
          <div className="space-y-4 max-w-xl">
            <StepTitle title="Done" desc="The file downloaded and this run was recorded in export history." />
            {exportedFile && (
              <p className="text-sm text-secondary-600 dark:text-secondary-300">
                Saved as <code className="rounded bg-secondary-100 dark:bg-secondary-800 px-1.5 py-0.5 figure text-xs">{exportedFile}</code>
              </p>
            )}
            {historyNote && (
              <p className="text-xs text-warning-600 dark:text-warning-400">
                File downloaded, but the history write failed: {historyNote}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setStep(3); paramsDirty(); }}>
                <RotateCcw className="h-4 w-4" /> Regenerate &amp; re-download
              </Button>
              <Link to="/app/tally/history">
                <Button variant="secondary">
                  <History className="h-4 w-4" /> Open export history
                </Button>
              </Link>
              <Button variant="ghost" onClick={() => { setStep(0); paramsDirty(); }}>
                Start another export
              </Button>
            </div>
            <p className="text-xs text-secondary-400 print:hidden">
              Re-downloads regenerate from LIVE data for the stored parameters - identical unless your books changed in between.
            </p>
          </div>
        )}
      </section>

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < 3 && (
          <Button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} disabled={step === 1 && from > to}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {step === 3 && built && built.errorCount === 0 && (
          <Button onClick={() => setStep(4)}>
            Continue to export <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="text-xs text-secondary-400 print:hidden">
        <FileCode2 className="h-3 w-3 inline mr-1" />
        The classic single-panel exporter remains available in Settings → Data &amp; Backups until the integration swap.
      </p>
    </div>
  );
}

function StepTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="font-bold text-secondary-900 dark:text-secondary-100">{title}</h2>
      <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-0.5">{desc}</p>
    </div>
  );
}
