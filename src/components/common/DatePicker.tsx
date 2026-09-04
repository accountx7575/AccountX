import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type DatePickerProps = {
  /** ISO date string (yyyy-mm-dd) or '' — internal payload format stays ISO. */
  value?: string;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  clearable?: boolean;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoToDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function displayToIso(display: string): string | null {
  const m = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime()) || d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1) return null;
  return iso;
}

function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Custom date picker rendering strictly DD/MM/YYYY while keeping the
 * internal/payload format ISO (yyyy-mm-dd). Replaces native <input type=date>
 * whose visible format is browser-locale dependent.
 */
export function DatePicker({ value = '', onChange, className, placeholder = 'DD/MM/YYYY', disabled, min, max, clearable = true }: DatePickerProps) {
  const [display, setDisplay] = useState(() => isoToDisplay(value));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00`) : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplay(isoToDisplay(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const commit = (iso: string) => {
    setDisplay(isoToDisplay(iso));
    onChange(iso);
  };

  const handleType = (raw: string) => {
    const masked = maskInput(raw);
    setDisplay(masked);
    if (masked.length === 10) {
      const iso = displayToIso(masked);
      if (iso && (!min || iso >= min) && (!max || iso <= max)) {
        onChange(iso);
        const d = new Date(`${iso}T00:00:00`);
        setView({ y: d.getFullYear(), m: d.getMonth() });
      }
    }
  };

  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: startDow }, () => null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${view.y}-${pad(view.m + 1)}-${pad(d)}`);
    return cells;
  }, [view]);

  const todayIso = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  })();

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={display}
          placeholder={placeholder}
          onChange={(e) => handleType(e.target.value)}
          onFocus={() => {
            if (value) {
              const d = new Date(`${value}T00:00:00`);
              if (!isNaN(d.getTime())) setView({ y: d.getFullYear(), m: d.getMonth() });
            }
            setOpen(true);
          }}
          onBlur={() => {
            // Revert incomplete/invalid masks to the last committed ISO value.
            if (display.length > 0 && displayToIso(display) === null) setDisplay(isoToDisplay(value));
          }}
          className={cn(className || 'input', 'pr-16')}
          aria-label={placeholder}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {clearable && !disabled && value && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { onChange(''); setDisplay(''); }}
              className="p-0.5 rounded text-secondary-300 hover:text-secondary-500 dark:hover:text-secondary-300 transition-colors"
              title="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className="p-0.5 rounded text-secondary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            title="Open calendar"
          >
            <Calendar className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 card-solid p-2 shadow-lg">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <button type="button" onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 }))} className="p-1 rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">{MONTHS[view.m]} {view.y}</p>
            <button type="button" onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 }))} className="p-1 rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DOW.map((d) => (
              <span key={d} className="text-[10px] font-semibold uppercase text-secondary-400 text-center py-0.5">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((iso, i) =>
              iso === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={iso}
                  type="button"
                  disabled={!inRange(iso)}
                  onClick={() => { commit(iso); setOpen(false); }}
                  className={cn(
                    'h-7 rounded-md text-xs tabular-nums transition-colors',
                    iso === value
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300 text-secondary-700 dark:text-secondary-300',
                    !inRange(iso) && 'opacity-30 cursor-not-allowed'
                  )}
                >
                  {Number(iso.slice(8))}
                </button>
              )
            )}
          </div>
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-secondary-200 dark:border-secondary-700 px-1">
            <button
              type="button"
              onClick={() => { if (inRange(todayIso)) { commit(todayIso); setOpen(false); } }}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              Today
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-secondary-500 hover:underline">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

DatePicker.displayName = 'DatePicker';
