/* ============================================================================
 * Deterministic bill parser — rules and regex only, no AI, no network.
 *
 * Everything the scanner needs comes out of the extracted text:
 *   bill number, bill date, due date, supplier name, supplier GSTIN,
 *   total amount and the line items (description, qty, rate, tax %).
 *
 * The parser is defensive by design: a scanned bill is messy, so every rule
 * is a "best effort" and a miss simply leaves the field empty instead of
 * throwing.
 * ========================================================================== */

export interface ParsedBillItem {
  name: string;
  quantity: number;
  rate: number;
  taxRate: number;
  amount?: number;
}

export interface ParsedBill {
  supplierName?: string;
  supplierGstin?: string;
  billNumber?: string;
  billDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  totalAmount?: number;
  items: ParsedBillItem[];
  notes?: string;
  /** Summary tax block recovered from the bill (e.g. "GST 18% 4410.00"); used so
   *  the page can allocate it across items or surface a reconciliation note). */
  summaryTax?: ParsedBillSummaryTax;
}

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][2Z][0-9A-Z])\b/i;
const DATE_RE = /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/;

/**
 * A GSTIN is 15 characters and its 14th is always "Z". OCR reliably reads
 * that "Z" as a "2", which would drop an otherwise perfect GSTIN — so the
 * "Z" slot is repaired instead of discarding the whole number.
 */
function repairGstin(raw: string): string {
  const s = raw.toUpperCase();
  if (s.length === 15 && s[13] === '2') return `${s.slice(0, 13)}Z${s.slice(14)}`;
  return s;
}

const LABEL_WORDS = new Set([
  'date', 'total', 'amount', 'details', 'to', 'for', 'of', 'gstin', 'qty',
  'quantity', 'rate', 'no', 'number', 'value', 'tax', 'invoice', 'bill',
  'party', 'particulars', 'sr', 's', 'no.', 'doc', 'ref', 'reference', 'na',
  'nil', 'against', 'under', 'ref.', 'refno',
]);

const COMPANY_HINT_RE =
  /\b(pvt|private|ltd|limited|llp|traders|trading|enterprises|enterprise|industries|industry|distributors|associates|sons|brothers|company|co\b|store|stores|agency|works|supplies|contractors|hardware|tools|agency)\b/i;

/** Lines that are totals/labels, never line items. */
const ITEM_SKIP_RE =
  /^(total|sub[\s-]*total|grand\s*total|net\s*total|taxable\s*(value|amount)|basic\s*amount|cgst|sgst|igst|gst|tax|round\s*off|discount|amount|balance|due|hsn|hsn\/sac|s\.?\s*no|sr\.?\s*no|serial|particulars|description|qty|quantity|rate|total\s*qty|total\s*tax|total\s*items|total\s*amount|amount\s*payable|inv|invoice|bill|page|thank\s*you|signature|terms|note|notes|address|phone|email|gstin|pan|contact|ship\s*to|bill\s*to|buyer|seller|supplier|vendor|city|state|pin\s*code|pincode)/i;

const cleanNumber = (raw: string): number => {
  const n = Number.parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** dd/mm/yyyy (Indian bills) with an mm/dd fallback when the first part > 12. */
export function normalizeDate(raw: string): string | undefined {
  const m = DATE_RE.exec(raw);
  if (!m) return undefined;
  let a = Number.parseInt(m[1], 10);
  let b = Number.parseInt(m[2], 10);
  let year = Number.parseInt(m[3], 10);
  if (!a || !b) return undefined;
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (a > 12 && b <= 12) {
    // already dd/mm
  } else if (b > 12 && a <= 12) {
    const t = a; a = b; b = t;
  }
  if (a < 1 || a > 31 || b < 1 || b > 12) return undefined;
  // a = day, b = month (Indian dd/mm/yyyy)
  return `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
}

const labelValue = (line: string, labels: string[]): string | undefined => {
  for (const label of labels) {
    const re = new RegExp(
      `\\b${label}\\b\\s*(?:no\\.?|number|\\#)?\\s*[:\\-]?\\s*([A-Za-z0-9][A-Za-z0-9/\\-\\.]*)`,
      'i'
    );
    const m = re.exec(line);
    if (m) {
      const value = m[1].trim();
      if (!value) continue;
      if (LABEL_WORDS.has(value.toLowerCase())) continue;
      // skip values that are entirely a date (e.g. "05/10/2026"), not "SB/2026-27/0042"
      if (/^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(value)) continue;
      return value;
    }
  }
  return undefined;
};

const findLabeledValue = (lines: string[], labels: string[]): string | undefined => {
  for (const line of lines) {
    const value = labelValue(line, labels);
    if (value) return value;
  }
  return undefined;
};

const stripTrailingNoise = (value: string): string =>
  value.replace(/[.,;:]+$/, '').trim();

/** The company name: the line that carries the GSTIN, else the first line
 *  that looks like a company. */
function findSupplierName(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!GSTIN_RE.test(line)) continue;
    const before = line.split(/GSTIN/i)[0].trim();
    const candidate = stripTrailingNoise(before.replace(/[^A-Za-z0-9 &.,'()\-/]/g, ' ').trim());
    if (candidate && candidate.length >= 3 && /[A-Za-z]{3}/.test(candidate)) return candidate;
  }

  const head = lines.slice(0, 6);
  for (const line of head) {
    if (ITEM_SKIP_RE.test(line)) continue;
    if (GSTIN_RE.test(line)) continue;
    if (DATE_RE.test(line)) continue;
    if (!/[A-Za-z]{3}/.test(line)) continue;
    if (!COMPANY_HINT_RE.test(line)) continue;
    const candidate = stripTrailingNoise(line);
    if (candidate.length >= 3) return candidate;
  }

  for (const line of head) {
    if (ITEM_SKIP_RE.test(line)) continue;
    if (GSTIN_RE.test(line)) continue;
    if (DATE_RE.test(line)) continue;
    if (!/[A-Za-z]{3}/.test(line)) continue;
    if (line.split(/\s+/).length > 8) continue;
    return stripTrailingNoise(line);
  }
  return undefined;
}

/** Labels that mark a line as the payable total, most specific first. */
const TOTAL_LABELS: Array<{ re: RegExp; score: number }> = [
  {
    re: /(?:grand\s*total|amount\s*payable|total\s*payable|total\s*due|amount\s*due|payable\s*amount|balance\s*due|balance\s*payable)/i,
    score: 3,
  },
  { re: /(?:total\s*amount|total\s*value|\btotal\b)/i, score: 2 },
];

/**
 * A total is NEVER any of these: a subtotal is not the payable figure, and
 * picking one under-reports the bill by the whole tax amount. "sub total",
 * "subtotal" and "sub-total" are all the same word.
 */
const TOTAL_NEGATIVE_RE =
  /\b(?:sub[\s-]*total|taxable|basic\s*(?:amount|value)|net\s*amount|round\s*off|discount|tax|gst|cgst|sgst|igst|vat|words|freight|shipping|advance|paid)\b/i;

/** "Balance due" IS the payable figure, a bare "balance" is not. */
const TOTAL_NEGATIVE_BALANCE_RE = /\bbalance\b/i;
const TOTAL_POSITIVE_BALANCE_RE = /\bbalance\s*(?:due|payable)\b/i;

/**
 * Total amount: the most specific total label wins, subtotal-like lines are
 * never eligible, and among the remaining candidates the payable one is the
 * last on the page (bills print the payable total last) or the largest one
 * that can cover the item rows.
 */
function findTotalAmount(lines: string[], itemSum = 0): number | undefined {
  const candidates: Array<{ score: number; amount: number }> = [];

  for (const line of lines) {
    for (const { re, score } of TOTAL_LABELS) {
      const m = re.exec(line);
      if (!m) continue;
      const label = line.slice(0, m.index + m[0].length);
      const rest = line.slice(m.index + m[0].length);
      const raw = rest.match(/[\d,]+(?:\.\d{1,2})?/);
      if (!raw) break;
      const amount = cleanNumber(raw[0]);
      if (amount <= 0) break;
      if (TOTAL_NEGATIVE_RE.test(label)) break;
      if (TOTAL_NEGATIVE_BALANCE_RE.test(label) && !TOTAL_POSITIVE_BALANCE_RE.test(label)) break;
      candidates.push({ score, amount });
      break; // one candidate per line
    }
  }
  if (!candidates.length) return undefined;

  const best = Math.max(...candidates.map((c) => c.score));
  const top = candidates.filter((c) => c.score === best);

  // The payable total has to cover the item rows; a subtotal never does.
  const covering = itemSum > 0 ? top.filter((c) => c.amount >= itemSum - 1) : top;
  if (covering.length) {
    return covering.reduce((a, b) => (b.amount > a.amount ? b : a)).amount;
  }
  // Otherwise the last total line on the page is the payable one.
  return top[top.length - 1].amount;
}

/** A summary tax row (the bill's GST block) rather than a per-item tax. */
export interface ParsedBillSummaryTax {
  label: string;
  rate?: number;
  amount?: number;
}

/**
 * The bill's own taxable value ("Sub Total" / "Taxable Value"). This is the
 * base the tax is charged on, and it is printed as ONE clean figure, so it
 * survives an OCR slip in a line row that the imported rows do not.
 */
const TAXABLE_BASE_RE =
  /^(?:sub[\s-]*total|taxable\s*(?:value|amount)?|basic\s*amount|total\s*taxable)\b/i;

function findTaxableBase(lines: string[]): number | undefined {
  for (const line of lines) {
    const m = TAXABLE_BASE_RE.exec(line);
    if (!m) continue;
    const raw = line.slice(m[0].length).match(/[\d,]+(?:\.\d{1,2})?/);
    if (!raw) continue;
    const amount = cleanNumber(raw[0]);
    if (amount > 0) return amount;
  }
  return undefined;
}

const TAX_SUMMARY_RE =
  /^(?:total\s+)?(cgst|sgst|igst|gst|vat|tax)\b\s*[:\-]?\s*(?:(\d{1,2}(?:\.\d{1,2})?)\s*%)?\s*(?:rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)?/i;

function findSummaryTax(lines: string[]): ParsedBillSummaryTax | undefined {
  const rows: Array<{ label: string; rate?: number; amount?: number }> = [];

  for (const line of lines) {
    const m = TAX_SUMMARY_RE.exec(line);
    if (!m) continue;
    const rate = m[2] !== undefined ? cleanNumber(m[2]) : undefined;
    const amount = m[3] !== undefined ? cleanNumber(m[3]) : undefined;
    if (rate === undefined && amount === undefined) continue;
    rows.push({
      label: m[1].toUpperCase(),
      rate: rate && rate > 0 ? rate : undefined,
      amount: amount && amount > 0 ? amount : undefined,
    });
  }
  if (!rows.length) return undefined;

  // A bill usually prints the tax block as TWO rows (CGST + SGST for an
  // intra-state supply), so the tax of the bill is the SUM of those rows.
  const amount = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  // With a single row its printed rate is the total rate; with several rows
  // the printed rates are per head (CGST 9% + SGST 9% of a half base), so the
  // effective rate is derived from the amounts instead.
  const rate = rows.length === 1 ? rows[0].rate : undefined;

  return {
    label: rows.map((row) => row.label).join('+'),
    rate,
    amount: amount > 0 ? amount : undefined,
  };
}

/**
 * A bill that prints only a summary "GST 18% 4410.00" row (or a CGST/SGST
 * pair) carries no per-item rate, so every imported line would land at 0% and
 * the form total would not match the bill. The summary tax is allocated
 * across the items instead, so the imported tax is the bill's own tax and not
 * a silent zero.
 */
function allocateSummaryTax(
  items: ParsedBillItem[],
  summary: ParsedBillSummaryTax,
  taxableBase: number
): void {
  if (!items.length || taxableBase <= 0) return;
  // One tax row: the bill states the rate, so the rows take that rate.
  // Several rows (CGST + SGST): the printed rates are per head, so the
  // effective rate is the bill's tax over its taxable value.
  const rate =
    summary.rate !== undefined
      ? summary.rate
      : summary.amount !== undefined
        ? Math.round((summary.amount / taxableBase) * 10000) / 100
        : undefined;
  if (rate === undefined) return;
  for (const item of items) item.taxRate = rate;
}

/**
 * Address-ish lines. A supplier address carries numbers ("121, khasra
 * no-170, sector 9") that the numeric scanner happily reads as a quantity —
 * it must never become a bill line.
 */
const ADDRESS_RE =
  /\b(?:sector|road|street|plot|khata|khasra|ward|floor|marg|nagar|village|taluka|district|pincode|premises|complex|apartment|colony|society|tower|flat|house|block|bypass|highway|square|garden|market|mandi)\b|\bno\.?\s*[-:]?\s*\d/i;

/** Line items: description + trailing numbers (qty, rate, amount). */
function findItems(
  lines: string[],
  billNumber?: string,
  gstin?: string,
  taxableBase?: number
): ParsedBillItem[] {
  const items: ParsedBillItem[] = [];

  for (const line of lines) {
    if (items.length >= 40) break;
    if (!line || ITEM_SKIP_RE.test(line)) continue;
    if (ADDRESS_RE.test(line)) continue;
    if (gstin && line.toUpperCase().includes(gstin.toUpperCase())) continue;
    if (billNumber && line.toUpperCase().includes(billNumber.toUpperCase())) continue;
    if (DATE_RE.test(line) && line.split(/\s+/).length <= 6) continue;

    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    // Tax percentage: pull it out first, otherwise "18%" would stop the
    // trailing numeric run and the row would look like it has no numbers.
    const taxMatch = /(\d{1,2}(?:\.\d{1,2})?)\s*%/.exec(line);
    const taxRate = taxMatch ? cleanNumber(taxMatch[1]) : 0;
    const lineNoTax = line.replace(/\d{1,2}(?:\.\d{1,2})?\s*%/g, ' ');
    const rowTokens = lineNoTax.split(/\s+/).filter(Boolean);
    if (rowTokens.length < 2) continue;

    // Trailing numeric run = the numeric columns of the row.
    const numbers: number[] = [];
    let idx = rowTokens.length;
    while (idx > 0) {
      const token = rowTokens[idx - 1].replace(/[,₹$]/g, '');
      if (/^\d+(\.\d{1,2})?$/.test(token)) {
        numbers.unshift(cleanNumber(token));
        idx -= 1;
        continue;
      }
      break;
    }
    if (!numbers.length) continue;

    const description = rowTokens.slice(0, idx).join(' ').replace(/[|,:;\-]+$/, '').trim();
    if (!description || description.length < 2) continue;
    if (!/[A-Za-z]{2}/.test(description)) continue;
    // A description made only of digits is a number, not an item.
    if (!/[A-Za-z]/.test(description)) continue;

    let quantity = 0;
    let rate = 0;
    let amount: number | undefined;

    if (numbers.length >= 3) {
      quantity = numbers[0];
      rate = numbers[1];
      amount = numbers[2];
    } else if (numbers.length === 2) {
      // Two numbers are either (qty, rate) or (rate, amount) — a row that lost
      // its quantity column to the OCR leaves exactly this. Read as (qty, rate)
      // the row would be worth qty x rate, and when that no longer fits in the
      // bill's own taxable value the row must be (rate, amount) instead.
      const asQtyRate = numbers[0] * numbers[1];
      const asRateAmount = numbers[1];
      if (
        taxableBase !== undefined &&
        asQtyRate > taxableBase + 1 &&
        asRateAmount <= taxableBase + 1
      ) {
        quantity = 1;
        rate = numbers[0];
        amount = numbers[1];
      } else {
        quantity = numbers[0];
        rate = numbers[1];
      }
    } else {
      quantity = numbers[0];
    }

    if (quantity <= 0 && rate <= 0) continue;
    // A real item row carries money: a rate or an amount above zero. A row
    // with neither is an address, a header or a stray number — not an item.
    if (!(rate > 0) && !((amount ?? 0) > 0)) continue;
    // Ignore rows that are obviously a total (a huge single number).
    if (numbers.length === 1 && quantity > 100000) continue;

    items.push({
      name: description,
      quantity: quantity > 0 ? quantity : 1,
      rate: rate > 0 ? rate : 0,
      taxRate,
      amount,
    });
  }

  return items;
}

/**
 * Parse raw extracted bill text into structured fields.
 */
export function parseBillText(rawText: string): ParsedBill {
  const text = String(rawText || '')
    .replace(/\r/g, '\n')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const gstinMatch = GSTIN_RE.exec(text);
  const supplierGstin = gstinMatch ? repairGstin(gstinMatch[1]) : undefined;

  const billNumber =
    findLabeledValue(lines, ['invoice', 'inv', 'bill', 'document', 'doc', 'reference', 'ref']) ??
    undefined;

  const billDate =
    (() => {
      for (const line of lines) {
        const m = /(?:invoice|inv|bill|tax)?\s*date\s*[:\-]?\s*(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/i.exec(line);
        if (m) return normalizeDate(m[1]);
      }
      const first = DATE_RE.exec(text);
      return first ? normalizeDate(first[0]) : undefined;
    })() ?? undefined;

  const dueDate = (() => {
    for (const line of lines) {
      const m = /(?:due|payment\s*date|pay\s*by)\s*(?:date|on)?\s*[:\-]?\s*(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})/i.exec(line);
      if (m) return normalizeDate(m[1]);
    }
    return undefined;
  })();

  const taxableBase = findTaxableBase(lines);

  const items = findItems(lines, billNumber, supplierGstin, taxableBase);

  const itemSum = items.reduce((sum, item) => sum + (item.amount ?? item.quantity * item.rate), 0);

  // The bill's own summary tax (a single "GST 18% 4410.00" row) is allocated
  // across the items so the imported tax is the bill's tax, not a silent 0%. Use
  // the bill's printed taxable value as the base; fall back to the imported
  // item rows only when the bill prints none.
  const summaryTax = findSummaryTax(lines);
  if (summaryTax && !items.some((item) => item.taxRate > 0)) {
    allocateSummaryTax(items, summaryTax, taxableBase ?? itemSum);
  }

  const totalAmount = findTotalAmount(lines, itemSum);

  const notes = (() => {
    for (const line of lines) {
      const m = /^(?:notes?|terms(?:\s*&?\s*conditions)?|payment\s*terms)\s*[:\-]\s*(.+)$/i.exec(line);
      if (m) return m[1].trim();
    }
    return undefined;
  })();

  return {
    supplierName: findSupplierName(lines),
    supplierGstin,
    billNumber: billNumber ? stripTrailingNoise(billNumber) : undefined,
    billDate,
    dueDate,
    totalAmount,
    items,
    notes,
    summaryTax,
  };
}
