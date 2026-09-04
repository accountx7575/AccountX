import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowLeftRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select, Textarea } from '@/components/ui/Input';
import { DatePicker } from '@/components/common/DatePicker';
import { formatCurrency } from '@/lib/utils';

/* ============================================================================
 * Transfer-between-accounts modal (T110) over Oscar's transfer_funds RPC
 * (059): Contra journal both sides of a Cash & Bank move. Server guards
 * amount>0 / source<>destination / group membership; client pre-checks the
 * same for fast feedback and surfaces RAISE messages VERBATIM. No optimistic
 * UI - the list refetches from ledger truth on success.
 * ==========================================================================*/

export interface CashBankAccount {
  id: string;
  name: string;
  current_balance: number;
}

interface TransferFundsModalProps {
  open: boolean;
  onClose: () => void;
  accounts: CashBankAccount[];
  businessId: string;
  currencySymbol?: string;
  onTransferred: (entryNumber: string) => void;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TransferFundsModal({ open, onClose, accounts, businessId, currencySymbol, onTransferred }: TransferFundsModalProps) {
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');

  // Fresh pickers each open; never carry a stale pair across opens.
  useEffect(() => {
    if (open) {
      setSourceId(accounts[0]?.id ?? '');
      setDestId(accounts[1]?.id ?? '');
      setAmount('');
      setDate(todayIso());
      setNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amt = Number(amount);
  const samePair = sourceId !== '' && sourceId === destId;
  const canSubmit = !!sourceId && !!destId && !samePair && Number.isFinite(amt) && amt > 0 && !!date;

  const transfer = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('transfer_funds', {
        p_business_id: businessId,
        p_source_account_id: sourceId,
        p_destination_account_id: destId,
        p_amount: amt,
        p_date: date,
        p_notes: notes.trim() || null,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as Array<{ journal_entry_id: string; entry_number: string }>;
      return rows[0]?.entry_number ?? '';
    },
    onSuccess: async (entryNumber) => {
      await qc.invalidateQueries({ queryKey: ['cash-bank-movements'] });
      onTransferred(entryNumber);
      onClose();
    },
    // RAISE messages surface verbatim via err.message - no rewriting.
  });

  const source = accounts.find((a) => a.id === sourceId);
  const dest = accounts.find((a) => a.id === destId);

  return (
    <Modal open={open} onClose={onClose} title="Transfer between accounts" size="md">
      <div className="space-y-4">
        <p className="text-xs text-secondary-500 dark:text-secondary-400">
          Posts a Contra journal entry moving funds between two Cash &amp; Bank ledgers. Both balances update through posted journal lines -
          the list refreshes from ledger truth on success.
        </p>

        <FormField label="From account" required>
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="" disabled>
              Select source...
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {formatCurrency(a.current_balance, currencySymbol)}
              </option>
            ))}
          </Select>
        </FormField>

        <div className="flex justify-center" aria-hidden="true">
          <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 p-2 text-secondary-500 dark:text-secondary-400">
            <ArrowLeftRight className="h-4 w-4 rotate-90" />
          </span>
        </div>

        <FormField label="To account" required>
          <Select value={destId} onChange={(e) => setDestId(e.target.value)}>
            <option value="" disabled>
              Select destination...
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === sourceId}>
                {a.name} — {formatCurrency(a.current_balance, currencySymbol)}
              </option>
            ))}
          </Select>
        </FormField>
        {samePair && <p className="text-xs text-error-600 dark:text-error-400">Source and destination must be different accounts.</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Amount" required error={amount !== '' && (!Number.isFinite(amt) || amt <= 0) ? 'Enter an amount greater than zero' : undefined}>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Date">
            <DatePicker value={date} onChange={(iso) => setDate(iso)} />
          </FormField>
        </div>

        <FormField label="Note">
          <Textarea value={notes} rows={2} placeholder="Optional reference..." onChange={(e) => setNotes(e.target.value)} />
        </FormField>

        {source && dest && !samePair && (
          <p className="text-xs figure text-secondary-500 dark:text-secondary-400 flex items-center justify-center gap-2">
            {source.name} <ArrowRight className="h-3 w-3" /> {dest.name}: {formatCurrency(Math.abs(Number(amount) || 0), currencySymbol)}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-secondary-200/80 dark:border-secondary-800">
          <Button variant="secondary" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </Button>
          <Button onClick={() => transfer.mutate()} loading={transfer.isPending} disabled={!canSubmit}>
            <ArrowLeftRight className="h-4 w-4" /> Transfer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
