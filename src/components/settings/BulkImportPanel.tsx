import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';

type Entity = 'customers' | 'suppliers' | 'products';

const ENTITY_LABELS: Record<Entity, string> = {
  customers: 'Customers',
  suppliers: 'Suppliers',
  products: 'Products',
};

const ENTITY_FIELDS: Record<Entity, string[]> = {
  customers: ['name*', 'company_name', 'phone', 'email', 'gstin', 'pan', 'address', 'city', 'state', 'opening_balance'],
  suppliers: ['name*', 'company_name', 'phone', 'email', 'gstin', 'pan', 'address', 'city', 'state', 'opening_balance'],
  products: ['name*', 'sku', 'type', 'hsn_sac', 'unit', 'purchase_price', 'selling_price', 'tax_rate', 'minimum_stock', 'description'],
};

type ImportRow = Record<string, string>;

type ImportError = { row: number; field: string | null; message: string };

type ImportResult = { inserted: number; errors: ImportError[] };

/** Minimal RFC-4180-ish CSV splitter: handles quoted fields, escaped quotes,
 *  CRLF and embedded newlines inside quotes. Values stay strings - the
 *  server RPC owns all casting/validation. */
export function parseCsv(text: string): { headers: string[]; rows: ImportRow[] } {
  const clean = text.replace(/^\ufeff/, '');
  const records: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cur.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      cur.push(field); field = '';
      records.push(cur); cur = [];
    } else field += ch;
  }
  if (field !== '' || cur.length > 0) { cur.push(field); records.push(cur); }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: ImportRow = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
  return { headers, rows };
}

export function BulkImportPanel({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [entity, setEntity] = useState<Entity>('customers');
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: ImportRow[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => { setPasted(''); setFileName(null); setParsed(null); setResult(null); };

  const switchEntity = (e: Entity) => { setEntity(e); reset(); };

  const doParse = (text: string) => {
    setResult(null);
    const { headers, rows } = parseCsv(text);
    setParsed({ headers, rows });
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setFileName(file.name);
    setPasted('');
    doParse(text);
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsed || parsed.rows.length === 0) throw new Error('Nothing to import — paste CSV or choose a file first');
      const rpcName =
        entity === 'customers' ? 'bulk_import_customers'
        : entity === 'suppliers' ? 'bulk_import_suppliers'
        : 'bulk_import_products';
      const { data, error } = await supabase.rpc(rpcName, {
        p_business_id: businessId,
        p_rows: parsed.rows,
      });
      if (error) throw error;
      return data as ImportResult;
    },
    onSuccess: (res) => {
      setResult(res);
      if (res.inserted > 0) {
        queryClient.invalidateQueries({ queryKey: [entity, businessId] });
        toast(`${res.inserted} ${ENTITY_LABELS[entity].toLowerCase()} imported`, 'success');
      }
    },
    onError: (err: any) => toast(err.message || 'Import failed', 'error'),
  });

  const hasNameColumn = !parsed || parsed.headers.includes('name');

  return (
    <div>
      {/* Entity picker */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(ENTITY_LABELS) as Entity[]).map((e) => (
          <button
            key={e}
            onClick={() => switchEntity(e)}
            className={
              e === entity
                ? 'px-3.5 py-1.5 rounded-full text-xs font-semibold bg-primary-600 text-white'
                : 'px-3.5 py-1.5 rounded-full text-xs font-medium border border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors'
            }
          >
            {ENTITY_LABELS[e]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Paste */}
        <div>
          <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">
            Paste CSV
          </label>
          <textarea
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); setFileName(null); doParse(e.target.value); }}
            rows={7}
            spellCheck={false}
            placeholder={`name,email,gstin\n"Sharma Traders",info@sharma.example,27ABCDE1234F1Z5\n...`}
            className="w-full rounded-xl border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Upload */}
        <div>
          <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">Or upload a .csv file</label>
          <label
            className="h-[168px] rounded-xl border border-dashed border-secondary-300 dark:border-secondary-600 bg-secondary-50/60 dark:bg-secondary-800/40 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary-400 transition-colors"
          >
            <FileUp className="h-6 w-6 text-secondary-400" />
            <span className="text-sm text-secondary-500 dark:text-secondary-400">{fileName || 'Choose file…'}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {/* Field reference */}
      <p className="text-xs text-secondary-400 mt-3">
        Columns ({ENTITY_FIELDS[entity].join(', ')}). <span className="font-medium">name</span> is required; unknown extra columns are ignored.
        {entity === 'products' && <> Opening/current stock is deliberately <span className="font-medium">not</span> imported — stock flows through stock movements to keep valuation honest.</>}
      </p>

      {/* Parsed preview */}
      {parsed && (
        <div className="mt-3 rounded-lg border border-secondary-200 dark:border-secondary-700 px-3 py-2 text-xs text-secondary-600 dark:text-secondary-300">
          {!hasNameColumn ? (
            <span className="text-error-600 dark:text-error-400 font-medium">No &quot;name&quot; column found in the header row — every row will be rejected.</span>
          ) : parsed.rows.length === 0 ? (
            <span>No data rows detected below the header.</span>
          ) : (
            <span>Parsed <span className="figure font-semibold">{parsed.rows.length}</span> data row{parsed.rows.length !== 1 ? 's' : ''} · columns: {parsed.headers.join(', ')}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => importMutation.mutate()} loading={importMutation.isPending} disabled={!parsed || parsed.rows.length === 0}>
          <Upload className="h-4 w-4" /> Import {ENTITY_LABELS[entity]}
        </Button>
        {parsed && (
          <Button variant="secondary" onClick={reset}>Clear</Button>
        )}
        <p className="text-xs text-secondary-400 ml-auto">Valid rows are imported; rejected rows are listed below — nothing silent.</p>
      </div>

      {/* Result */}
      {result && (
        <div className="mt-4 space-y-3">
          <div className={
            result.errors.length === 0
              ? 'rounded-lg border border-success-200 dark:border-success-800 bg-success-50/60 dark:bg-success-900/20 px-4 py-3 flex items-center gap-2'
              : 'rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 px-4 py-3'
          }>
            {result.errors.length === 0 && <CheckCircle2 className="h-5 w-5 text-success-600 dark:text-success-400 shrink-0" />}
            <p className="text-sm text-secondary-700 dark:text-secondary-200">
              <span className="figure font-semibold">{result.inserted}</span> of{' '}
              <span className="figure font-semibold">{result.inserted + result.errors.length}</span> rows imported
              {result.errors.length > 0 ? <> — <span className="figure font-semibold">{result.errors.length}</span> rejected (details below)</> : ' successfully.'}
            </p>
          </div>

          {result.errors.length > 0 && (
            <div className="overflow-x-auto scrollbar-thin rounded-xl border border-secondary-200 dark:border-secondary-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-700 text-secondary-500 dark:text-secondary-400 bg-secondary-50/60 dark:bg-secondary-800/40">
                    <th className="text-left px-3 py-2 font-medium">File row</th>
                    <th className="text-left px-3 py-2 font-medium">Field</th>
                    <th className="text-left px-3 py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-b border-secondary-100 dark:border-secondary-800/50 last:border-b-0">
                      <td className="px-3 py-2 tabular-nums figure text-secondary-600 dark:text-secondary-300">{e.row}</td>
                      <td className="px-3 py-2 text-secondary-600 dark:text-secondary-300">{e.field || '—'}</td>
                      <td className="px-3 py-2 text-error-600 dark:text-error-400">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-secondary-400">
            Row numbers are 0-based indexes into the data rows you submitted (header row excluded), matching the import report contract exactly.
          </p>
        </div>
      )}
    </div>
  );
}
