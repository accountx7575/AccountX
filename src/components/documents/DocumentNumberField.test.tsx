// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useDocumentNumber,
  DUPLICATE_DOCUMENT_NUMBER_MESSAGE,
} from '@/components/documents/DocumentNumberField';

const rows: any[] = [];
const selectMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: (col: string) => {
        selectMock(col);
        const chain: any = {
          eq: () => chain,
          neq: () => chain,
          then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
        };
        return chain;
      },
    }),
    rpc: async () => ({ data: 'INV/26-27/1', error: null }),
  },
}));

describe('useDocumentNumber — duplicate guard (PBS-142)', () => {
  beforeEach(() => {
    rows.length = 0;
    selectMock.mockClear();
  });

  const setup = () =>
    renderHook(() =>
      useDocumentNumber({
        businessId: 'biz-1',
        docType: 'sales_invoice',
        table: 'sales_invoices',
        numberColumn: 'invoice_number',
        enabled: false,
      })
    );

  it('accepts a free number and trims whitespace', async () => {
    const { result } = setup();
    await act(async () => {
      result.current.setValue('  INV/26-27/9  ');
    });
    let validated: string | null = null;
    await act(async () => {
      validated = await result.current.validate();
    });
    expect(validated).toBe('INV/26-27/9');
    expect(result.current.error).toBeNull();
  });

  it('blocks the save when the number is already used in this business', async () => {
    rows.push({ id: 'inv-2' });
    const { result } = setup();
    await act(async () => {
      result.current.setValue('INV/26-27/9');
    });
    let validated: string | null = 'not-run';
    await act(async () => {
      validated = await result.current.validate();
    });
    expect(validated).toBeNull();
    expect(result.current.error).toBe(DUPLICATE_DOCUMENT_NUMBER_MESSAGE);
  });

  it('requires a document number', async () => {
    const { result } = setup();
    let validated: string | null = 'not-run';
    await act(async () => {
      validated = await result.current.validate();
    });
    expect(validated).toBeNull();
    expect(result.current.error).toBe('Document number is required');
  });
});
