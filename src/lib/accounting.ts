import { supabase } from '@/lib/supabase';
import { roundTo2 } from '@/lib/utils';

export type JournalLineInput = {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
};

export type TrialBalanceRow = {
  account_id: string;
  account_name: string;
  group_name: string;
  code: string | null;
  opening_balance: number;
  period_debit: number;
  period_credit: number;
  closing_balance: number;
  nature: 'debit' | 'credit';
};

export type LedgerLine = {
  id: string;
  entry_id: string;
  account_id: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  created_at: string;
  entry: { date: string; narration: string | null; entry_number: string } | null;
};

export function isBalanced(lines: JournalLineInput[]): boolean {
  const totalDebit = roundTo2(lines.reduce((s, l) => s + (l.debit_amount || 0), 0));
  const totalCredit = roundTo2(lines.reduce((s, l) => s + (l.credit_amount || 0), 0));
  return totalDebit > 0 && totalDebit === totalCredit;
}

export function validateLines(lines: JournalLineInput[]): string | null {
  if (!lines.length) return 'Journal entry must have at least one line';
  for (const l of lines) {
    if (!l.account_id) return 'Every line must have an account';
    if (l.debit_amount < 0 || l.credit_amount < 0) return 'Amounts cannot be negative';
    if (l.debit_amount > 0 && l.credit_amount > 0) return 'A line cannot have both debit and credit';
    if (l.debit_amount === 0 && l.credit_amount === 0) return 'Every line must have a nonzero amount';
  }
  if (!isBalanced(lines)) return 'Total debit must equal total credit';
  return null;
}

export async function postJournalEntry(params: {
  business_id: string;
  date: string;
  narration?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  lines: JournalLineInput[];
}): Promise<{ id: string } | null> {
  const error = validateLines(params.lines);
  if (error) throw new Error(error);

  const { data, error: rpcError } = await supabase.rpc('post_journal_entry', {
    p_business_id: params.business_id,
    p_date: params.date,
    p_narration: params.narration || null,
    p_reference_type: params.reference_type || null,
    p_reference_id: params.reference_id || null,
    p_lines: params.lines.map((l) => ({
      account_id: l.account_id,
      debit_amount: roundTo2(l.debit_amount || 0),
      credit_amount: roundTo2(l.credit_amount || 0),
    })),
  });

  if (rpcError) throw rpcError;
  return data ? { id: data as string } : null;
}

export type GstBreakdown = {
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
};

export function calculateGstAmounts(
  taxableAmount: number,
  taxRate: number,
  isInterState: boolean
): GstBreakdown {
  const taxable = roundTo2(taxableAmount);
  const rate = taxRate || 0;
  if (isInterState) {
    const igst = roundTo2((taxable * rate) / 100);
    return { cgst_amount: 0, sgst_amount: 0, igst_amount: igst, total_tax: igst };
  }
  const totalTax = roundTo2((taxable * rate) / 100);
  const cgst = roundTo2(totalTax / 2);
  const sgst = roundTo2(totalTax - cgst);
  return { cgst_amount: cgst, sgst_amount: sgst, igst_amount: 0, total_tax: totalTax };
}

export async function fetchTrialBalance(
  business_id: string,
  toDate?: string
): Promise<TrialBalanceRow[]> {
  const { data, error } = await supabase.rpc('get_trial_balance', {
    p_business_id: business_id,
    p_to_date: toDate || null,
  });
  if (error) throw error;
  return (data || []) as TrialBalanceRow[];
}

export async function fetchLedgerLines(
  business_id: string,
  accountId: string,
  fromDate?: string,
  toDate?: string
): Promise<LedgerLine[]> {
  let q = supabase
    .from('journal_entry_lines')
    .select('*, entry:journal_entries(date, narration, entry_number)')
    .eq('business_id', business_id)
    .eq('account_id', accountId);

  if (fromDate) {
    q = q.gte('entry.date', fromDate);
  }
  if (toDate) {
    q = q.lte('entry.date', toDate);
  }

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as LedgerLine[];
}
