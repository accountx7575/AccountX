import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

type FieldContextValue = {
  id: string;
  errorId?: string;
  hasError: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldControl(explicitId?: string) {
  const field = useContext(FieldContext);
  return {
    id: explicitId ?? field?.id,
    'aria-invalid': field?.hasError ? true : undefined,
    'aria-describedby': field?.errorId,
  };
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, id, ...props }, ref) => {
    const field = useFieldControl(id);
    return <input ref={ref} id={field.id} aria-invalid={field['aria-invalid']} aria-describedby={field['aria-describedby']} className={cn('input', className)} {...props} />;
  }
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, id, ...props }, ref) => {
    const field = useFieldControl(id);
    return <textarea ref={ref} id={field.id} aria-invalid={field['aria-invalid']} aria-describedby={field['aria-describedby']} className={cn('input resize-none', className)} {...props} />;
  }
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, id, ...props }, ref) => {
    const field = useFieldControl(id);
    return (
      <select ref={ref} id={field.id} aria-invalid={field['aria-invalid']} aria-describedby={field['aria-describedby']} className={cn('input cursor-pointer', className)} {...props}>
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

type FormFieldProps = {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Associates its label with the first form control rendered inside via
 * auto-generated htmlFor/id (no call-site changes needed). When `error` is
 * present, controls receive aria-invalid + aria-describedby pointing at the
 * error text.
 */
export function FormField({ label, error, required, children, className }: FormFieldProps) {
  const autoId = useId();
  const errorId = `${autoId}-error`;
  const value: FieldContextValue = { id: autoId, errorId, hasError: !!error };

  return (
    <div className={className}>
      <label htmlFor={autoId} className="label">
        {label}
        {required && <span className="text-error-500"> *</span>}
      </label>
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-error-500">
          {error}
        </p>
      )}
    </div>
  );
}
