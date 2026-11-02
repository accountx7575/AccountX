// Shared AI assistant types — Sprint A1 contract, frozen by god.
// Backend source of truth: supabase/functions/ai-assistant/index.ts
// FE consumers must build strictly against these shapes.

export type AiSourceKind = "rpc" | "view" | "table";

export interface AiSource {
  kind: AiSourceKind;
  name: string;
}

export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "UPSTREAM_ERROR";

/** HTTP mapping: 200 ok | 401 bad token | 403 not a member | 400 malformed body | 503 unconfigured | 502 upstream. */
export interface AiKeyFigure {
  label: string;
  value: string;
  delta?: { pct: number; dir: 'up' | 'down' | 'flat' } | null;
  countLine?: string | null;
  actionLabel?: string;
  actionTo?: string;
  periodLabel?: string;
}

export interface AiSuccessResponse {
  ok: true;
  answer: string;
  sources: AiSource[];
  provider: string;
  model: string;
  period?: string;
  keyFigures?: AiKeyFigure[];
}

export interface AiErrorResponse {
  ok: false;
  code: AiErrorCode;
  message: string;
}

export type AiResponse = AiSuccessResponse | AiErrorResponse;

export interface AiAskRequest {
  businessId: string;
  question: string;
}

/**
 * Compact trusted-surface snapshot returned by RPC
 * get_ai_business_snapshot(p_business_id uuid) -> jsonb (migration 045).
 * Free-text fields are DB-truncated; notes/terms are never included.
 */
export interface AiBusinessSnapshot {
  generated_at: string;
  business_id: string;
  kpis: {
    business_id: string;
    sales_total: number;
    sales_count: number;
    purchases_total: number;
    purchases_count: number;
    expenses_total: number;
    receivables_outstanding: number;
    receivables_overdue: number;
    payables_outstanding: number;
    payables_overdue: number;
    cash_in_hand: number;
    bank_balance: number;
    collections_today: number;
    payouts_today: number;
  } | null;
  receivables_top: Array<{
    doc_number: string;
    party_name: string;
    doc_date: string;
    due_date: string | null;
    outstanding: number;
    days_overdue: number;
  }>;
  payables_top: Array<{
    doc_number: string;
    party_name: string;
    doc_date: string;
    due_date: string | null;
    outstanding: number;
    days_overdue: number;
  }>;
  low_stock: Array<{ name: string; stock: number; min_stock: number }>;
  sales_monthly: Array<{ month: string; total: number; invoices: number }>;
  purchases_monthly: Array<{ month: string; total: number; bills: number }>;
  cash_position: {
    total: number;
    accounts: Array<{ name: string; balance: number }>;
  };
}
