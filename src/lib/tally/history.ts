import { supabase } from '@/lib/supabase';

/**
 * Typed client for the Tally export-history + ledger-mapping RPCs
 * (migration 057, Oscar's T101 - god relay contract).
 *
 * House rules honored here:
 *  - writes go through the definer RPCs ONLY (no direct inserts into
 *    tally_export_history - RLS forbids them by design);
 *  - exact p_-prefixed named args verified against the migration;
 *  - honest throws carrying the server message verbatim.
 */

export type TallyExportStatus = 'completed' | 'partial' | 'failed';

export interface RecordTallyExportParams {
  businessId: string;
  dateFrom: string;
  dateTo: string;
  /** e.g. ['sales','purchase','receipt','payment','journal','credit_note','debit_note','opening'] */
  exportTypes: string[];
  recordCount: number;
  successCount: number;
  warningCount: number;
  errorCount: number;
  status: TallyExportStatus;
  /** jsonb payload kept sufficient for deterministic re-download */
  metadata?: Record<string, unknown>;
}

/** Record one export run. Returns the new history row id. */
export async function recordTallyExport(params: RecordTallyExportParams): Promise<string> {
  const { data, error } = await supabase.rpc('record_tally_export', {
    p_business_id: params.businessId,
    p_date_from: params.dateFrom,
    p_date_to: params.dateTo,
    p_export_types: params.exportTypes,
    p_record_count: params.recordCount,
    p_success_count: params.successCount,
    p_warning_count: params.warningCount,
    p_error_count: params.errorCount,
    p_status: params.status,
    p_metadata: params.metadata ?? null,
  });
  if (error) throw new Error(error.message || 'Tally export history write failed');
  return data as string;
}

export interface TallyExportHistoryRow {
  id: string;
  created_by: string | null;
  created_at: string;
  date_from: string;
  date_to: string;
  export_types: string[];
  record_count: number;
  success_count: number;
  warning_count: number;
  error_count: number;
  status: TallyExportStatus;
  metadata: Record<string, unknown> | null;
}

/** Newest-first export history for a business. */
export async function listTallyExports(businessId: string, limit = 100): Promise<TallyExportHistoryRow[]> {
  const { data, error } = await supabase.rpc('list_tally_exports', {
    p_business_id: businessId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message || 'Tally export history read failed');
  return (data ?? []) as unknown as TallyExportHistoryRow[];
}

/**
 * Create/update a per-business AccountX -> Tally ledger mapping.
 * UNIQUE(business_id, accountx_ledger); server trims + validates and does
 * ON CONFLICT DO UPDATE.
 */
export async function upsertTallyLedgerMapping(
  businessId: string,
  accountxLedger: string,
  tallyLedger: string,
  tallyParent?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_tally_ledger_mapping', {
    p_business_id: businessId,
    p_accountx_ledger: accountxLedger,
    p_tally_ledger: tallyLedger,
    ...(tallyParent != null ? { p_tally_parent: tallyParent } : {}),
  });
  if (error) throw new Error(error.message || 'Tally ledger mapping write failed');
  return data as string;
}

/** Remove a mapping row (absence restores canonical identity at export time). */
export async function deleteTallyLedgerMapping(
  businessId: string,
  accountxLedger: string,
): Promise<void> {
  const { error } = await supabase.rpc('delete_tally_ledger_mapping', {
    p_business_id: businessId,
    p_accountx_ledger: accountxLedger,
  });
  if (error) throw new Error(error.message || 'Tally ledger mapping delete failed');
}

export interface TallyLedgerMappingRow {
  id: string;
  accountx_ledger: string;
  tally_ledger: string;
  tally_parent: string | null;
}

/** Read mappings via the RLS select policy (members-only by design). */
export async function listTallyLedgerMappings(businessId: string): Promise<TallyLedgerMappingRow[]> {
  const { data, error } = await supabase
    .from('tally_ledger_mappings')
    .select('id, accountx_ledger, tally_ledger, tally_parent')
    .eq('business_id', businessId);
  if (error) throw new Error(error.message || 'Tally ledger mappings read failed');
  return (data ?? []) as unknown as TallyLedgerMappingRow[];
}
