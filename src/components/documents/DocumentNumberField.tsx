import { useCallback, useEffect, useState } from 'react';
import { allocateDocumentNumber, documentNumberTaken } from '@/lib/numbering';
import type { DocumentType } from '@/lib/payloads';
import { FormField, Input } from '@/components/ui/Input';

export const DUPLICATE_DOCUMENT_NUMBER_MESSAGE =
  'Document number already exists. Please choose a unique number.';

export type DocumentNumberOptions = {
  businessId?: string | null;
  docType: DocumentType;
  table: string;
  numberColumn: string;
  /** Edit mode: the number already stored on the row. */
  initialValue?: string | null;
  /** Edit mode: this row's own id, so re-saving the same number is allowed. */
  excludeId?: string | null;
  /** Demo/proforma sandbox rows never touch real numbering. */
  enabled?: boolean;
  /** Document date — keeps FY-scoped suggestions correct. */
  date?: string;
};

/**
 * One document-number path for every create/edit form (PBS-142):
 *  - CREATE: pre-filled with the numbering service suggestion (business prefix
 *    + FY), fully editable by the user.
 *  - EDIT: seeded with the stored number.
 *  - validate() trims whitespace and blocks the save when the number is
 *    already used by another row of the same business.
 * Read-only against the numbering counters (no counter writes — the counter
 * tables are human-gated).
 */
export function useDocumentNumber({
  businessId,
  docType,
  table,
  numberColumn,
  initialValue,
  excludeId,
  enabled = true,
  date,
}: DocumentNumberOptions) {
  const [value, setValue] = useState(initialValue || '');
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!enabled || !businessId) return;
    if (initialValue) {
      setValue(initialValue);
      return;
    }
    let cancelled = false;
    setSuggesting(true);
    allocateDocumentNumber({ businessId, docType, table, numberColumn, date })
      .then((suggestion) => {
        if (!cancelled) setValue(suggestion);
      })
      .catch(() => {
        if (!cancelled) setValue('');
      })
      .finally(() => {
        if (!cancelled) setSuggesting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, docType, table, numberColumn, initialValue, enabled, date]);

  const validate = useCallback(async (): Promise<string | null> => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Document number is required');
      return null;
    }
    if (!businessId) {
      setError(null);
      return trimmed;
    }
    const taken = await documentNumberTaken({
      table,
      column: numberColumn,
      businessId,
      value: trimmed,
      excludeId: excludeId ?? undefined,
    });
    if (taken) {
      setError(DUPLICATE_DOCUMENT_NUMBER_MESSAGE);
      return null;
    }
    setError(null);
    return trimmed;
  }, [value, businessId, table, numberColumn, excludeId]);

  return { value, setValue, error, setError, validate, suggesting, trimmed: value.trim() };
}

export function DocumentNumberField({
  value,
  onChange,
  error,
  suggesting,
  label = 'Document Number',
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  suggesting?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <FormField label={label} required>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={suggesting ? 'Suggesting a number…' : 'Auto — enter to override'}
        aria-label={label}
        className={className}
      />
      {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </FormField>
  );
}
