import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn, getLocalNowTime } from '@/lib/utils';

export type TimePickerProps = {
  value?: string;
  onChange: (time: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Strips all alphabetical characters except 'a', 'p', 'm' (for AM/PM).
 * Restricts to valid time characters: [0-9], ':', space, 'a', 'p', 'm'.
 * Max length 8 characters (e.g. "12:00 PM").
 */
export function sanitizeTimeInput(raw: string): string {
  return raw
    .replace(/[^0-9:apmAPM\s]/g, '')
    .trimStart()
    .replace(/\s{2,}/g, ' ')
    .slice(0, 8);
}

export type ParsedTime = {
  hour: number;
  minute: number;
  meridiem: 'AM' | 'PM';
};

export function parseTime(str: string, fallbackMeridiem: 'AM' | 'PM' = 'AM'): ParsedTime | null {
  if (!str || !str.trim()) return null;
  const match = str.trim().match(/^(\d{1,2})(?::(\d{0,2}))?\s*([ap]m)?$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] !== undefined && match[2] !== '' ? parseInt(match[2], 10) : 0;
  let meridiem: 'AM' | 'PM' = fallbackMeridiem;

  if (match[3]) {
    meridiem = match[3].toUpperCase() === 'PM' ? 'PM' : 'AM';
  } else if (hour >= 12) {
    meridiem = 'PM';
  }

  if (hour > 12) {
    hour = hour <= 23 ? hour - 12 : 12;
  }
  if (hour === 0) hour = 12;

  const validMinute = Math.min(59, Math.max(0, minute));
  return { hour, minute: validMinute, meridiem };
}

export function formatTime(hour: number, minute: number, meridiem: 'AM' | 'PM'): string {
  return `${pad(hour)}:${pad(minute)} ${meridiem}`;
}

const PRESET_TIMES = ['09:00 AM', '12:00 PM', '02:00 PM', '05:00 PM'];
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = [0, 15, 30, 45];

/**
 * Standardized Time Picker component:
 * - Clean font-normal styling (no bold/semibold).
 * - Restricts input to valid digits and AM/PM only (blocks random letters like "amsdsdsdsdsds").
 * - Interactive dropdown with quick presets, hour/minute selectors, and AM/PM toggles.
 */
export function TimePicker({
  value = '',
  onChange,
  className,
  placeholder = '12:00 PM',
  disabled,
  readOnly,
  id,
  name,
  'aria-label': ariaLabel,
}: TimePickerProps) {
  const [display, setDisplay] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplay(value);
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

  const parsedCurrent = parseTime(display) || parseTime(value) || parseTime(getLocalNowTime()) || { hour: 12, minute: 0, meridiem: 'PM' };

  const commit = (formatted: string) => {
    setDisplay(formatted);
    onChange(formatted);
  };

  const handleType = (raw: string) => {
    if (readOnly) return;
    const sanitized = sanitizeTimeInput(raw);
    setDisplay(sanitized);

    // If matches complete valid format like "11:16 AM" or "11:16 pm", commit immediately
    const parsed = parseTime(sanitized, parsedCurrent.meridiem);
    if (parsed && sanitized.length >= 7) {
      onChange(sanitized);
    }
  };

  const handleBlur = () => {
    if (!display.trim()) {
      const fallback = value || getLocalNowTime();
      setDisplay(fallback);
      onChange(fallback);
      return;
    }
    const parsed = parseTime(display, parsedCurrent.meridiem);
    if (parsed) {
      const formatted = formatTime(parsed.hour, parsed.minute, parsed.meridiem);
      commit(formatted);
    } else {
      setDisplay(value || getLocalNowTime());
    }
  };

  const handleHourSelect = (h: number) => {
    const formatted = formatTime(h, parsedCurrent.minute, parsedCurrent.meridiem);
    commit(formatted);
  };

  const handleMinuteSelect = (m: number) => {
    const formatted = formatTime(parsedCurrent.hour, m, parsedCurrent.meridiem);
    commit(formatted);
  };

  const handleMeridiemSelect = (mer: 'AM' | 'PM') => {
    const formatted = formatTime(parsedCurrent.hour, parsedCurrent.minute, mer);
    commit(formatted);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          id={id}
          name={name}
          aria-label={ariaLabel || placeholder}
          autoComplete="off"
          inputMode={readOnly ? 'none' : 'text'}
          disabled={disabled}
          readOnly={readOnly}
          value={display}
          placeholder={placeholder}
          onChange={(e) => handleType(e.target.value)}
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onBlur={handleBlur}
          className={cn(
            'input font-normal text-slate-800 dark:text-slate-100 pr-10',
            readOnly && 'cursor-pointer select-none',
            className
          )}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className="p-1 rounded text-secondary-500 dark:text-secondary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            title="Open time picker"
            aria-label="Open time picker"
          >
            <Clock className="h-4 w-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 card-solid p-3 shadow-lg">
          {/* Header with Quick Presets */}
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-secondary-200 dark:border-secondary-700">
            <span className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
              {formatTime(parsedCurrent.hour, parsedCurrent.minute, parsedCurrent.meridiem)}
            </span>
            <button
              type="button"
              onClick={() => {
                const now = getLocalNowTime();
                const parsed = parseTime(now);
                if (parsed) commit(formatTime(parsed.hour, parsed.minute, parsed.meridiem));
                setOpen(false);
              }}
              className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              Current Time
            </button>
          </div>

          {/* Quick presets */}
          <div className="grid grid-cols-4 gap-1 mb-3">
            {PRESET_TIMES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  commit(preset);
                  setOpen(false);
                }}
                className={cn(
                  'text-[10px] py-1 px-1 rounded border text-center transition-colors',
                  display.toUpperCase() === preset
                    ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300 font-semibold'
                    : 'border-secondary-200 dark:border-secondary-700 hover:bg-secondary-50 dark:hover:bg-secondary-800 text-secondary-600 dark:text-secondary-300'
                )}
              >
                {preset.replace(' ', '')}
              </button>
            ))}
          </div>

          {/* Hour selection */}
          <div className="mb-2">
            <span className="text-[10px] font-semibold uppercase text-secondary-400 tracking-wider mb-1 block">
              Hour
            </span>
            <div className="grid grid-cols-6 gap-1">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleHourSelect(h)}
                  className={cn(
                    'h-6 rounded text-xs tabular-nums font-medium transition-colors',
                    parsedCurrent.hour === h
                      ? 'bg-indigo-600 text-white'
                      : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-secondary-700 dark:text-secondary-300'
                  )}
                >
                  {pad(h)}
                </button>
              ))}
            </div>
          </div>

          {/* Minute selection */}
          <div className="mb-3">
            <span className="text-[10px] font-semibold uppercase text-secondary-400 tracking-wider mb-1 block">
              Minute
            </span>
            <div className="grid grid-cols-4 gap-1">
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleMinuteSelect(m)}
                  className={cn(
                    'h-6 rounded text-xs tabular-nums font-medium transition-colors',
                    parsedCurrent.minute === m
                      ? 'bg-indigo-600 text-white'
                      : 'hover:bg-secondary-100 dark:hover:bg-secondary-800 text-secondary-700 dark:text-secondary-300'
                  )}
                >
                  :{pad(m)}
                </button>
              ))}
            </div>
          </div>

          {/* AM / PM Segmented Control & Done */}
          <div className="flex items-center justify-between pt-2 border-t border-secondary-200 dark:border-secondary-700">
            <div className="inline-flex rounded-md p-0.5 bg-secondary-100 dark:bg-secondary-800">
              <button
                type="button"
                onClick={() => handleMeridiemSelect('AM')}
                className={cn(
                  'px-2 py-0.5 text-xs font-semibold rounded transition-colors',
                  parsedCurrent.meridiem === 'AM'
                    ? 'bg-white dark:bg-secondary-700 text-primary-600 dark:text-primary-400 shadow-sm'
                    : 'text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200'
                )}
              >
                AM
              </button>
              <button
                type="button"
                onClick={() => handleMeridiemSelect('PM')}
                className={cn(
                  'px-2 py-0.5 text-xs font-semibold rounded transition-colors',
                  parsedCurrent.meridiem === 'PM'
                    ? 'bg-white dark:bg-secondary-700 text-primary-600 dark:text-primary-400 shadow-sm'
                    : 'text-secondary-500 hover:text-secondary-800 dark:hover:text-secondary-200'
                )}
              >
                PM
              </button>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-secondary-600 dark:text-secondary-400 hover:underline px-2 py-1"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

TimePicker.displayName = 'TimePicker';
