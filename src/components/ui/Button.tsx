import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm hover:shadow-lg hover:shadow-indigo-500/30 hover:brightness-[1.06] active:brightness-95 active:scale-[0.98]',
  secondary: 'bg-white text-secondary-700 border border-secondary-300/80 shadow-[0_1px_2px_rgba(24,24,27,0.04)] hover:bg-secondary-50 hover:border-secondary-400/60 dark:bg-secondary-800 dark:text-zinc-100 dark:border-secondary-700 dark:hover:bg-secondary-700 active:scale-[0.98]',
  ghost: 'text-secondary-600 hover:bg-secondary-100 dark:text-secondary-300 dark:hover:bg-secondary-800',
  danger: 'bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-sm hover:shadow-lg hover:shadow-rose-500/30 hover:brightness-[1.06] active:brightness-95 active:scale-[0.98]',
};

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-secondary-950 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
