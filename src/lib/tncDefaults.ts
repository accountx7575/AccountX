export type TncDocType = 'sales_invoice' | 'quotation' | 'sales_order' | 'purchase';

export const STANDARD_TNC_DEFAULTS: Record<TncDocType, string> = {
  sales_invoice:
    'Goods once sold will not be taken back or exchanged.\nRedemption / delivery is subject to agreed operational timelines.\nThis is a computer-generated document and requires no physical signature.',
  quotation:
    'Prices valid for 15 days from the date of this quotation unless otherwise agreed.\nAll payments to be drawn in favour of the business.\nSubject to final order confirmation.',
  sales_order:
    'Deliveries subject to stock availability and confirmed schedule.\nStandard packaging unless specified otherwise.\nOrders once confirmed cannot be cancelled without mutual agreement.',
  purchase:
    'Goods received are subject to inspection and acceptance as per the purchase order.\nPlease quote this bill number in all future correspondence.\nThis is a computer-generated document and requires no physical signature.',
};

const LS_PREFIX = 'accountx_tnc_';

type TncColumns = {
  id?: string;
  tnc_invoice?: string | null;
  tnc_quotation?: string | null;
  tnc_sales_order?: string | null;
  tnc_purchase?: string | null;
};

const COL: Record<TncDocType, keyof TncColumns> = {
  sales_invoice: 'tnc_invoice',
  quotation: 'tnc_quotation',
  sales_order: 'tnc_sales_order',
  purchase: 'tnc_purchase',
};

export function tncStorageKey(businessId: string | null | undefined, docType: TncDocType): string {
  return `${LS_PREFIX}${docType}_${businessId || 'none'}`;
}

/** Best-effort localStorage fallback, used while the businesses T&C columns migration is pending. */
export function saveTncCache(
  businessId: string | null | undefined,
  values: Record<TncDocType, string | null | undefined>
): void {
  if (typeof window === 'undefined') return;
  (Object.keys(values) as TncDocType[]).forEach((docType) => {
    try {
      const v = String(values[docType] || '').trim();
      if (v) window.localStorage.setItem(tncStorageKey(businessId, docType), v);
      else window.localStorage.removeItem(tncStorageKey(businessId, docType));
    } catch {
      // ignore quota / private-mode failures
    }
  });
}

export function readTncCache(businessId: string | null | undefined, docType: TncDocType): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(tncStorageKey(businessId, docType)) || '').trim();
  } catch {
    return '';
  }
}

/** Resolution order: businesses db column > localStorage fallback > ''.
 *  An empty result means "nothing configured" — print engines then keep their
 *  built-in legacy defaults so unconfigured output stays byte-identical. */
export function resolveDocumentTnc(
  docType: TncDocType,
  business: TncColumns | null | undefined
): string {
  const dbValue = String(business?.[COL[docType]] || '').trim();
  if (dbValue) return dbValue;
  return readTncCache(business?.id, docType);
}

export function tncLines(raw: string): string[] {
  return raw.split('\n').map((t) => t.trim()).filter(Boolean);
}

export function resolveDocumentTncLines(
  docType: TncDocType,
  business: TncColumns | null | undefined
): string[] {
  return tncLines(resolveDocumentTnc(docType, business));
}

/** Record-stored terms win byte-identically; otherwise resolve from business defaults (may be empty => engine legacy defaults). */
export function resolveTermsLines(
  docType: TncDocType,
  business: TncColumns | null | undefined,
  recordTerms: string | null | undefined
): string[] {
  const stored = String(recordTerms || '').trim();
  return tncLines(stored || resolveDocumentTnc(docType, business));
}
