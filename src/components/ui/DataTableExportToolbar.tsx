import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileDown,
  FileSpreadsheet,
  FileText,
  Printer,
  SlidersHorizontal,
} from 'lucide-react';

/* ============================================================================
 * DataTableExportToolbar — DataTables-style export + column-visibility toolbar.
 * Exports honor the CURRENT filtered rows + visible columns only. Visibility
 * persists per storageKey in localStorage. No new npm packages: Excel via
 * .xls HTML-table Blob, PDF via installed pdfmake (lazy), CSV via BOM+Blob,
 * Copy via clipboard TSV, Print via clean print window.
 * ==========================================================================*/

export interface ExportColumnDef<T> {
  key: string;
  label: string;
  getText: (row: T) => string;
}

interface DataTableExportToolbarProps<T> {
  columns: ExportColumnDef<T>[];
  rows: T[];
  filename: string;
  title: string;
  storageKey: string;
}

function readHidden(storageKey: string, keys: string[]): string[] {
  try {
    const raw = localStorage.getItem(`ax-cols:${storageKey}`);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === 'string' && keys.includes(k)) : [];
  } catch {
    return [];
  }
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const htmlCell = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface PdfMakeApi {
  vfs: unknown;
  createPdf: (doc: unknown) => { download: (name?: string) => void };
}

let cachedPdfMake: PdfMakeApi | null = null;

/** Lazy-load pdfmake + Roboto vfs (UMD builds, resolved via dynamic import). */
async function loadPdfMake(): Promise<PdfMakeApi> {
  if (cachedPdfMake) return cachedPdfMake;
  const [makeMod, vfsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const api =
    (makeMod as unknown as { default?: PdfMakeApi }).default ??
    (makeMod as unknown as PdfMakeApi);
  const vfs =
    (vfsMod as unknown as { default?: Record<string, string> }).default ??
    (vfsMod as unknown as Record<string, string>);
  api.vfs = vfs;
  cachedPdfMake = api;
  return api;
}

const BTN =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:bg-secondary-50 dark:hover:bg-secondary-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function DataTableExportToolbar<T>(props: DataTableExportToolbarProps<T>): JSX.Element {
  const { columns, rows, filename, title, storageKey } = props;
  const [hidden, setHidden] = useState<string[]>(() => readHidden(storageKey, columns.map((c) => c.key)));
  const [colOpen, setColOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setColOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const visible = useMemo(() => columns.filter((c) => !hidden.includes(c.key)), [columns, hidden]);

  const toggle = (key: string): void => {
    setHidden((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      // Keep at least one column visible
      const ensured = next.length >= columns.length ? prev : next;
      try {
        localStorage.setItem(`ax-cols:${storageKey}`, JSON.stringify(ensured));
      } catch {
        /* storage unavailable — visibility just won't persist */
      }
      return ensured;
    });
  };

  const matrix = (): string[][] => [
    visible.map((c) => c.label),
    ...rows.map((r) => visible.map((c) => c.getText(r))),
  ];

  const doCopy = async (): Promise<void> => {
    const tsv = matrix()
      .map((r) => r.join('\t'))
      .join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const doExcel = (): void => {
    const m = matrix();
    const html =
      '<html><head><meta charset="UTF-8"></head><body><table>' +
      `<thead><tr>${m[0].map((h) => `<th>${htmlCell(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${m
        .slice(1)
        .map((r) => `<tr>${r.map((c) => `<td>${htmlCell(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></body></html>`;
    downloadBlob(new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' }), `${filename}.xls`);
  };

  const doCsv = (): void => {
    const csv = matrix()
      .map((r) => r.map(csvCell).join(','))
      .join('\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
  };

  const doPdf = async (): Promise<void> => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const pdfMake = await loadPdfMake();
      const body = matrix();
      pdfMake
        .createPdf({
          pageOrientation: 'landscape',
          content: [
            { text: title, style: 'title' },
            { text: `${new Date().toLocaleString()} • ${rows.length} row(s)`, style: 'sub' },
            {
              table: { headerRows: 1, widths: visible.map(() => '*'), body },
              layout: 'lightHorizontalLines',
            },
          ],
          styles: {
            title: { fontSize: 14, bold: true, margin: [0, 0, 0, 4] },
            sub: { fontSize: 8, color: '#666666', margin: [0, 0, 0, 8] },
          },
          defaultStyle: { fontSize: 8 },
        })
        .download(`${filename}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  };

  const doPrint = (): void => {
    const m = matrix();
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(
      '<!doctype html><html><head><title>' +
        htmlCell(title) +
        '</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h2{margin:0 0 4px}p.sub{color:#666;font-size:12px;margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f3f4f6}</style></head><body>' +
        `<h2>${htmlCell(title)}</h2>` +
        `<p class="sub">${htmlCell(new Date().toLocaleString())} • ${rows.length} row(s)</p>` +
        `<table><thead><tr>${m[0].map((h) => `<th>${htmlCell(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${m
          .slice(1)
          .map((r) => `<tr>${r.map((c) => `<td>${htmlCell(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>` +
        '<script>window.onload=function(){window.print()}<\/script></body></html>'
    );
    w.document.close();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={BTN} onClick={doCopy} title="Copy table (visible columns)">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button type="button" className={BTN} onClick={doExcel} title="Download Excel (.xls, visible columns)">
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </button>
      <button type="button" className={BTN} onClick={doPdf} disabled={pdfBusy} title="Download PDF (visible columns)">
        <FileText className="h-3.5 w-3.5" /> {pdfBusy ? 'PDF…' : 'PDF'}
      </button>
      <button type="button" className={BTN} onClick={doPrint} title="Print table (visible columns)">
        <Printer className="h-3.5 w-3.5" /> Print
      </button>
      <button type="button" className={BTN} onClick={doCsv} title="Download CSV (visible columns)">
        <FileDown className="h-3.5 w-3.5" /> CSV
      </button>
      <div className="relative" ref={panelRef}>
        <button
          type="button"
          className={BTN + (colOpen ? ' bg-secondary-100 dark:bg-secondary-800' : '')}
          onClick={() => setColOpen((o) => !o)}
          title="Show / hide columns"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Columns
        </button>
        {colOpen && (
          <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-900 shadow-xl p-1 max-h-64 overflow-y-auto">
            {columns.map((c) => {
              const isHidden = hidden.includes(c.key);
              const lastVisible = visible.length === 1 && !isHidden;
              return (
                <label
                  key={c.key}
                  className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800 cursor-pointer text-secondary-700 dark:text-secondary-200"
                >
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    disabled={lastVisible}
                    onChange={() => toggle(c.key)}
                    className="accent-primary-600"
                  />
                  <span>{c.label}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
