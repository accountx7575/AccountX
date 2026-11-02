import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type TooltipProps = {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
};

/** CSS-only tooltip (group-hover, no deps). Native title kept as fallback. */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  return (
    <span
      title={label}
      className={cn('relative inline-flex group/tt', className)}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={cn(
          'tooltip-bubble group-hover/tt:opacity-100 group-hover/tt:translate-y-0 group-focus-within/tt:opacity-100 group-focus-within/tt:translate-y-0',
          side === 'bottom' && 'bottom-auto top-full mt-2 mb-0 -translate-y-1'
        )}
      >
        {label}
      </span>
    </span>
  );
}
