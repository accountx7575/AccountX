import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';
import {
  listTallyLedgerMappings,
  upsertTallyLedgerMapping,
  deleteTallyLedgerMapping,
  type TallyLedgerMappingRow,
} from '@/lib/tally/history';

/* ============================================================================
 * /app/tally/mapping (T104). Canonical AccountX -> Tally ledger names shown
 * with their rationale (they mirror the REAL journal-writer ledger names, so
 * an import lands in the chart the books already use). Per-business overrides
 * are LIVE over migration 057 RPCs via Stanley's history.ts wrappers; absence
 * of a row = canonical identity at export time.
 * ==========================================================================*/

interface CanonicalLedger {
  accountx: string;
  rationale: string;
  group: string;
}

const CANONICAL: CanonicalLedger[] = [
  { accountx: 'Sales', rationale: 'Sales voucher line for every issued invoice', group: 'Income' },
  { accountx: 'Purchases', rationale: 'Purchase voucher line for every confirmed bill', group: 'Purchase Accounts' },
  { accountx: 'Round Off', rationale: 'Absorbs paise rounding on documents with round_off', group: 'Indirect Expenses' },
  { accountx: 'Cash', rationale: 'Cash method receipts/payments and cash opening', group: 'Cash-in-Hand' },
  { accountx: 'Bank', rationale: 'Bank-method payments/receipts and bank opening', group: 'Bank Accounts' },
  { accountx: 'Output CGST', rationale: 'Journal writer posts output CGST here (011/013a)', group: 'Duties & Taxes' },
  { accountx: 'Output SGST', rationale: 'Journal writer posts output SGST here', group: 'Duties & Taxes' },
  { accountx: 'Output IGST', rationale: 'Journal writer posts output IGST here', group: 'Duties & Taxes' },
  { accountx: 'Output Cess', rationale: 'Journal writer posts output cess here when used', group: 'Duties & Taxes' },
  { accountx: 'Input CGST', rationale: 'Input tax credit ledger for purchases (CGST)', group: 'Duties & Taxes' },
  { accountx: 'Input SGST', rationale: 'Input tax credit ledger for purchases (SGST)', group: 'Duties & Taxes' },
  { accountx: 'Input IGST', rationale: 'Input tax credit ledger for purchases (IGST)', group: 'Duties & Taxes' },
  { accountx: 'Input Cess', rationale: 'Input tax credit ledger for purchases (Cess)', group: 'Duties & Taxes' },
  { accountx: 'Opening Balance Offset', rationale: 'Balancing master for consolidated opening vouchers', group: 'Reserves & Surplus' },
];

export function TallyMappingPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const businessId = activeBusiness?.id;

  const [drafts, setDrafts] = useState<Record<string, { tally: string; parent: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TallyLedgerMappingRow | null>(null);

  const mappings = useQuery({
    queryKey: ['tally-ledger-mappings', businessId],
    queryFn: () => listTallyLedgerMappings(businessId!),
    enabled: !!businessId,
  });

  const byAccountx = new Map((mappings.data ?? []).map((m) => [m.accountx_ledger, m]));

  const save = async (accountx: string) => {
    if (!businessId) return;
    const draft = drafts[accountx];
    if (!draft || !draft.tally.trim()) {
      toast('Enter a Tally ledger name first', 'error');
      return;
    }
    setSavingKey(accountx);
    try {
      await upsertTallyLedgerMapping(businessId, accountx, draft.tally.trim(), draft.parent.trim() || null);
      await qc.invalidateQueries({ queryKey: ['tally-ledger-mappings', businessId] });
      setDrafts((d) => {
        const next = { ...d };
        delete next[accountx];
        return next;
      });
      toast(`Override saved: ${accountx} -> ${draft.tally.trim()}`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Could not save mapping', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const remove = async () => {
    if (!businessId || !confirmDelete) return;
    setSavingKey(confirmDelete.accountx_ledger);
    try {
      await deleteTallyLedgerMapping(businessId, confirmDelete.accountx_ledger);
      await qc.invalidateQueries({ queryKey: ['tally-ledger-mappings', businessId] });
      toast(`Override removed - ${confirmDelete.accountx_ledger} reverts to canonical`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Could not remove mapping', 'error');
    } finally {
      setSavingKey(null);
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tally Ledger Mapping"
        subtitle="Canonical defaults mirror the real journal-writer ledger names, so an import lands in the chart your books already use. Overrides are per-business and rare."
        meta={
          <Badge variant="info">{(mappings.data ?? []).length} override(s) active</Badge>
        }
      />

      <p className="text-sm text-secondary-500 dark:text-secondary-400 max-w-3xl">
        Leave a row unoverridden and exports emit the canonical name. Party masters (customers/suppliers) always export under their own
        names - they are data, not configuration.
      </p>

      {mappings.isError && (
        <ErrorState title="Could not load mappings" message="Something went wrong reading your saved overrides." onRetry={() => mappings.refetch()} />
      )}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['AccountX ledger', 'Rationale (canonical)', 'Group', 'Exported as', ''].map((h, i) => (
                  <th key={i} className={cn('px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700 whitespace-nowrap')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CANONICAL.map((c) => {
                const override = byAccountx.get(c.accountx);
                const draft = drafts[c.accountx];
                const effective = draft?.tally?.trim() || override?.tally_ledger || c.accountx;
                return (
                  <tr key={c.accountx} className="border-b border-secondary-100 dark:border-secondary-800 align-top">
                    <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100 whitespace-nowrap">
                      {c.accountx}
                      {override && <Badge variant="warning" className="ml-2">override</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs text-secondary-500 dark:text-secondary-400 max-w-[22rem]">{c.rationale}</td>
                    <td className="px-3 py-2 text-xs text-secondary-500 dark:text-secondary-400 whitespace-nowrap">{override?.tally_parent || c.group}</td>
                    <td className={cn('px-3 py-2 figure font-medium whitespace-nowrap', override ? 'text-warning-600 dark:text-warning-400' : 'text-secondary-900 dark:text-secondary-100')}>
                      {effective}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5 print:hidden">
                        <input
                          aria-label={`Override Tally ledger for ${c.accountx}`}
                          placeholder={c.accountx}
                          value={draft?.tally ?? ''}
                          onChange={(e) => setDrafts({ ...drafts, [c.accountx]: { tally: e.target.value, parent: draft?.parent ?? '' } })}
                          className="input h-8 w-36 rounded-lg text-xs"
                        />
                        <Tooltip label="Optional Tally parent group" side="top">
                          <input
                            aria-label={`Tally parent group for ${c.accountx}`}
                            placeholder={override?.tally_parent || c.group}
                            value={draft?.parent ?? ''}
                            onChange={(e) => setDrafts({ ...drafts, [c.accountx]: { tally: draft?.tally ?? '', parent: e.target.value } })}
                            className="input h-8 w-32 rounded-lg text-xs"
                          />
                        </Tooltip>
                        <Button size="sm" variant="secondary" loading={savingKey === c.accountx} onClick={() => save(c.accountx)} disabled={!draft}>
                          Save
                        </Button>
                        {override ? (
                          <Tooltip label="Remove override - revert to canonical" side="top">
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(override)} aria-label={`Remove override for ${c.accountx}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip label="Clears the unsaved draft" side="top">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!draft}
                              onClick={() => setDrafts((d) => {
                                const next = { ...d };
                                delete next[c.accountx];
                                return next;
                              })}
                              aria-label={`Clear draft for ${c.accountx}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        title="Remove this override?"
        message={`${confirmDelete?.accountx_ledger ?? ''} will revert to its canonical Tally name (${confirmDelete?.accountx_ledger ?? ''}) on the next export. This does not touch any past export files.`}
        confirmText="Remove"
        danger
      />
    </div>
  );
}
