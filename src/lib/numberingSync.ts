import { supabase } from './supabase';
import { DEFAULT_PREFIXES, DOC_TYPE_PREFIX_KEY, docPrefixFor, normalizePrefix } from './docPrefixes';
import { documentNumberTaken } from './numbering';

/* ============================================================================
 * Prefix sync for existing documents.
 *
 * A document stores the number it was created with. When the business changes
 * a numbering prefix in Settings, the stored number keeps the old prefix. This
 * module rebuilds the number from the CURRENT prefix + financial year while
 * preserving the trailing sequence, then persists it back to the document table.
 *
 * Renumbering never touches document_sequences/document_numbers: the sequence is
 * always the one already on the document, so counters stay consistent (PBS-79 /
 * PBS-142 — migrations remain author-only, no service_role access here).
 * ==========================================================================*/

export type SyncableDocumentType =
  | 'sales_order'
  | 'quotation'
  | 'sales_invoice'
  | 'purchase_order'
  | 'purchase_bill';

export interface SyncDocumentConfig {
  table: string;
  numberColumn: string;
  label: string;
}

/** Table/column/label for every document type the sync button can renumber. */
export const SYNC_DOCUMENT_CONFIG: Record<SyncableDocumentType, SyncDocumentConfig> = {
  sales_order: { table: 'sales_orders', numberColumn: 'order_number', label: 'Sales Order' },
  quotation: { table: 'quotations', numberColumn: 'quotation_number', label: 'Quotation' },
  sales_invoice: { table: 'sales_invoices', numberColumn: 'invoice_number', label: 'Invoice' },
  purchase_order: { table: 'purchase_orders', numberColumn: 'po_number', label: 'Purchase Order' },
  purchase_bill: { table: 'purchase_bills', numberColumn: 'bill_number', label: 'Purchase Bill' },
};

export interface SyncDocumentNumberInput {
  docType: SyncableDocumentType;
  currentDocNumber: string;
  businessSettings?: Record<string, unknown> | null;
}

export interface SyncDocumentNumberResult {
  newDocNumber: string;
  changed: boolean;
}

/** Indian financial year (Apr–Mar) in the short `YY-YY` form, e.g. `26-27`. */
export function currentFinancialYearShort(now: Date = new Date()): string {
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Normalize a configured financial year (`2026-27` or `26-27`) to `26-27`.
 * Falls back to the financial year embedded in the current document number,
 * then to the current Indian financial year.
 */
export function financialYearShort(
  value: unknown,
  currentDocNumber = '',
  now: Date = new Date()
): string {
  const raw = typeof value === 'string' ? value.trim() : '';

  const full = /^(\d{4})-(\d{2})$/.exec(raw);
  if (full) return `${full[1].slice(2)}-${full[2]}`;

  const short = /^(\d{2})-(\d{2})$/.exec(raw);
  if (short) return `${short[1]}-${short[2]}`;

  const fromDoc = /(?:^|\/)(\d{2,4})-(\d{2})(?=\/|$)/.exec(String(currentDocNumber || ''));
  if (fromDoc) {
    const startYear = fromDoc[1].length === 4 ? fromDoc[1] : `20${fromDoc[1]}`;
    return `${startYear.slice(-2)}-${fromDoc[2]}`;
  }

  return currentFinancialYearShort(now);
}

/** Resolve the business's CURRENT prefix for a doc type (DB → local stash → default). */
export function currentDocumentPrefix(
  businessSettings: Record<string, unknown> | null | undefined,
  docType: SyncableDocumentType
): string {
  const key = DOC_TYPE_PREFIX_KEY[docType];
  const fallback = key ? DEFAULT_PREFIXES[key] : '';
  const resolved = normalizePrefix(docPrefixFor(businessSettings, docType) || fallback);
  return resolved.replace(/\/+$/, '');
}

/**
 * PURE numbering sync: replace the leading prefix (and stale financial year)
 * on a persisted document number while keeping its trailing sequence.
 *
 *   syncDocumentNumberWithCurrentPrefix({
 *     docType: 'sales_order',
 *     currentDocNumber: 'SO/26-27/1',
 *     businessSettings: { sales_order_prefix: 'SO/ABC/SE', financial_year: '2026-27' },
 *   }) // => 'SO/ABC/SE/26-27/1'
 */
export function syncDocumentNumberWithCurrentPrefix({
  docType,
  currentDocNumber,
  businessSettings,
}: SyncDocumentNumberInput): string {
  const current = String(currentDocNumber || '').trim();
  const sequenceMatch = /(\d+)\s*$/.exec(current);
  if (!sequenceMatch) {
    throw new Error(`Cannot sync "${current || 'empty number'}" — no trailing sequence number found`);
  }

  const prefix = currentDocumentPrefix(businessSettings, docType);
  if (!prefix) throw new Error('No document prefix is configured');

  const financialYear = financialYearShort(businessSettings?.financial_year, current);
  return `${prefix}/${financialYear}/${sequenceMatch[1]}`;
}

/**
 * Read fresh numbering settings (auth-context rows can be stale after a
 * Settings save), compute the synced number and persist it to the document.
 * Duplicate numbers are rejected before the update so the UNIQUE constraint is
 * never the first line of defence.
 */
export async function syncDocumentNumberInDb(params: {
  docType: SyncableDocumentType;
  docId: string;
  businessId: string;
  currentDocNumber: string;
  /** Auth-context row used only when the fresh DB row lacks a prefix/FY value. */
  fallbackSettings?: Record<string, unknown> | null;
}): Promise<SyncDocumentNumberResult> {
  const { docType, docId, businessId, currentDocNumber, fallbackSettings } = params;
  const config = SYNC_DOCUMENT_CONFIG[docType];
  if (!config) throw new Error(`Unsupported document type: ${docType}`);

  const { data: settings, error: settingsError } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .single();
  if (settingsError) throw settingsError;

  const fresh: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((settings ?? {}) as Record<string, unknown>)) {
    if (value !== null && value !== undefined && value !== '') fresh[key] = value;
  }
  const businessSettings: Record<string, unknown> = {
    ...(fallbackSettings ?? {}),
    ...fresh,
  };

  const newDocNumber = syncDocumentNumberWithCurrentPrefix({
    docType,
    currentDocNumber,
    businessSettings,
  });

  if (newDocNumber === String(currentDocNumber || '').trim()) {
    return { newDocNumber, changed: false };
  }

  const taken = await documentNumberTaken({
    table: config.table,
    column: config.numberColumn,
    businessId,
    value: newDocNumber,
    excludeId: docId,
  });
  if (taken) {
    throw new Error(`Number ${newDocNumber} is already used by another ${config.label.toLowerCase()}`);
  }

  const { error: updateError } = await supabase
    .from(config.table)
    .update({ [config.numberColumn]: newDocNumber })
    .eq('id', docId)
    .eq('business_id', businessId);
  if (updateError) throw updateError;

  return { newDocNumber, changed: true };
}

/** Which document tables are renumbered automatically when Settings saves. */
export const DRAFT_SYNC_TARGETS: ReadonlyArray<{
  docType: SyncableDocumentType;
  statuses: readonly string[];
}> = [
  { docType: 'quotation', statuses: ['draft', 'sent'] },
  { docType: 'sales_order', statuses: ['draft'] },
  { docType: 'sales_invoice', statuses: ['draft'] },
  { docType: 'purchase_order', statuses: ['draft'] },
];

export interface DraftDocumentSyncResult {
  updated: number;
  unchanged: number;
  failed: number;
  byType: Record<string, number>;
  errors: string[];
}

/**
 * Batch-sync every draft/sent document for a business after Settings saves.
 * Rebuilds `PREFIX/FY/sequence` from the latest settings and persists each row.
 * Per-row failures are collected (a bad row never aborts the whole save).
 */
export async function syncDraftDocumentNumbersInDb(params: {
  businessId: string;
  /** Form values from the save that just happened; used when a fresh DB column is missing. */
  businessSettings?: Record<string, unknown> | null;
}): Promise<DraftDocumentSyncResult> {
  const { businessId, businessSettings: fallbackSettings } = params;
  const result: DraftDocumentSyncResult = {
    updated: 0,
    unchanged: 0,
    failed: 0,
    byType: {},
    errors: [],
  };

  const { data: settings, error: settingsError } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .single();
  if (settingsError) throw settingsError;

  const fresh: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((settings ?? {}) as Record<string, unknown>)) {
    if (value !== null && value !== undefined && value !== '') fresh[key] = value;
  }
  const businessSettings: Record<string, unknown> = {
    ...(fallbackSettings ?? {}),
    ...fresh,
  };

  for (const target of DRAFT_SYNC_TARGETS) {
    const config = SYNC_DOCUMENT_CONFIG[target.docType];
    const { data: rows, error } = await supabase
      .from(config.table)
      .select(`id, ${config.numberColumn}, status`)
      .eq('business_id', businessId)
      .in('status', [...target.statuses]);
    if (error) {
      result.failed += 1;
      result.errors.push(`${config.label}: ${error.message}`);
      continue;
    }

    for (const row of (rows ?? []) as unknown as Record<string, unknown>[]) {
      const current = String(row[config.numberColumn] ?? '');
      try {
        const newDocNumber = syncDocumentNumberWithCurrentPrefix({
          docType: target.docType,
          currentDocNumber: current,
          businessSettings,
        });
        if (newDocNumber === current.trim()) {
          result.unchanged += 1;
          continue;
        }

        const taken = await documentNumberTaken({
          table: config.table,
          column: config.numberColumn,
          businessId,
          value: newDocNumber,
          excludeId: String(row.id),
        });
        if (taken) {
          result.failed += 1;
          result.errors.push(`${config.label}: ${newDocNumber} is already in use`);
          continue;
        }

        const { error: updateError } = await supabase
          .from(config.table)
          .update({ [config.numberColumn]: newDocNumber })
          .eq('id', String(row.id))
          .eq('business_id', businessId);
        if (updateError) {
          result.failed += 1;
          result.errors.push(`${config.label}: ${updateError.message}`);
          continue;
        }

        result.updated += 1;
        result.byType[target.docType] = (result.byType[target.docType] ?? 0) + 1;
      } catch (err: any) {
        result.failed += 1;
        result.errors.push(`${config.label}: ${err?.message || 'sync failed'}`);
      }
    }
  }

  return result;
}
