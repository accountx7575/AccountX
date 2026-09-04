import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { backdropFade, drawerSlide, panelTransition } from '@/lib/motion';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
};

const widthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export function Drawer({ open, onClose, title, children, width = 'lg', footer }: DrawerProps) {
  const titleId = useId();
  const containerRef = useDialogA11y(open, onClose);
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
            {...(reduce ? {} : backdropFade)}
            transition={panelTransition}
          />
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            className={cn('relative ml-auto h-full w-full bg-white dark:bg-secondary-900 shadow-card-hover rounded-l-xl border-l border-secondary-200/80 dark:border-secondary-800 flex flex-col outline-none', widthClasses[width])}
            {...(reduce ? {} : drawerSlide)}
            transition={panelTransition}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200 dark:border-secondary-800 shrink-0">
                <h2 id={titleId} className="text-lg font-semibold text-secondary-900 dark:text-secondary-100">{title}</h2>
                <button onClick={onClose} aria-label="Close drawer" className="rounded-md p-1 text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-200 hover:bg-secondary-100 dark:hover:bg-secondary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">{children}</div>
            {footer && <div className="px-6 py-4 border-t border-secondary-200 dark:border-secondary-800 shrink-0">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
