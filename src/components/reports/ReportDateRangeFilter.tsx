import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/common/DatePicker';
import { resolvePreset, type RangePreset, type DateRange, getFiscalYear } from '@/lib/reportsAdapter';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'this-month', label: 'This Month' },
  { id: 'last-month', label: 'Last Month' },
  { id: 'this-quarter', label: 'This Quarter' },
  { id: 'last-quarter', label: 'Last Quarter' },
  { id: 'this-fy', label: `This FY (${getFiscalYear().label})` },
  { id: 'last-fy', label: 'Last FY' },
];

type ReportDateRangeFilterProps = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
};

/**
 * Preset + custom date-range selector. Presets are computed by
 * reportsAdapter.resolvePreset (Indian FY aware: 1 Apr – 31 Mar).
 */
export function ReportDateRangeFilter({ value, onChange, className }: ReportDateRangeFilterProps) {
  const [active, setActive] = useState<RangePreset | 'custom'>('this-fy');

  return (
    <div className={cn('card p-4', className)} role="group" aria-label="Report date range">
      <div className="flex items-center gap-2 mb-3 text-secondary-500 dark:text-secondary-400">
        <CalendarRange className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">Period</span>
        <span className="ml-auto figure text-sm text-secondary-700 dark:text-secondary-300">
          {value.from} → {value.to}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => {
              setActive(p.id);
              onChange(resolvePreset(p.id));
            }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              active === p.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400 dark:hover:border-primary-600 hover:text-primary-600 dark:hover:text-primary-400'
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setActive('custom')}
          aria-expanded={active === 'custom'}
          aria-pressed={active === 'custom'}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            active === 'custom'
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400'
          )}
        >
          Custom
        </button>
      </div>
      {active === 'custom' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-secondary-100 dark:border-secondary-800">
          <div>
            <label className="label">From</label>
            <DatePicker
              value={value.from}
              max={value.to}
              onChange={(from) => onChange({ ...value, from })}
            />
          </div>
          <div>
            <label className="label">To</label>
            <DatePicker
              value={value.to}
              min={value.from}
              onChange={(to) => onChange({ ...value, to })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
