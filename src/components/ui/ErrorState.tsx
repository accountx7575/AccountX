import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type ErrorStateProps = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-up">
      <div className="rounded-2xl bg-gradient-to-br from-error-50 to-secondary-100 dark:from-error-900/20 dark:to-secondary-800/60 ring-1 ring-error-200/60 dark:ring-error-800/40 p-4 mb-5">
        <AlertTriangle className="h-7 w-7 text-error-500" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-secondary-900 dark:text-secondary-100 mb-1">{title}</h3>
      <p className="text-sm text-secondary-500 dark:text-secondary-400 max-w-sm mb-5 leading-relaxed">
        {message || 'Failed to load data. Check your connection and try again.'}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      )}
    </div>
  );
}
