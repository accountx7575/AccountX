import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, PackageX } from 'lucide-react';
import { dropdownPop, dropdownTransition } from '@/lib/motion';

export type StockAlert = {
  id: string;
  name: string;
  current_stock: number;
  minimum_stock: number;
  unit: string;
};

type AlertsDropdownProps = {
  alerts: StockAlert[];
};

/**
 * Real-signal feed ONLY: every row is derived live from product stock
 * levels (current_stock <= minimum_stock). No fabricated events, no
 * read-state - the list is exactly what the data says right now.
 */
export function AlertsDropdown({ alerts }: AlertsDropdownProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="absolute top-full right-0 mt-1 w-80 card p-2 z-50 origin-top-right"
      {...(reduce ? {} : dropdownPop)}
      transition={dropdownTransition}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 mb-1">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning-500" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Alerts</h3>
          {alerts.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/15 text-[10px] font-semibold text-red-600 dark:text-red-400">
              {alerts.length}
            </span>
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="py-10 flex flex-col items-center justify-center text-center px-4">
          <div className="rounded-full bg-zinc-100 dark:bg-zinc-800 p-3 mb-3">
            <PackageX className="h-6 w-6 text-zinc-400" />
          </div>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No alerts</p>
          <p className="text-xs text-zinc-400 mt-1">Products at or below their minimum stock level will appear here.</p>
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-warning-50/60 dark:bg-warning-500/[0.07] mb-0.5">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug truncate font-semibold text-zinc-900 dark:text-zinc-100">{a.name}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Low stock: {Math.round(a.current_stock * 100) / 100} {a.unit} left (minimum {Math.round(a.minimum_stock * 100) / 100})
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
