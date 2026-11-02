import {
  fetchGstr1Sections as _fetchGstr1Sections,
  fetchGstr3bComputed as _fetchGstr3bComputed,
  fetchGstValidationIssues as _fetchGstValidationIssues,
  fetchGstReconciliation as _fetchGstReconciliation,
} from '@/lib/gst/client';

/* ============================================================================
 * GST API seam (T103 bind phase -> T106 rider fold).
 *
 * Transport now DELEGATES to Stanley's src/lib/gst/client.ts wrappers (god
 * rider seamswap-p5: one data layer per owner). This module remains the
 * FE-facing TYPED contract: exact payload shapes mirror migrations
 * 053/054/055/056/058 verbatim, plus defensive numeric coercion for the
 * jsonb rows. Pages import from here and never change when the underlying
 * client evolves. All engines READ-ONLY; RLS governs every read.
 * ==========================================================================*/

function n(v: unknown): number {
  return Number(v) || 0;
}

/* ------------------------------ shared bits ------------------------------- */

export interface GstTaxTotals {
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

/** Row shape of v_gstr1_outward (041) as re-emitted by 053 b2b/b2c. */
export interface Gstr1OutwardRow {
  invoice_id: string;
  doc_number: string;
  doc_date: string;
  /** effectively NOT NULL - 041 builds the view via INNER JOIN customers (name NOT NULL) */
  party_name: string;
  party_gstin: string | null;
  section: 'B2B' | 'B2C';
  place_of_supply: string | null;
  tax_rate: number;
  item_count: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total_tax: number;
}

/** Row shape of v_gstr1_cdn (052 A) - doc granularity, effect not sign. */
export interface GstrCdnRow {
  doc_id: string;
  note_type: 'credit_note' | 'debit_note';
  effect: 'decreases_output' | 'increases_output';
  doc_number: string;
  doc_date: string;
  parent_doc_id: string | null;
  parent_doc_number: string | null;
  party_name: string | null;
  party_gstin: string | null;
  section: 'B2B' | 'B2C';
  reason: string | null;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total_tax: number;
}

/** Row shape of v_gstr1_nil (052 B). */
export interface GstrNilRow {
  invoice_id: string;
  doc_number: string;
  doc_date: string;
  party_name: string | null;
  party_gstin: string | null;
  section: 'B2B' | 'B2C';
  place_of_supply: string | null;
  classification: 'nil_or_exempt';
  item_count: number;
  quantity: number;
  taxable_value: number;
}

/** Row shape of v_gstr1_hsn (052 C). */
export interface GstrHsnRow {
  hsn_sac: string;
  unit: string;
  tax_rate: number;
  description: string | null;
  item_count: number;
  quantity: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface Gstr1SectionsPayload {
  basis: 'document-truth';
  period: { from: string; to: string };
  b2b: { rows: Gstr1OutwardRow[]; totals: { doc_count: number } & GstTaxTotals };
  b2c: { rows: Gstr1OutwardRow[]; totals: { doc_count: number } & GstTaxTotals };
  cdnr: {
    rows: GstrCdnRow[];
    totals: { doc_count: number; credit_notes: number; debit_notes: number } & GstTaxTotals;
  };
  nil: { rows: GstrNilRow[]; totals: { doc_count: number; taxable_value: number } };
  hsn: { rows: GstrHsnRow[]; totals: GstTaxTotals };
}

export async function getGstr1Sections(
  businessId: string,
  from: string,
  to: string
): Promise<Gstr1SectionsPayload> {
  const raw = await _fetchGstr1Sections(businessId, from, to);
  // Defensive numeric coercion on the way in (jsonb numerics arrive as numbers,
  // but hand-typed rows may carry strings); shapes stay verbatim otherwise.
  const out = raw as unknown as Gstr1SectionsPayload;
  const mapOut = (r: Gstr1OutwardRow) => ({
    ...r,
    tax_rate: n(r.tax_rate),
    item_count: n(r.item_count),
    taxable_value: n(r.taxable_value),
    cgst: n(r.cgst),
    sgst: n(r.sgst),
    igst: n(r.igst),
    cess: n(r.cess),
    total_tax: n(r.total_tax),
  });
  return {
    ...out,
    b2b: { rows: (out.b2b?.rows ?? []).map(mapOut), totals: { ...out.b2b.totals, doc_count: n(out.b2b?.totals?.doc_count) } },
    b2c: { rows: (out.b2c?.rows ?? []).map(mapOut), totals: { ...out.b2c.totals, doc_count: n(out.b2c?.totals?.doc_count) } },
    cdnr: {
      rows: (out.cdnr?.rows ?? []).map((r) => ({ ...r, taxable_value: n(r.taxable_value), cgst: n(r.cgst), sgst: n(r.sgst), igst: n(r.igst), cess: n(r.cess), total_tax: n(r.total_tax) })),
      totals: {
        doc_count: n(out.cdnr?.totals?.doc_count),
        credit_notes: n(out.cdnr?.totals?.credit_notes),
        debit_notes: n(out.cdnr?.totals?.debit_notes),
        taxable_value: n(out.cdnr?.totals?.taxable_value),
        cgst: n(out.cdnr?.totals?.cgst),
        sgst: n(out.cdnr?.totals?.sgst),
        igst: n(out.cdnr?.totals?.igst),
        cess: n(out.cdnr?.totals?.cess),
      },
    },
    nil: {
      rows: (out.nil?.rows ?? []).map((r) => ({ ...r, item_count: n(r.item_count), quantity: n(r.quantity), taxable_value: n(r.taxable_value) })),
      totals: { doc_count: n(out.nil?.totals?.doc_count), taxable_value: n(out.nil?.totals?.taxable_value) },
    },
    hsn: {
      rows: (out.hsn?.rows ?? []).map((r) => ({ ...r, tax_rate: n(r.tax_rate), item_count: n(r.item_count), quantity: n(r.quantity), taxable_value: n(r.taxable_value), cgst: n(r.cgst), sgst: n(r.sgst), igst: n(r.igst), cess: n(r.cess) })),
      totals: {
        taxable_value: n(out.hsn?.totals?.taxable_value),
        cgst: n(out.hsn?.totals?.cgst),
        sgst: n(out.hsn?.totals?.sgst),
        igst: n(out.hsn?.totals?.igst),
        cess: n(out.hsn?.totals?.cess),
      },
    },
  };
}

/* --------------------------- GSTR-3B computed (054/058) -------------------- */

export interface Gstr3bComputedPayload {
  basis: 'document-truth';
  period: { from: string; to: string };
  outward_3_1a: { taxable_value: number; cgst: number; sgst: number; igst: number; cess: number; doc_count: number };
  zero_rated: { taxable_value: number; cgst: number; sgst: number; igst: number; cess: number; doc_count: number; note: string };
  nil_other_outward: { taxable_value: number; doc_count: number; classification: string };
  cdnr_adjustment: {
    credit_notes: number;
    debit_notes: number;
    taxable_credits: number;
    taxable_additions: number;
    taxable_net_effect: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
  };
  adjusted_output: { taxable_value: number; cgst: number; sgst: number; igst: number; cess: number };
  inward_itc_4a: { taxable_value: number; cgst: number; sgst: number; igst: number; cess: number; bill_count: number };
  net_position: {
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    total_net_payable: number;
    is_credit_carried_forward: boolean;
  };
  traceability: {
    invoice_docs: number;
    bill_docs: number;
    credit_note_docs: number;
    debit_note_docs: number;
    nil_docs: number;
    zero_rated_docs?: number;
    gstr1_sections_fn: string;
  };
}

export async function getGstr3bComputed(businessId: string, from: string, to: string): Promise<Gstr3bComputedPayload> {
  return _fetchGstr3bComputed(businessId, from, to) as unknown as Promise<Gstr3bComputedPayload>;
}

/* ------------------------- Validation engine (055) ------------------------ */

export type ValidationSeverity = 'critical' | 'warning' | 'info';

export interface GstValidationIssue {
  severity: ValidationSeverity;
  doc_type: string;
  doc_id: string | null;
  doc_number: string | null;
  doc_date: string | null;
  party: string | null;
  problem: string;
  code: string;
  suggested_fix: string | null;
}

export async function getGstValidationIssues(businessId: string, from: string, to: string): Promise<GstValidationIssue[]> {
  const rows = await _fetchGstValidationIssues(businessId, from, to);
  return rows ?? [];
}

/* ----------------------- Reconciliation engine (056) ---------------------- */

export interface ReconDocRow {
  doc_type: 'sales_invoice' | 'purchase_bill';
  doc_id: string;
  doc_number: string;
  doc_date: string;
  party_name: string | null;
  direction: 'outward' | 'inward';
  doc_cgst: number;
  doc_sgst: number;
  doc_igst: number;
  doc_cess: number;
  doc_tax_total: number;
  je_cgst: number;
  je_sgst: number;
  je_igst: number;
  unmapped_residual: number;
  je_tax_total: number;
  je_count: number;
  match_status: 'matched' | 'difference' | 'unjournaled' | 'multi_posted';
}

export interface ReconciliationPayload {
  basis: 'journal-vs-document';
  period: { from: string; to: string };
  documents: ReconDocRow[];
  totals: {
    docs_checked: number;
    matched: number;
    with_difference: number;
    unjournaled: number;
    multi_posted: number;
    absolute_difference_sum: number;
    unmapped_ledger_residual_sum: number;
  };
  notes_coverage: {
    credit_notes_live: number;
    credit_note_posted_jes: number;
    debit_notes_live: number;
    debit_note_posted_jes: number;
  };
  boundary_note: string;
  read_only: boolean;
}

export async function getGstReconciliation(businessId: string, from: string, to: string): Promise<ReconciliationPayload> {
  const raw = await _fetchGstReconciliation(businessId, from, to);
  const period = (raw.period ?? {}) as { from?: string; to?: string };
  const totals = (raw.totals ?? {}) as Record<string, unknown>;
  const coverage = (raw.notes_coverage ?? {}) as Record<string, unknown>;
  const documents = (Array.isArray(raw.documents) ? raw.documents : []) as unknown as ReconDocRow[];
  return {
    basis: (raw.basis as ReconciliationPayload['basis']) ?? 'journal-vs-document',
    period: { from: period.from ?? from, to: period.to ?? to },
    documents: documents.map((r) => ({
      ...r,
      doc_cgst: n(r.doc_cgst), doc_sgst: n(r.doc_sgst), doc_igst: n(r.doc_igst), doc_cess: n(r.doc_cess),
      doc_tax_total: n(r.doc_tax_total),
      je_cgst: n(r.je_cgst), je_sgst: n(r.je_sgst), je_igst: n(r.je_igst),
      unmapped_residual: n(r.unmapped_residual), je_tax_total: n(r.je_tax_total), je_count: n(r.je_count),
    })),
    totals: {
      docs_checked: n(totals.docs_checked),
      matched: n(totals.matched),
      with_difference: n(totals.with_difference),
      unjournaled: n(totals.unjournaled),
      multi_posted: n(totals.multi_posted),
      absolute_difference_sum: n(totals.absolute_difference_sum),
      unmapped_ledger_residual_sum: n(totals.unmapped_ledger_residual_sum),
    },
    notes_coverage: {
      credit_notes_live: n(coverage.credit_notes_live),
      credit_note_posted_jes: n(coverage.credit_note_posted_jes),
      debit_notes_live: n(coverage.debit_notes_live),
      debit_note_posted_jes: n(coverage.debit_note_posted_jes),
    },
    boundary_note: String(raw.boundary_note ?? ''),
    read_only: raw.read_only === true,
  };
}

/* -------------------------- Dashboard aggregate (058) --------------------- */

export interface GstDashboardPayload {
  basis: 'document-truth';
  period: { from: string; to: string };
  output: { taxable_value: number; cgst: number; sgst: number; igst: number; cess: number; total_tax: number; doc_count: number };
  input: { taxable_value: number; cgst: number; sgst: number; igst: number; cess: number; total_tax: number; doc_count: number };
  net: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  b2b: { doc_count: number; taxable_value: number; total_tax: number };
  b2c: { doc_count: number; taxable_value: number; total_tax: number };
  credit_notes: { count: number; taxable_value: number; total_tax: number; effect: 'decreases_output' };
  debit_notes: { count: number; taxable_value: number; total_tax: number; effect: 'increases_output' };
  zero_rated_exports: { doc_count: number; taxable_value: number };
  open_validation_issues: { critical: number; warning: number; info: number; total: number };
}

export async function getGstDashboard(businessId: string, from: string, to: string): Promise<GstDashboardPayload> {
  // No client.ts wrapper yet for 058's one-call aggregate; direct rpc kept
  // here (single seam point) until Stanley adds it - same swap pattern.
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.rpc('get_gst_dashboard', {
    p_business_id: businessId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message || 'get_gst_dashboard failed');
  return data as GstDashboardPayload;
}
