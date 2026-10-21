import { supabase } from './supabase';
import { DOCUMENT_PREFIXES, type DocumentType } from './payloads';

const SUFFIX_RE = /(?:^|[/\-])(\d+)$/;
const MAX_PROBES = 25;

type AllocateOptions = {
  businessId: string;
  docType: DocumentType;
  table: string;
  numberColumn: string;
  date?: string;
};

async function numberExists(table: string, column: string, businessId: string, value: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq('business_id', businessId)
    .eq(column, value)
    .limit(1);
  if (error) throw error;
  return !!(data && data.length > 0);
}

/**
 * Document-number allocator. The DB's existing rows are the source of truth:
 * every number already present for this business in `table` is scanned, the
 * highest trailing integer wins, and the allocation is max + 1 rendered in the
 * SAME format family as that row (SO/26-27/1 -> SO/26-27/2, SO/2026/000005 ->
 * SO/2026/000006, INV-12 -> INV-13). This self-heals counters that never saw
 * seeded/restored/manual numbers. The atomic next_document_number RPC is used
 * only when the table has no numbers yet.
 */
export async function allocateDocumentNumber(opts: AllocateOptions): Promise<string> {
  const { businessId, docType, table, numberColumn, date } = opts;
  const prefix = DOCUMENT_PREFIXES[docType];

  const { data: rows, error: rowsError } = await supabase
    .from(table)
    .select(numberColumn)
    .eq('business_id', businessId)
    .or(`${numberColumn}.like.${prefix}/%,${numberColumn}.like.${prefix}-%`);
  if (rowsError) throw rowsError;

  let best: { head: string; digits: string; parsed: number } | null = null;
  for (const row of rows ?? []) {
    const raw = String((row as unknown as Record<string, unknown>)[numberColumn] ?? '');
    const match = SUFFIX_RE.exec(raw);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    if (!best || parsed > best.parsed) {
      best = { head: raw.slice(0, match.index + 1), digits: match[1], parsed };
    }
  }

  if (best) {
    const pad = best.digits.startsWith('0') ? best.digits.length : 0;
    for (let probe = 0; probe < MAX_PROBES; probe++) {
      const candidate = best.head + String(best.parsed + 1 + probe).padStart(pad, '0');
      if (!(await numberExists(table, numberColumn, businessId, candidate))) return candidate;
    }
    throw new Error(`Could not allocate a unique number — no free ${prefix} number within ${MAX_PROBES} probes of the highest used number`);
  }

  const rpcArgs = {
    p_business_id: businessId,
    p_doc_type: docType,
    ...(date ? { p_date: date } : {}),
  };
  const { data: generated, error: counterError } = await supabase.rpc('next_document_number', rpcArgs);
  if (counterError) throw counterError;
  const candidate = typeof generated === 'string' ? generated : '';
  if (!candidate) throw new Error('Numbering counter returned no value');
  return candidate;
}
