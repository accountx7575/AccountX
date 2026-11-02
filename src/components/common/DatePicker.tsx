import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Select } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

export type DatePickerProps = {
  /** ISO date string (yyyy-mm-dd) or '' — internal payload format stays ISO. */
  value?: string;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  min?: string;
  max?: string;
  clearable?: boolean;
  id?: string;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

const currentYear = new Date().getFullYear();
const MIN_YEAR_DISPLAY = Math.max(MIN_YEAR, currentYear - 25);
const MAX_YEAR_DISPLAY = Math.min(MAX_YEAR, currentYear + 15);
const YEARS = Array.from(
  { length: MAX_YEAR_DISPLAY - MIN_YEAR_DISPLAY + 1 },
  (_, i) => MIN_YEAR_DISPLAY + i
);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoToDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function displayToIso(display: string, minIso?: string, maxIso?: string): string | null {
  const m = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== month - 1) return null;
  if (minIso && iso < minIso) return null;
  if (maxIso && iso > maxIso) return null;
  return iso;
}

export function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length === 0) return '';
  if (digits.length <= 2) {
    let d = parseInt(digits, 10);
    if (digits.length === 2 && d > 31) d = 31;
    if (digits.length === 2 && d === 0) d = 1;
    return digits.length === 2 ? pad(d) : digits;
  }
  if (digits.length <= 4) {
    let d = parseInt(digits.slice(0, 2), 10);
    if (d > 31) d = 31;
    if (d === 0) d = 1;
    const mStr = digits.slice(2);
    if (mStr.length === 2) {
      let m = parseInt(mStr, 10);
      if (m > 12) m = 12;
      if (m === 0) m = 1;
      return `${pad(d)}/${pad(m)}`;
    }
    return `${pad(d)}/${mStr}`;
  }
  let d = parseInt(digits.slice(0, 2), 10);
  if (d > 31) d = 31;
  if (d === 0) d = 1;
  let m = parseInt(digits.slice(2, 4), 10);
  if (m > 12) m = 12;
  if (m === 0) m = 1;
  const yStr = digits.slice(4);
  if (yStr.length === 4) {
    let y = parseInt(yStr, 10);
    if (y > MAX_YEAR) y = MAX_YEAR;
    if (y < MIN_YEAR) y = MIN_YEAR;
    return `${pad(d)}/${pad(m)}/${y}`;
  }
  return `${pad(d)}/${pad(m)}/${yStr}`;
}

/**
 * Custom date picker rendering strictly DD/MM/YYYY while keeping the
 * internal/payload format ISO (yyyy-mm-dd).
 * Enforces strict date format & bounds (2000-2099) to prevent invalid years.
 */
export function DatePicker({
  value = '',
  onChange,
  className,
  placeholder = 'DD/MM/YYYY',
  disabled,
  readOnly,
  min,
  max,
  clearable = true,
  id,
}: DatePickerProps) {
  const [display, setDisplay] = useState(() => isoToDisplay(value));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00`) : new Date();
    const y = !isNaN(base.getTime()) && base.getFullYear() >= MIN_YEAR && base.getFullYear() <= MAX_YEAR
      ? base.getFullYear()
      : Math.max(MIN_YEAR, Math.min(MAX_YEAR, new Date().getFullYear()));
    const m = !isNaN(base.getTime()) ? base.getMonth() : new Date().getMonth();
    return { y, m };
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
    if (readOnly) return;
    const masked = maskInput(raw);
    setDisplay(masked);
    if (masked.length === 10) {
      const iso = displayToIso(masked, min, max);
      if (iso) {
        onChange(iso);
        const d = new Date(`${iso}T00:00:00`);
        const yClamped = Math.max(MIN_YEAR, Math.min(MAX_YEAR, d.getFullYear()));
        setView({ y: yClamped, m: d.getMonth() });
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

  const handlePrevMonth = () => {
    setView((v) => {
      if (v.m === 0) {
        if (v.y <= MIN_YEAR) return v;
        return { y: v.y - 1, m: 11 };
      }
      return { ...v, m: v.m - 1 };
    });
  };

  const handleNextMonth = () => {
    setView((v) => {
      if (v.m === 11) {
        if (v.y >= MAX_YEAR) return v;
        return { y: v.y + 1, m: 0 };
      }
      return { ...v, m: v.m + 1 };
    });
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode={readOnly ? 'none' : 'numeric'}
          autoComplete="off"
          disabled={disabled}
          readOnly={readOnly}
          value={display}
          placeholder={placeholder}
          onChange={(e) => handleType(e.target.value)}
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) {
              if (value) {
                const d = new Date(`${value}T00:00:00`);
                if (!isNaN(d.getTime())) {
                  const yClamped = Math.max(MIN_YEAR, Math.min(MAX_YEAR, d.getFullYear()));
                  setView({ y: yClamped, m: d.getMonth() });
                }
              }
              setOpen(true);
            }
          }}
          onBlur={() => {
            if (display.length === 0) {
              if (clearable) {
                onChange('');
                setDisplay('');
              } else {
                setDisplay(isoToDisplay(value));
              }
              return;
            }
            const iso = displayToIso(display, min, max);
            if (!iso) {
              setDisplay(isoToDisplay(value));
            }
          }}
          className={cn(
            'input font-normal text-slate-800 dark:text-slate-100 pr-16',
            readOnly && 'cursor-pointer select-none',
            className
          )}
          aria-label={placeholder}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {clearable && !disabled && value && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { onChange(''); setDisplay(''); }}
              className="p-0.5 rounded text-secondary-500 dark:text-secondary-300 hover:text-secondary-600 dark:hover:text-secondary-200 transition-colors"
              title="Clear" aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className="p-0.5 rounded text-secondary-500 dark:text-secondary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            title="Open calendar" aria-label="Open calendar"
          >
            <Calendar className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 card-solid p-2 shadow-lg">
          <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
            <button
              type="button"
              disabled={view.y <= MIN_YEAR && view.m === 0}
              onClick={handlePrevMonth}
              className={cn(
                'p-1 rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors',
                view.y <= MIN_YEAR && view.m === 0 && 'opacity-30 cursor-not-allowed hover:bg-transparent'
              )}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1 shrink-0">
              <Select
                value={MONTHS[view.m]}
                onChange={(e) =>
                  setView((v) => ({ ...v, m: MONTHS.indexOf(e.target.value) }))
                }
                className="text-xs font-semibold text-slate-700 bg-transparent border-none focus:ring-1 focus:ring-emerald-500 rounded px-1 py-0.5 cursor-pointer hover:bg-slate-100 w-auto shrink-0"
              >
                {MONTHS.map((month, i) => (
                  <option key={i} value={month}>
                    {month}
                  </option>
                ))}
              </Select>
              <Select
                value={String(view.y)}
                onChange={(e) =>
                  setView((v) => ({ ...v, y: Number(e.target.value) }))
                }
                className="text-xs font-semibold text-slate-700 bg-transparent border-none focus:ring-1 focus:ring-emerald-500 rounded px-1 py-0.5 cursor-pointer hover:bg-slate-100 w-auto shrink-0"
              >
                {YEARS.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              disabled={view.y >= MAX_YEAR && view.m === 11}
              onClick={handleNextMonth}
              className={cn(
                'p-1 rounded-md hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors',
                view.y >= MAX_YEAR && view.m === 11 && 'opacity-30 cursor-not-allowed hover:bg-transparent'
              )}
              aria-label="Next month"
            >
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
