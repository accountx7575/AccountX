import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { backdropFade, modalPop, panelTransition } from '@/lib/motion';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const containerRef = useDialogA11y(open, onClose);
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
            className={cn('relative w-full bg-white dark:bg-secondary-900 rounded-xl shadow-card-hover border border-secondary-200/80 dark:border-secondary-800 max-h-[90vh] flex flex-col outline-none', sizeClasses[size])}
            {...(reduce ? {} : modalPop)}
            transition={panelTransition}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200 dark:border-secondary-800">
                <h2 id={titleId} className="text-lg font-semibold text-secondary-900 dark:text-secondary-100">{title}</h2>
                <button onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-200 hover:bg-secondary-100 dark:hover:bg-secondary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
            <div className="overflow-y-auto scrollbar-thin px-6 py-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
