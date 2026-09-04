import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

type Toast = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const styles = {
  success: 'bg-success-50 text-success-800 border-success-200 dark:bg-success-900/30 dark:text-success-200 dark:border-success-800',
  error: 'bg-error-50 text-error-800 border-error-200 dark:bg-error-900/30 dark:text-error-200 dark:border-error-800',
  warning: 'bg-warning-50 text-warning-800 border-warning-200 dark:bg-warning-900/30 dark:text-warning-200 dark:border-warning-800',
  info: 'bg-primary-50 text-primary-800 border-primary-200 dark:bg-primary-900/30 dark:text-primary-200 dark:border-primary-800',
};

const iconColors = {
  success: 'text-success-500',
  error: 'text-error-500',
  warning: 'text-warning-500',
  info: 'text-primary-500',
};

/**
 * Never surface raw database/engine errors to users. Signature-based so intentional
 * domain messages (e.g. SQL RAISE('Cannot cancel a confirmed bill')) pass through
 * untouched, while machine noise maps to safe, actionable copy.
 */
const RAW_ERROR_SIGNATURES: Array<{ test: RegExp; message: string }> = [
  { test: /row-level security|permission denied|insufficient privilege|\b42501\b|\bjwt\b|not authorized/i, message: 'You do not have permission to perform this action.' },
  { test: /could not find the function|schema cache|pgrst\d+|function not implemented|feature not supported|not configured/i, message: 'This feature is not available yet. Please try again later or ask an administrator to check the configuration.' },
  { test: /failed to fetch|networkerror|network request failed|err_network|load failed|fetch failed/i, message: 'Network error — please check your connection and try again.' },
  { test: /duplicate key|violates .*(constraint|policy)|null value in column|does not exist|invalid input syntax|invalid text representation|deadlock detected|could not serialize/i, message: 'Something went wrong while saving. Check the entered values and try again.' },
];

export function sanitizeUserFacingError(message: string): string {
  const trimmed = (message || '').trim();
  if (!trimmed) return 'Something went wrong. Please try again.';
  for (const sig of RAW_ERROR_SIGNATURES) {
    if (sig.test.test(trimmed)) {
      console.error('[app-error] raw error suppressed from UI:', trimmed);
      return sig.message;
    }
  }
  // Unstructured payloads (PostgREST JSON blobs, stack traces) are never user-facing.
  if (trimmed.startsWith('{') || trimmed.includes('at ') && /\bat .+:\d+:\d+\b/.test(trimmed)) {
    console.error('[app-error] unstructured error suppressed from UI:', trimmed);
    return 'Something went wrong. Please try again.';
  }
  return trimmed;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = crypto.randomUUID();
    const finalMessage = type === 'error' ? sanitizeUserFacingError(message) : message;
    setToasts((prev) => [...prev, { id, type, message: finalMessage }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const remove = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = icons[t.type];
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 shadow-card-hover animate-in slide-in-from-right duration-300',
                styles[t.type]
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', iconColors[t.type])} />
              <p className="text-sm flex-1 leading-snug">{t.message}</p>
              <button
                onClick={() => remove(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 -m-1 p-1 h-7 w-7 flex items-center justify-center rounded-md opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-opacity"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
