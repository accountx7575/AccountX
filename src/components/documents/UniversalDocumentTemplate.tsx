import React from 'react';
import { formatAadhaar } from '@/lib/validation';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  Landmark,
} from 'lucide-react';

export type DocumentType =
  | 'TAX_INVOICE'
  | 'SALES_ORDER'
  | 'QUOTATION'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_BILL'
  | 'ESTIMATE'
  | 'PROFORMA'
  | 'DEMO'
  | string;

export interface UniversalItem {
  id?: string;
  name?: string;
  product_name?: string;
  description?: string;
  hsn_sac?: string | null;
  hsn_code?: string;
  hsnSac?: string | null;
  quantity: number;
  unit?: string;
  rate?: number;
  unit_price?: number;
  denomination?: number;
  tax_rate?: number;
  taxRate?: number;
  tax?: number;
  taxable_amount?: number;
  total_amount?: number;
  totalPrice?: number;
  total?: number;
  code?: string;
  recipientEmail?: string;
  [key: string]: any;
}

export interface UniversalBankDetails {
  bankName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  ifsc?: string;
  upiId?: string;
  [key: string]: any;
}

export interface UniversalPartyInfo {
  name?: string;
  legalName?: string;
  legal_name?: string;
  tradeName?: string;
  trade_name?: string;
  brandTradeName?: string;
  address?: string;
  addressLine1?: string;
  addressLine2?: string;
  billingAddress?: string;
  city?: string;
  billingCity?: string;
  state?: string;
  billingState?: string;
  pincode?: string;
  billingPincode?: string;
  gstin?: string;
  pan?: string;
  aadhaar?: string;
  cin?: string;
  email?: string;
  phone?: string;
  website?: string;
  logoUrl?: string;
  logo_url?: string;
  signatureUrl?: string | null;
  signature_url?: string | null;
  signatureName?: string | null;
  signature_name?: string | null;
  stampUrl?: string | null;
  stamp_url?: string | null;
  invoice_footer_text?: string | null;
  bankName?: string;
  bank_name?: string;
  accountNumber?: string;
  bank_account_no?: string;
  bank_account_number?: string;
  account_number?: string;
  accountHolderName?: string;
  account_holder_name?: string;
  account_name?: string;
  ifsc?: string;
  bank_ifsc?: string;
  bank_ifsc_code?: string;
  ifsc_code?: string;
  upiId?: string;
  upi_id?: string;
  bankDetails?: UniversalBankDetails;
  invoiceFooterText?: string | null;
  companyName?: string;
  customerType?: 'B2B' | 'B2C';
  userId?: string;
  [key: string]: any;
}

// Backward compatibility alias for legacy tests
export type PartyDetails = UniversalPartyInfo;
export type DocumentLineItem = UniversalItem;

export interface UniversalDocumentData {
  documentType: DocumentType;
  documentNumber: string;
  invoiceNumber?: string;
  date: string;
  invoice_date?: string;
  completedAt?: string;
  time?: string;
  invoice_time?: string;
  created_at?: string;
  dueDate?: string | null;
  expiryDate?: string | null;
  expectedDeliveryDate?: string | null;
  expected_delivery_date?: string | null;
  placeOfSupply?: string;
  supplyType?: string;
  reverseCharge?: string | boolean;
  status?: string;
  orderId?: string;
  orderNumber?: string;
  paymentMethod?: string;
  paymentMode?: string;
  paymentStatus?: string;
  paymentRef?: string;
  notes?: string | null;
  taxNote?: string | null;
  terms?: string | string[] | null;
  demoHeader?: 'estimate' | 'demo' | 'clean' | null;
  isPurchaseBill?: boolean;
  bankDetails?: UniversalBankDetails;
  invoiceFooterText?: string | null;
  invoice_footer_text?: string | null;

  company?: UniversalPartyInfo;
  seller?: UniversalPartyInfo;
  customer: UniversalPartyInfo;

  items: UniversalItem[];
  subtotal: number;
  tax?: number;
  taxableAmount?: number;
  taxAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  isIntraState?: boolean;
  discount?: number;
  roundOff?: number;
  totalAmount: number;
  grandTotal?: number;

  [key: string]: any;
}

export interface UniversalDocumentTemplateProps {
  data: UniversalDocumentData;
  className?: string;
  id?: string;
}

export const inrDecimal = (val: number = 0): string => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val || 0));
};

export function numberToWordsINR(num: number): string {
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const b = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
  ];

  const inWords = (n: number): string => {
    let str = '';
    if (n > 99) {
      str += `${a[Math.floor(n / 100)]} Hundred `;
      n %= 100;
    }
    if (n > 19) {
      str += `${b[Math.floor(n / 10)]}${n % 10 ? ` ${a[n % 10]}` : ''} `;
    } else if (n > 0) {
      str += `${a[n]} `;
    }
    return str;
  };

  const rounded = Math.round(Number(num || 0));
  if (rounded === 0) return 'Zero Rupees Only';

  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const hundred = rounded % 1000;

  let out = '';
  if (crore) out += `${inWords(crore)}Crore `;
  if (lakh) out += `${inWords(lakh)}Lakh `;
  if (thousand) out += `${inWords(thousand)}Thousand `;
  if (hundred) out += inWords(hundred);

  return `${out.trim()} Rupees Only`;
}

const formatDocTime = (timeVal?: string | null, fallbackDate?: string | null): string => {
  if (timeVal && typeof timeVal === 'string' && timeVal.trim()) {
    const raw = timeVal.trim();
    const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
    if (ampmMatch) {
      const h = String(parseInt(ampmMatch[1], 10)).padStart(2, '0');
      const m = ampmMatch[2];
      const ampm = ampmMatch[3].toLowerCase();
      return `${h}:${m} ${ampm}`;
    }
    const h24Match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (h24Match) {
      let h = parseInt(h24Match[1], 10);
      const m = h24Match[2];
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }
    return raw;
  }

  if (fallbackDate && typeof fallbackDate === 'string') {
    if (fallbackDate.includes('T') || (fallbackDate.includes(':') && !/^\d{4}-\d{2}-\d{2}$/.test(fallbackDate))) {
      const d = new Date(fallbackDate);
      if (!isNaN(d.getTime())) {
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'pm' : 'am';
        hours = hours % 12 || 12;
        return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
      }
    }
  }

  return '';
};

const formatDocDate = (dateVal?: string | null) => {
  if (!dateVal) return '—';
  const clean = dateVal.trim();
  const dmyMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const d = new Date(clean);
  if (isNaN(d.getTime())) return clean;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
};

const formatDocDateTime = (
  dateVal?: string | null,
  timeVal?: string | null,
  createdAtVal?: string | null
) => {
  const effectiveDate = dateVal || createdAtVal;
  if (!effectiveDate) return '—';

  if (!timeVal && typeof effectiveDate === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}\s*(am|pm)$/i.test(effectiveDate.trim())) {
    return effectiveDate.trim();
  }

  const formattedDate = formatDocDate(effectiveDate);
  const formattedTime = formatDocTime(
    timeVal,
    effectiveDate && (effectiveDate.includes('T') || (effectiveDate.includes(':') && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)))
      ? effectiveDate
      : createdAtVal
  );

  return formattedTime ? `${formattedDate}, ${formattedTime}` : formattedDate;
};

export const GST_STATE_CODE_MAP: Record<string, { code: string; name: string }> = {
  '01': { code: '01', name: 'Jammu and Kashmir' },
  '02': { code: '02', name: 'Himachal Pradesh' },
  '03': { code: '03', name: 'Punjab' },
  '04': { code: '04', name: 'Chandigarh' },
  '05': { code: '05', name: 'Uttarakhand' },
  '06': { code: '06', name: 'Haryana' },
  '07': { code: '07', name: 'Delhi' },
  '08': { code: '08', name: 'Rajasthan' },
  '09': { code: '09', name: 'Uttar Pradesh' },
  '10': { code: '10', name: 'Bihar' },
  '11': { code: '11', name: 'Sikkim' },
  '12': { code: '12', name: 'Arunachal Pradesh' },
  '13': { code: '13', name: 'Nagaland' },
  '14': { code: '14', name: 'Manipur' },
  '15': { code: '15', name: 'Mizoram' },
  '16': { code: '16', name: 'Tripura' },
  '17': { code: '17', name: 'Meghalaya' },
  '18': { code: '18', name: 'Assam' },
  '19': { code: '19', name: 'West Bengal' },
  '20': { code: '20', name: 'Jharkhand' },
  '21': { code: '21', name: 'Odisha' },
  '22': { code: '22', name: 'Chhattisgarh' },
  '23': { code: '23', name: 'Madhya Pradesh' },
  '24': { code: '24', name: 'Gujarat' },
  '26': { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  '27': { code: '27', name: 'Maharashtra' },
  '29': { code: '29', name: 'Karnataka' },
  '30': { code: '30', name: 'Goa' },
  '31': { code: '31', name: 'Lakshadweep' },
  '32': { code: '32', name: 'Kerala' },
  '33': { code: '33', name: 'Tamil Nadu' },
  '34': { code: '34', name: 'Puducherry' },
  '35': { code: '35', name: 'Andaman and Nicobar Islands' },
  '36': { code: '36', name: 'Telangana' },
  '37': { code: '37', name: 'Andhra Pradesh' },
  '38': { code: '38', name: 'Ladakh' },
  '97': { code: '97', name: 'Other Territory' },
};

export const GST_STATE_NAME_TO_CODE: Record<string, string> = {
  'jammu and kashmir': '01',
  'jammu & kashmir': '01',
  'j&k': '01',
  'himachal pradesh': '02',
  'punjab': '03',
  'chandigarh': '04',
  'uttarakhand': '05',
  'uttaranchal': '05',
  'haryana': '06',
  'delhi': '07',
  'rajasthan': '08',
  'uttar pradesh': '09',
  'up': '09',
  'bihar': '10',
  'sikkim': '11',
  'arunachal pradesh': '12',
  'nagaland': '13',
  'manipur': '14',
  'mizoram': '15',
  'tripura': '16',
  'meghalaya': '17',
  'assam': '18',
  'west bengal': '19',
  'wb': '19',
  'jharkhand': '20',
  'odisha': '21',
  'orissa': '21',
  'chhattisgarh': '22',
  'madhya pradesh': '23',
  'mp': '23',
  'gujarat': '24',
  'daman and diu': '26',
  'dadra and nagar haveli': '26',
  'dadra and nagar haveli and daman and diu': '26',
  'maharashtra': '27',
  'andhra pradesh': '37',
  'karnataka': '29',
  'goa': '30',
  'lakshadweep': '31',
  'kerala': '32',
  'tamil nadu': '33',
  'puducherry': '34',
  'pondicherry': '34',
  'andaman and nicobar islands': '35',
  'andaman & nicobar': '35',
  'telangana': '36',
  'ladakh': '38',
  'other territory': '97',
};

export function formatPlaceOfSupply(
  rawPos?: string | null,
  fallbackState?: string | null,
  gstin?: string | null
): string {
  const candidate = String(rawPos || fallbackState || '').trim();
  if (!candidate) return 'Uttar Pradesh (09)';

  // If candidate is a 2-digit number like "09" or "27"
  if (/^[0-9]{2}$/.test(candidate)) {
    const entry = GST_STATE_CODE_MAP[candidate];
    if (entry) return `${entry.name} (${entry.code})`;
    return candidate;
  }

  // If already formatted with code in parentheses like "Uttar Pradesh (09)"
  const parenMatch = candidate.match(/^(.+?)\s*\(([0-9]{2})\)$/);
  if (parenMatch) {
    const namePart = parenMatch[1].trim();
    const codePart = parenMatch[2];
    return `${namePart} (${codePart})`;
  }

  // If formatted as "09 - Uttar Pradesh"
  const prefixMatch = candidate.match(/^([0-9]{2})\s*[-–]\s*(.+)$/);
  if (prefixMatch) {
    const codePart = prefixMatch[1];
    const namePart = prefixMatch[2].trim();
    return `${namePart} (${codePart})`;
  }

  // Lookup in name map
  const cleanKey = candidate.toLowerCase().replace(/[^a-z0-9&]/g, ' ').replace(/\s+/g, ' ').trim();
  const foundCode = GST_STATE_NAME_TO_CODE[cleanKey];
  if (foundCode) {
    const canonicalName = GST_STATE_CODE_MAP[foundCode]?.name || candidate;
    return `${canonicalName} (${foundCode})`;
  }

  // Fallback: check if GSTIN starts with a 2-digit state code
  if (gstin && /^[0-9]{2}/.test(gstin.trim())) {
    const gCode = gstin.trim().slice(0, 2);
    return `${candidate} (${gCode})`;
  }

  return candidate;
}

export function getDocumentTitles(
  _docType: string,
  _demoHeader?: 'estimate' | 'demo' | 'clean' | null
): { header: string; title: string; subtitle: string } {
  const type = String(_docType || '').toUpperCase().trim();
  let title = 'TAX INVOICE / RECEIPT';
  if (['QUOTATION', 'ESTIMATE', 'PROFORMA'].includes(type)) {
    title = type === 'ESTIMATE' ? 'ESTIMATE' : type === 'PROFORMA' ? 'PROFORMA INVOICE' : 'QUOTATION';
  } else if (type === 'SALES_ORDER') {
    title = 'SALES ORDER';
  } else if (type === 'PURCHASE_ORDER') {
    title = 'PURCHASE ORDER';
  } else if (type === 'PURCHASE_BILL') {
    title = 'PURCHASE BILL';
  } else if (type === 'DELIVERY_CHALLAN') {
    title = 'DELIVERY CHALLAN';
  } else if (type === 'CREDIT_NOTE') {
    title = 'CREDIT NOTE';
  } else if (type === 'DEBIT_NOTE') {
    title = 'DEBIT NOTE';
  }
  return {
    header: title,
    title,
    subtitle: 'Original for Recipient',
  };
}

export const UniversalDocumentTemplate: React.FC<UniversalDocumentTemplateProps> = ({
  data,
  className = '',
  id = 'invoice-printable-area',
}) => {
  const statusStr = (data.status || data.paymentStatus || 'PAID').toUpperCase();
  const isPaid =
    statusStr === 'SUCCESS' ||
    statusStr === 'CONFIRMED' ||
    statusStr === 'DELIVERED' ||
    statusStr === 'PAID';

  const customer = data.customer || {};
  const company = data.company || data.seller || {};

  const isB2B =
    customer.customerType === 'B2B' ||
    Boolean(customer.gstin || customer.companyName);

  const companyName = company.legalName || company.legal_name || company.name || 'GyftKart';
  const tradeName = String(company.tradeName || company.trade_name || '').trim();
  const showTradeSubtitle =
    tradeName.length > 0 && tradeName.toLowerCase() !== String(companyName).trim().toLowerCase();
  const signatureUrl = company.signatureUrl || company.signature_url || company.stampUrl || company.stamp_url || null;
  const signatureName = company.signatureName || company.signature_name || 'Authorized Signatory';
  const logoUrl =
    company.logoUrl ||
    company.logo_url ||
    company.logo ||
    (data as any).company?.logoUrl ||
    (data as any).company?.logo_url ||
    (data as any).logoUrl ||
    (data as any).logo_url ||
    null;
  const bankDetails = data.bankDetails || company.bankDetails || {};
  const bankName =
    bankDetails.bankName ||
    company.bankName ||
    company.bank_name ||
    '';
  const accountHolder =
    bankDetails.accountHolderName ||
    company.accountHolderName ||
    company.account_holder_name ||
    company.account_name ||
    '';
  const effectiveAccountHolder =
    accountHolder ||
    company.legalName ||
    company.legal_name ||
    company.name ||
    '';
  const accountNo =
    bankDetails.accountNumber ||
    company.accountNumber ||
    company.bank_account_no ||
    company.bank_account_number ||
    company.account_number ||
    '';
  const ifsc =
    bankDetails.ifsc ||
    company.ifsc ||
    company.bank_ifsc ||
    company.bank_ifsc_code ||
    company.ifsc_code ||
    '';
  const upiId =
    bankDetails.upiId ||
    company.upiId ||
    company.upi_id ||
    '';
  const hasBankDetails = Boolean(bankName || accountNo || ifsc || upiId || accountHolder);
  const termsText = typeof data.terms === 'string'
    ? data.terms
    : Array.isArray(data.terms)
      ? data.terms.join('\n')
      : ((company as any).terms || '');
  const footerText =
    data.invoiceFooterText ||
    data.invoice_footer_text ||
    company.invoiceFooterText ||
    company.invoice_footer_text ||
    null;
  const compRawAddr = String(
    company.streetAddress ||
    company.addressLine1 ||
    company.registeredAddress ||
    company.registered_address ||
    company.address ||
    ''
  ).trim();

  let companyStreet = '';
  let companyCityStatePin = '';

  if (compRawAddr.includes('\n')) {
    const parts = compRawAddr.split('\n').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      companyStreet = parts.slice(0, -1).join(', ');
      companyCityStatePin = parts[parts.length - 1] || '';
    } else {
      companyStreet = parts[0] || '';
    }
  } else {
    companyStreet = compRawAddr;
  }

  if (!companyCityStatePin) {
    const cityState = [company.city, company.state].filter(Boolean).join(', ');
    const pin = company.pincode || company.pinCode || company.pin_code || '';
    companyCityStatePin = (cityState || 'Barabanki, Uttar Pradesh') + (pin ? ` - ${pin}` : (cityState ? '' : ' - 225001'));
  }
  if (!companyStreet) {
    companyStreet = 'AN-25, LAUTA BAGH, AZADNAGAR, NAWABGANJ';
  }

  const compPhone = String(company.phone || company.mobile || (company as any).phoneNumber || (company as any).phone_number || '').trim();
  const compEmail = String(company.email || (company as any).emailAddress || (company as any).email_address || (!data.isPurchaseBill ? 'support@gyftkart.in' : '')).trim();
  const hasCompWeb = Boolean(company?.website && String(company.website).trim());

  const custCity = customer.city || customer.billingCity || '';
  const custState = customer.state || customer.billingState || '';
  const custPin = customer.pincode || customer.pin_code || customer.billingPincode || customer.pinCode || '';

  const rawCustAddr = String(
    customer.streetAddress ||
    customer.address ||
    customer.billingAddress ||
    customer.addressLine1 ||
    ''
  ).trim();

  let customerStreet = '';
  let customerCityStatePin = '';

  if (rawCustAddr.includes('\n')) {
    const parts = rawCustAddr.split('\n').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      customerStreet = parts.slice(0, -1).join(', ');
      customerCityStatePin = parts[parts.length - 1] || '';
    } else {
      customerStreet = parts[0] || '';
    }
  } else {
    customerStreet = rawCustAddr;
  }

  if (!customerCityStatePin) {
    const cityState = [custCity, custState].filter(Boolean).join(', ');
    customerCityStatePin = cityState + (custPin ? (cityState ? ` - ${custPin}` : String(custPin)) : '');
  }

  const custPhone = String(customer.phone || customer.mobile || (customer as any).phone_number || (customer as any).phoneNumber || '').trim();
  const custEmail = String(customer.email || (customer as any).email_address || (customer as any).emailAddress || '').trim();

  const docNumber = data.invoiceNumber || data.documentNumber || data.orderNumber || 'INV-MANUAL-CR-WIPMIW';
  const posLabel = formatPlaceOfSupply(
    data.placeOfSupply || customer.state || (customer as any).billingState || company.state,
    customer.state || (customer as any).billingState || company.state,
    customer.gstin || company.gstin
  );

  const docTypeKey = String(data.documentType || '').toUpperCase().trim();
  const isQuotationDoc = ['QUOTATION', 'ESTIMATE', 'PROFORMA'].includes(docTypeKey);
  const isSalesOrderDoc = docTypeKey === 'SALES_ORDER';
  const isTaxInvoiceDoc = docTypeKey === 'TAX_INVOICE' || docTypeKey === 'INVOICE' || !docTypeKey;

  const docTitle = isQuotationDoc
    ? (docTypeKey === 'ESTIMATE' ? 'ESTIMATE' : docTypeKey === 'PROFORMA' ? 'PROFORMA INVOICE' : 'QUOTATION')
    : isSalesOrderDoc
      ? 'SALES ORDER'
      : docTypeKey === 'PURCHASE_ORDER'
        ? 'PURCHASE ORDER'
        : docTypeKey === 'PURCHASE_BILL'
          ? 'PURCHASE BILL'
          : docTypeKey === 'DELIVERY_CHALLAN'
            ? 'DELIVERY CHALLAN'
            : docTypeKey === 'CREDIT_NOTE'
              ? 'CREDIT NOTE'
              : docTypeKey === 'DEBIT_NOTE'
                ? 'DEBIT NOTE'
                : 'TAX INVOICE / RECEIPT';

  const badgeSubtitle = !isTaxInvoiceDoc
    ? 'Original for Recipient'
    : isB2B
      ? 'Original for Recipient (B2B Tax Invoice)'
      : 'Original for Recipient (B2C)';
  const dueDateLabel = isQuotationDoc ? 'Valid Until' : isSalesOrderDoc ? 'Expected Delivery' : 'Due Date';
  const dueDateSource = isQuotationDoc
    ? data.expiryDate || data.dueDate
    : isSalesOrderDoc
      ? data.expectedDeliveryDate || data.expected_delivery_date || data.dueDate
      : data.dueDate;
  const formattedDueDate = formatDocDate(dueDateSource);

  // Date & Time computation requested by user (avoids UTC 00:00 -> IST 05:30 am shift)
  const rawDateVal = (data as any).invoice_date || data.date || data.completedAt;
  let displayDate = '';
  if (rawDateVal) {
    const ymdMatch = String(rawDateVal).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const dmyMatch = String(rawDateVal).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ymdMatch) {
      const [, y, m, d] = ymdMatch;
      displayDate = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    } else if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      displayDate = `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    } else {
      const d = new Date(rawDateVal);
      displayDate = !isNaN(d.getTime())
        ? d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : String(rawDateVal);
    }
  }

  const rawTime = data.invoice_time || data.time || (data as any).rawTime;
  let displayTime = '';
  if (rawTime && typeof rawTime === 'string' && rawTime.trim()) {
    const t = rawTime.trim();
    const ampmMatch = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
    const h24Match = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (ampmMatch) {
      displayTime = `${ampmMatch[1].padStart(2, '0')}:${ampmMatch[2]} ${ampmMatch[3].toLowerCase()}`;
    } else if (h24Match) {
      let h = parseInt(h24Match[1], 10);
      const m = h24Match[2];
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12 || 12;
      displayTime = `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    } else {
      displayTime = t;
    }
  } else if (data.created_at || (data as any).createdAt) {
    const cd = new Date(data.created_at || (data as any).createdAt);
    if (!isNaN(cd.getTime())) {
      displayTime = cd.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
  }

  const dateAndTimeString = displayTime ? `${displayDate}, ${displayTime}` : displayDate;
  
  const subtotal = Number(data.subtotal || 0);
  const totalTax = Number(data.tax ?? data.taxAmount ?? ((data.cgst || 0) + (data.sgst || 0) + (data.igst || 0)));
  const totalAmount = Number(data.totalAmount ?? data.grandTotal ?? (subtotal + totalTax));

  const effectiveTaxRate =
    totalTax > 0 && subtotal > 0
      ? Number(((totalTax / subtotal) * 100).toFixed(2))
      : 0;

  const isIntraState = data.isIntraState !== undefined ? data.isIntraState : (data.igst ?? 0) === 0;
  const halfTaxRate = effectiveTaxRate / 2;
  const cgstAmount = isIntraState ? (data.cgstAmount ?? (totalTax / 2)) : 0;
  const sgstAmount = isIntraState ? (data.sgstAmount ?? (totalTax / 2)) : 0;
  const igstAmount = !isIntraState ? (data.igstAmount ?? totalTax) : 0;

  return (
    <div
      id={id}
      className={`order-invoice-printable bg-white p-6 sm:p-10 text-slate-800 text-xs leading-relaxed font-sans ${className}`}
    >
      {/* 1. Header Section */}
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-6 border-b-2 border-slate-900 pb-6 sm:grid-cols-[1fr_auto] sm:gap-y-[6px]">
        <div className="order-1 sm:col-start-1 sm:row-start-1">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName || 'Company Logo'}
                className="h-12 w-auto object-contain max-w-[180px]"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base uppercase">
                {companyName?.charAt(0) || 'A'}
              </div>
            )}
            <span className="font-display text-2xl font-black tracking-tight text-emerald-900">
              {companyName}
            </span>
          </div>
          {showTradeSubtitle && (
            <p className="mt-1 text-[13px] font-extrabold text-slate-900">{tradeName}</p>
          )}
        </div>

        <div className="order-2 space-y-1 leading-snug sm:col-start-1 sm:row-start-2">
          {/* Row 1: Street Address */}
          <p className="text-xs text-slate-600 max-w-md">
            {companyStreet}
          </p>
          {/* Row 2: City, State - Pincode */}
          <p className="text-xs text-slate-600 max-w-md">
            {companyCityStatePin}
          </p>
          {/* Row 3: GSTIN: [GSTIN] | PAN: [PAN] | CIN: [CIN] */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600 font-medium">
            <span>
              <strong className="text-slate-700">GSTIN:</strong> {company.gstin || '09AAHCT1158J1Z2'}
            </span>
            <span>
              <strong className="text-slate-700">PAN:</strong> {company.pan || 'AAHCT1158'}
            </span>
            {Boolean(company?.cin && String(company.cin).trim()) && (
              <span>
                <strong className="text-slate-700">CIN:</strong> {String(company.cin).trim()}
              </span>
            )}
          </div>
          {/* Row 4: Phone: [Phone Number] | Email: [Email Address] */}
          {(compPhone || compEmail || hasCompWeb) && (
            <p className="text-xs text-slate-600 leading-snug">
              {compPhone && (
                <span>
                  <strong className="text-slate-700">Phone:</strong> {compPhone}
                </span>
              )}
              {compPhone && compEmail && <span className="text-slate-400 mx-1.5 font-normal">|</span>}
              {compEmail && (
                <span>
                  <strong className="text-slate-700">Email:</strong> {compEmail}
                </span>
              )}
              {hasCompWeb && (
                <>
                  {(compPhone || compEmail) && <span className="text-slate-400 mx-1.5 font-normal">|</span>}
                  <span>
                    <strong className="text-slate-700">Web:</strong> {String(company.website).trim()}
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {/* Invoice Meta Heading */}
        <div className="order-3 text-left sm:col-start-2 sm:row-start-1 sm:text-right">
          <div className="inline-block rounded-md bg-emerald-50 border border-emerald-200 px-3 py-1 text-center">
            <span className="text-[11px] font-black uppercase tracking-wider text-emerald-900">
              {docTitle}
            </span>
            <p className="text-[9px] font-semibold text-emerald-700">
              {badgeSubtitle}
            </p>
          </div>
        </div>

        <div className="order-4 text-left font-mono text-[11px] space-y-1 leading-5 sm:col-start-2 sm:row-start-2 sm:text-right">
          <p>
            <span className="text-slate-500 font-sans text-[11px]">Invoice No:</span>{' '}
            <strong className="text-slate-900 text-xs">{docNumber}</strong>
          </p>
          <p>
            <span className="text-slate-500 font-sans">Date &amp; Time:</span>{' '}
            <span className="text-slate-900 font-semibold">{dateAndTimeString}</span>
          </p>
          <p>
            <span className="text-slate-500 font-sans">{dueDateLabel}:</span>{' '}
            <span className="text-slate-900 font-semibold">{formattedDueDate}</span>
          </p>
          <p>
            <span className="text-slate-500 font-sans">Place of Supply:</span>{' '}
            <span className="text-slate-900 font-semibold">{posLabel}</span>
          </p>
        </div>
      </div>

      {/* 2. Details Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-6 p-4 rounded-xl bg-slate-50/70 border border-slate-200/80">
        <div className="space-y-1 text-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <Building2 className="h-3 w-3 text-slate-400" /> Billed To (
            {isB2B ? 'Corporate Client' : 'Customer Details'})
          </p>
          {isB2B && customer.companyName ? (
            <>
              <p className="text-sm font-extrabold text-slate-900">
                M/s {customer.companyName}
              </p>
              {(customer.brandTradeName || customer.tradeName || customer.trade_name) && (
                <p className="text-xs font-medium text-slate-600">
                  T/A {customer.brandTradeName || customer.tradeName || customer.trade_name}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-extrabold text-slate-900">
              {customer.name || 'Valued Customer'}
            </p>
          )}

          {/* Row 2: Street Address */}
          {customerStreet && (
            <p className="text-xs text-slate-600 leading-snug">{customerStreet}</p>
          )}

          {/* Row 3: City, State - Pincode */}
          {customerCityStatePin && (
            <p className="text-xs text-slate-600 leading-snug">{customerCityStatePin}</p>
          )}

          {/* Row 4: GSTIN: [GSTIN] | PAN: [PAN] | Aadhaar: [Aadhaar] */}
          {(customer.gstin || customer.pan || customer.aadhaar) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {customer.gstin && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] font-mono font-bold text-emerald-800">
                  GSTIN: {customer.gstin}
                </span>
              )}
              {customer.pan && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono font-medium text-slate-700">
                  PAN: {customer.pan}
                </span>
              )}
              {customer.aadhaar && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono font-medium text-slate-700">
                  Aadhaar: {formatAadhaar(customer.aadhaar)}
                </span>
              )}
            </div>
          )}

          {/* Attn line for B2B */}
          {isB2B && customer.companyName && customer.name && (
            <p className="text-slate-600 text-xs">
              <span className="text-slate-400">Attn:</span> {customer.name}
            </p>
          )}

          {/* Row 5: Phone: [Phone] | Email: [Email] */}
          {(custPhone || custEmail) && (
            <p className="text-xs text-slate-600 leading-snug pt-0.5">
              {custPhone && (
                <span>
                  <strong className="text-slate-700">Phone:</strong> {custPhone}
                </span>
              )}
              {custPhone && custEmail && <span className="text-slate-400 mx-1.5 font-normal">|</span>}
              {custEmail && (
                <span>
                  <strong className="text-slate-700">Email:</strong> {custEmail}
                </span>
              )}
            </p>
          )}
          {customer.userId && (
            <p className="text-[10px] font-mono text-slate-400 mt-1">
              Customer UUID: {customer.userId}
            </p>
          )}
        </div>

        <div className="sm:border-l sm:border-slate-200 sm:pl-6 space-y-1 text-[11px]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-slate-400" /> Payment &amp; Fulfillment
          </p>
          <p className="flex justify-between sm:justify-start sm:gap-4">
            <span className="text-slate-500 w-28">Order Ref:</span>
            <strong className="font-mono text-slate-900 font-semibold">
              #{data.orderId || data.orderNumber || docNumber}
            </strong>
          </p>
          <p className="flex justify-between sm:justify-start sm:gap-4">
            <span className="text-slate-500 w-28">Payment Mode:</span>
            <span className="text-slate-900 font-semibold">
              {data.paymentMethod || data.paymentMode || 'Wallet'}
            </span>
          </p>
          <p className="flex justify-between sm:justify-start sm:gap-4">
            <span className="text-slate-500 w-28">Ref / UTR No:</span>
            <span className="font-mono text-slate-900 font-semibold">
              {data.paymentRef || docNumber}
            </span>
          </p>
          <p className="flex justify-between sm:justify-start sm:gap-4 items-center">
            <span className="text-slate-500 w-28">Payment Status:</span>
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              {isPaid ? 'PAID & DELIVERED' : statusStr}
            </span>
          </p>
        </div>
      </div>

      {/* 3. Line Items Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 mb-6">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              <th className="px-3 py-2.5 w-10 text-center">#</th>
              <th className="px-3 py-2.5">Item Description / Voucher</th>
              <th className="px-3 py-2.5 w-24 text-center">HSN/SAC</th>
              <th className="px-3 py-2.5 w-14 text-center">Qty</th>
              <th className="px-3 py-2.5 w-24 text-right">Unit Rate (₹)</th>
              <th className="px-3 py-2.5 w-20 text-center">Tax (GST)</th>
              <th className="px-3 py-2.5 w-28 text-right">Total (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((item, idx) => {
              const name = item.product_name || item.name || 'GyftKart Digital Gift Voucher';
              const rate = item.denomination ?? item.unit_price ?? item.rate ?? 0;
              const total = item.total ?? item.totalPrice ?? item.total_amount ?? (item.quantity * rate);
              const itemTaxRate = item.taxRate !== undefined ? item.taxRate : (item.tax_rate ?? effectiveTaxRate);

              return (
                <tr key={item.id ?? idx} className="hover:bg-slate-50/40">
                  <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-400">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-bold text-slate-900">{name}</p>
                    {item.recipientEmail && (
                      <p className="text-[10px] text-slate-500">
                        Delivered to: {item.recipientEmail}
                      </p>
                    )}
                    {item.code && (
                      <p className="mt-0.5 font-mono text-[10px] text-emerald-700">
                        Code: {item.code}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-500">
                    {item.hsn_sac || item.hsnSac || item.hsn_code || '998434'}
                  </td>
                  <td className="px-3 py-3 text-center font-mono font-semibold text-slate-700">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700">
                    {inrDecimal(rate)}
                  </td>
                  <td className="px-3 py-3 text-center text-[10px] font-semibold text-slate-500">
                    {itemTaxRate > 0 ? `${itemTaxRate.toFixed(2)}%` : '0.00%'}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">
                    {inrDecimal(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 4. Financial Breakdown & Words */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 pb-6 border-b border-slate-200">
        <div className="flex flex-col justify-between space-y-4">
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/70">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Amount Chargeable (in words)
            </p>
            <p className="text-xs font-extrabold text-slate-900 italic">
              {numberToWordsINR(totalAmount)}
            </p>
          </div>

          {hasBankDetails && (
            <div className="mt-3 pt-2.5 border-t border-dashed border-slate-200">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Landmark className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Bank &amp; Payment Details
                </span>
              </div>
              <div className="flex flex-col space-y-0.5 text-[11px]">
                {bankName && (
                  <p className="leading-snug">
                    <span className="text-slate-400 font-sans text-[10px]">Bank: </span>
                    <span className="text-slate-800 font-semibold text-[11px]">{bankName}</span>
                  </p>
                )}
                {effectiveAccountHolder && (
                  <p className="leading-snug">
                    <span className="text-slate-400 font-sans text-[10px]">A/C Name: </span>
                    <span className="text-slate-800 font-semibold text-[11px]">{effectiveAccountHolder}</span>
                  </p>
                )}
                {accountNo && (
                  <p className="leading-snug">
                    <span className="text-slate-400 font-sans text-[10px]">A/C No: </span>
                    <span className="text-slate-800 font-semibold font-mono text-[11px]">{accountNo}</span>
                  </p>
                )}
                {ifsc && (
                  <p className="leading-snug">
                    <span className="text-slate-400 font-sans text-[10px]">IFSC: </span>
                    <span className="text-slate-800 font-semibold font-mono text-[11px]">{ifsc}</span>
                  </p>
                )}
                {upiId && (
                  <p className="leading-snug">
                    <span className="text-slate-400 font-sans text-[10px]">UPI: </span>
                    <span className="text-slate-800 font-semibold text-[11px]">{upiId}</span>
                  </p>
                )}
              </div>
            </div>
          )}
          {data.taxNote ? (
            <div className="text-[10px] text-slate-500 space-y-1 mt-2">
              <p>{data.taxNote}</p>
            </div>
          ) : !hasBankDetails ? (
            <div className="text-[10px] text-slate-500 space-y-1 mt-2">
              <p className="font-semibold text-slate-700">Tax Note on Prepaid Gift Vouchers:</p>
              <p>
                As per Indian GST regulations and CBIC circulars, digital gift cards and prepaid vouchers represent actionable claims (SAC 998434) and are exempt from standard service tax at the time of voucher issuance. GST applies at consumption/redemption by respective merchants.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 font-mono text-xs">
          <div className="flex justify-between py-1 text-slate-600">
            <span className="font-sans">Subtotal (Taxable Value):</span>
            <span>₹{inrDecimal(subtotal)}</span>
          </div>
          {isIntraState ? (
            <>
              <div className="flex justify-between py-1 text-slate-500">
                <span className="font-sans">
                  Central GST (CGST {halfTaxRate}%):
                </span>
                <span>₹{inrDecimal(cgstAmount)}</span>
              </div>
              <div className="flex justify-between py-1 text-slate-500">
                <span className="font-sans">
                  State GST (SGST {halfTaxRate}%):
                </span>
                <span>₹{inrDecimal(sgstAmount)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between py-1 text-slate-500">
              <span className="font-sans">
                Integrated GST (IGST {effectiveTaxRate}%):
              </span>
              <span>₹{inrDecimal(igstAmount)}</span>
            </div>
          )}
          {data.discount ? (
            <div className="flex justify-between py-1 text-emerald-600 font-semibold">
              <span className="font-sans">Discount:</span>
              <span>- ₹{inrDecimal(data.discount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between items-center rounded-xl bg-emerald-50/70 border border-emerald-200 p-3 font-sans mt-3">
            <span className="text-sm font-black text-emerald-950">Grand Total (INR):</span>
            <span className="text-base font-black font-mono text-emerald-900">
              ₹{inrDecimal(totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Footer Terms & Digitally Authorized Signatory */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-6 pt-6">
        <div className="text-[10px] text-slate-500 max-w-md mt-0">
          <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wider leading-4 mt-0 mb-1">
            Terms &amp; Conditions:
          </p>
          <div className="text-[10px] text-slate-500 leading-normal space-y-0.5">
            {termsText ? (
              termsText.split('\n').filter(Boolean).map((line: string, i: number) => (
                <p key={i}>• {line.replace(/^[•\-\*]\s*/, '')}</p>
              ))
            ) : (
              <p>• Standard terms &amp; conditions apply.</p>
            )}
          </div>
        </div>

        <div className="text-right flex flex-col items-end shrink-0 mt-0">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-4 mt-0 mb-1">
            For {company.legalName || company.name || companyName}
          </p>
          {signatureUrl ? (
            <img 
              src={signatureUrl} 
              alt="Stamp & Signature" 
              className="h-12 max-w-[130px] object-contain my-1" 
            />
          ) : (
            <div className="h-12 flex items-center justify-center border border-dashed border-slate-300 rounded px-3 my-1">
              <span className="text-[10px] text-slate-400">Authorized Signatory</span>
            </div>
          )}
          <span className="text-[11px] font-bold text-slate-800 block">
            {signatureName || 'Authorized Signatory'}
          </span>
          <span className="text-[9px] text-slate-400">Authorized Signatory</span>
        </div>
      </div>

      {/* 6. Document Footer Text */}
      {footerText && (
        <div className="w-full border-t border-slate-100 pt-2 pb-1 mt-6 text-center">
          <p className="text-[9px] text-slate-400 font-sans tracking-wide">
            {footerText}
          </p>
        </div>
      )}
    </div>
  );
};

export const printElementInIframe = (
  target: string | HTMLElement | null = 'invoice-printable-area',
  docTitle: string = 'Document'
): void => {
  const invoiceEl = typeof target === 'string' ? document.getElementById(target) : target;
  if (!invoiceEl) return;

  const parentStyles = Array.from(
    document.head.querySelectorAll('link[rel="stylesheet"], style')
  )
    .map((el) => el.outerHTML)
    .join('\n');

  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0px';
  printFrame.style.height = '0px';
  printFrame.style.border = 'none';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${docTitle}</title>
        ${parentStyles}
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          *, *::before, *::after { box-sizing: border-box !important; }
          html, body {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          @media print {
            body {
              transform: scale(0.97);
              transform-origin: top center;
            }
          }
          .order-invoice-printable {
            width: 98% !important;
            max-width: 98% !important;
            margin: 0 auto !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            word-break: break-word !important;
          }
          .grid.grid-cols-1.sm\\:grid-cols-2,
          .grid.grid-cols-1.md\\:grid-cols-2 {
            display: flex !important;
            flex-direction: row !important;
            justify-content: space-between !important;
            gap: 16px !important;
            width: 100% !important;
          }
          .grid.grid-cols-1.sm\\:grid-cols-2 > div,
          .grid.grid-cols-1.md\\:grid-cols-2 > div {
            flex: 1 1 50% !important;
            max-width: 50% !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
          }
          .flex-col.sm\\:flex-row {
            display: flex !important;
            flex-direction: row !important;
            justify-content: space-between !important;
            align-items: flex-start !important;
            width: 100% !important;
          }
          table { width: 100% !important; border-collapse: collapse !important; }
          th, td { word-break: break-word !important; }
        </style>
      </head>
      <body>
        <div style="width: 100%; max-width: 100%; margin: 0 auto;">
          ${invoiceEl.outerHTML}
        </div>
        <script>
          const triggerPrint = () => {
            setTimeout(() => {
              window.focus();
              window.print();
              setTimeout(() => {
                window.frameElement?.remove();
              }, 1000);
            }, 250);
          };
          if (document.readyState === 'complete') triggerPrint();
          else window.onload = triggerPrint;
        </script>
      </body>
    </html>
  `);
  doc.close();
};

export function mapSalesOrderToUniversalData(business: any, order: any, items: any[] = []): UniversalDocumentData {
  const persistedNumber = order?.order_number || order?.number || 'SO-001';
  const cust = (Array.isArray(order?.customer) ? order?.customer[0] : order?.customer) || order?.client || {};
  const streetAddress = String(
    cust.address || cust.billing_address || cust.billingAddress || cust.addressLine1 || order?.customer_address || order?.party_address || ''
  ).trim();
  const cityState = [
    cust.city || cust.billingCity,
    cust.state || cust.billingState,
  ].filter(Boolean).join(', ');
  const pin = cust.pincode || cust.pin_code || cust.pinCode || cust.billingPincode || '';
  const cityStatePin = cityState + (pin ? (cityState ? ` - ${pin}` : String(pin)) : '');
  const fullAddress = streetAddress
    ? [streetAddress, cityStatePin].filter(Boolean).join('\n')
    : '';

  return {
    documentType: 'SALES_ORDER',
    documentNumber: persistedNumber,
    invoiceNumber: persistedNumber,
    date: order?.order_date || order?.created_at || '19 Oct 2026, 12:34 pm',
    time: order?.order_time || order?.time,
    created_at: order?.created_at,
    status: order?.status || 'Confirmed',
    orderNumber: order?.order_number,
    expectedDeliveryDate: order?.expected_delivery_date || order?.expected_date || null,
    dueDate: order?.due_date || null,
    placeOfSupply: order?.place_of_supply || cust.state || business?.state,
    company: business,
    customer: {
      name: String(
        cust.name ||
        cust.business_name ||
        cust.company_name ||
        order?.customer_name ||
        order?.party_name ||
        ''
      ).trim(),
      companyName: cust.company_name || cust.business_name || order?.customer_company,
      address: fullAddress,
      streetAddress,
      city: cust.city || cust.billingCity,
      state: cust.state || cust.billingState,
      pincode: pin,
      gstin: cust.gstin || order?.customer_gstin || order?.party_gstin,
      phone: cust.phone || order?.customer_phone || order?.party_phone,
      email: cust.email || order?.customer_email,
    },
    items: items.map((i) => ({
      name: i?.product_name || i?.name || 'Item',
      product_name: i?.product_name || i?.name || 'Item',
      hsn_sac: i?.hsn_sac || i?.hsn_code || '998434',
      quantity: Number(i?.quantity || 1),
      unit_price: Number(i?.rate || i?.unit_price || 0),
      totalPrice: Number(i?.total_amount || i?.total || 0),
    })),
    subtotal: Number(order?.subtotal || order?.taxable_amount || 0),
    totalAmount: Number(order?.total_amount || 0),
  };
}

export function mapSalesInvoiceToUniversalData(business: any, invoice: any, items: any[] = []): UniversalDocumentData {
  const cust = (Array.isArray(invoice?.customer) ? invoice?.customer[0] : invoice?.customer) || invoice?.client || {};
  const streetAddress = String(
    cust.address || cust.billing_address || cust.billingAddress || cust.addressLine1 || invoice?.customer_address || invoice?.party_address || ''
  ).trim();
  const cityState = [
    cust.city || cust.billingCity,
    cust.state || cust.billingState,
  ].filter(Boolean).join(', ');
  const pin = cust.pincode || cust.pin_code || cust.pinCode || cust.billingPincode || '';
  const cityStatePin = cityState + (pin ? (cityState ? ` - ${pin}` : String(pin)) : '');
  const fullAddress = streetAddress
    ? [streetAddress, cityStatePin].filter(Boolean).join('\n')
    : '';

  return {
    documentType: 'TAX_INVOICE',
    documentNumber: invoice?.invoice_number || invoice?.number || 'INV-001',
    date: invoice?.invoice_date || invoice?.created_at || '19 Oct 2026, 12:34 pm',
    time: invoice?.invoice_time || invoice?.time,
    invoice_time: invoice?.invoice_time || invoice?.time,
    created_at: invoice?.created_at,
    status: invoice?.status || 'Confirmed',
    dueDate: invoice?.due_date || null,
    company: business,
    customer: {
      name: String(
        cust.name ||
        cust.business_name ||
        cust.company_name ||
        invoice?.customer_name ||
        invoice?.party_name ||
        ''
      ).trim(),
      companyName: cust.company_name || cust.business_name || invoice?.customer_company,
      address: fullAddress,
      streetAddress,
      city: cust.city || cust.billingCity,
      state: cust.state || cust.billingState,
      pincode: pin,
      gstin: cust.gstin || invoice?.customer_gstin || invoice?.party_gstin,
      phone: cust.phone || invoice?.customer_phone || invoice?.party_phone,
      email: cust.email || invoice?.customer_email,
    },
    items: items.map((i) => ({
      name: i?.product_name || i?.name || 'Item',
      product_name: i?.product_name || i?.name || 'Item',
      hsn_sac: i?.hsn_sac || i?.hsn_code || '998434',
      quantity: Number(i?.quantity || 1),
      unit_price: Number(i?.rate || i?.unit_price || 0),
      totalPrice: Number(i?.total_amount || i?.total || 0),
    })),
    subtotal: Number(invoice?.subtotal || invoice?.taxable_amount || 0),
    totalAmount: Number(invoice?.total_amount || 0),
  };
}

export function mapQuotationToUniversalData(business: any, quote: any, items: any[] = []): UniversalDocumentData {
  const cust = (Array.isArray(quote?.customer) ? quote?.customer[0] : quote?.customer) || quote?.client || {};
  const streetAddress = String(
    cust.address || cust.billing_address || cust.billingAddress || cust.addressLine1 || quote?.customer_address || quote?.party_address || ''
  ).trim();
  const cityState = [
    cust.city || cust.billingCity,
    cust.state || cust.billingState,
  ].filter(Boolean).join(', ');
  const pin = cust.pincode || cust.pin_code || cust.pinCode || cust.billingPincode || '';
  const cityStatePin = cityState + (pin ? (cityState ? ` - ${pin}` : String(pin)) : '');
  const fullAddress = streetAddress
    ? [streetAddress, cityStatePin].filter(Boolean).join('\n')
    : '';

  return {
    documentType: 'QUOTATION',
    documentNumber: quote?.quotation_number || quote?.number || 'QT-001',
    orderNumber: quote?.quotation_number || quote?.number,
    date: quote?.quotation_date || quote?.created_at || '19 Oct 2026, 12:34 pm',
    time: quote?.quotation_time || quote?.time,
    created_at: quote?.created_at,
    status: quote?.status || 'Draft',
    expiryDate: quote?.expiry_date || quote?.valid_until || null,
    dueDate: quote?.due_date || null,
    company: business,
    customer: {
      name: String(
        cust.name ||
        cust.business_name ||
        cust.company_name ||
        quote?.customer_name ||
        quote?.party_name ||
        ''
      ).trim(),
      companyName: cust.company_name || cust.business_name || quote?.customer_company,
      address: fullAddress,
      streetAddress,
      city: cust.city || cust.billingCity,
      state: cust.state || cust.billingState,
      pincode: pin,
      gstin: cust.gstin || quote?.customer_gstin || quote?.party_gstin,
      phone: cust.phone || quote?.customer_phone || quote?.party_phone,
      email: cust.email || quote?.customer_email,
    },
    items: items.map((i) => ({
      name: i?.product_name || i?.name || 'Item',
      product_name: i?.product_name || i?.name || 'Item',
      hsn_sac: i?.hsn_sac || i?.hsn_code || '998434',
      quantity: Number(i?.quantity || 1),
      unit_price: Number(i?.rate || i?.unit_price || 0),
      totalPrice: Number(i?.total_amount || i?.total || 0),
    })),
    subtotal: Number(quote?.subtotal || 0),
    totalAmount: Number(quote?.total_amount || 0),
  };
}

export function mapPurchaseOrderToUniversalData(business: any, order: any, items: any[] = []): UniversalDocumentData {
  const supplier = (Array.isArray(order?.supplier) ? order?.supplier[0] : order?.supplier) || order?.vendor || {};
  const streetAddress = String(
    supplier.address || supplier.billing_address || supplier.billingAddress || supplier.addressLine1 || order?.supplier_address || ''
  ).trim();
  const cityState = [
    supplier.city || supplier.billingCity,
    supplier.state || supplier.billingState,
  ].filter(Boolean).join(', ');
  const pin = supplier.pincode || supplier.pin_code || supplier.pinCode || supplier.billingPincode || '';
  const cityStatePin = cityState + (pin ? (cityState ? ` - ${pin}` : String(pin)) : '');
  const fullAddress = streetAddress
    ? [streetAddress, cityStatePin].filter(Boolean).join('\n')
    : '';

  return {
    documentType: 'PURCHASE_ORDER',
    documentNumber: order?.order_number || order?.po_number || order?.number || 'PO-001',
    date: order?.order_date || order?.created_at || '19 Oct 2026, 12:34 pm',
    time: order?.order_time || order?.po_time || order?.time,
    created_at: order?.created_at,
    status: order?.status || 'Confirmed',
    dueDate: order?.due_date || order?.expected_date || null,
    company: business,
    customer: {
      name: supplier.name || order?.supplier_name || 'Supplier',
      companyName: supplier.company_name || supplier.name || order?.supplier_name,
      address: fullAddress,
      streetAddress,
      city: supplier.city || supplier.billingCity,
      state: supplier.state || supplier.billingState,
      pincode: pin,
      gstin: supplier.gstin || order?.supplier_gstin,
      phone: supplier.phone || order?.supplier_phone,
      email: supplier.email || order?.supplier_email,
    },
    items: items.map((i) => ({
      name: i?.product_name || i?.name || 'Item',
      quantity: Number(i?.quantity || 1),
      unit_price: Number(i?.rate || i?.unit_price || 0),
      totalPrice: Number(i?.total_amount || i?.total || 0),
    })),
    subtotal: Number(order?.subtotal || 0),
    totalAmount: Number(order?.total_amount || 0),
  };
}

export function mapPurchaseBillToUniversalData(business: any, bill: any, items: any[] = []): UniversalDocumentData {
  const supplier = (Array.isArray(bill?.supplier) ? bill?.supplier[0] : bill?.supplier) || bill?.vendor || {};
  const streetAddress = String(
    supplier.address || supplier.billing_address || supplier.billingAddress || supplier.addressLine1 || bill?.supplier_address || ''
  ).trim();
  const cityState = [
    supplier.city || supplier.billingCity,
    supplier.state || supplier.billingState,
  ].filter(Boolean).join(', ');
  const pin = supplier.pincode || supplier.pin_code || supplier.pinCode || supplier.billingPincode || '';
  const cityStatePin = cityState + (pin ? (cityState ? ` - ${pin}` : String(pin)) : '');
  const fullAddress = streetAddress
    ? [streetAddress, cityStatePin].filter(Boolean).join('\n')
    : '';

  const buyerStreet = String(
    business?.address || business?.billing_address || business?.billingAddress || business?.addressLine1 || business?.registered_address || ''
  ).trim();
  const buyerCityState = [
    business?.city || business?.billing_city || business?.billingCity,
    business?.state || business?.billing_state || business?.billingState,
  ].filter(Boolean).join(', ');
  const buyerPin = business?.pincode || business?.pin_code || business?.pinCode || business?.billingPincode || '';
  const buyerCityStatePin = buyerCityState + (buyerPin ? (buyerCityState ? ` - ${buyerPin}` : String(buyerPin)) : '');
  const buyerFullAddress = buyerStreet
    ? [buyerStreet, buyerCityStatePin].filter(Boolean).join('\n')
    : '';

  return {
    documentType: 'PURCHASE_BILL',
    documentNumber: bill?.bill_number || bill?.number || 'BILL-001',
    date: bill?.bill_date || bill?.created_at || '19 Oct 2026, 12:34 pm',
    time: bill?.bill_time || bill?.time,
    created_at: bill?.created_at,
    status: bill?.status || 'Confirmed',
    dueDate: bill?.due_date || null,
    isPurchaseBill: true,
    company: {
      name: bill?.supplier_name || supplier.name || 'Supplier',
      address: fullAddress,
      streetAddress,
      city: supplier.city || supplier.billingCity,
      state: supplier.state || supplier.billingState,
      pincode: pin,
      gstin: supplier.gstin || bill?.supplier_gstin,
      phone: supplier.phone || bill?.supplier_phone,
      email: supplier.email || bill?.supplier_email,
    },
    customer: {
      ...business,
      name: business?.name || business?.legal_name || 'Buyer',
      companyName: business?.legal_name || business?.name,
      address: buyerFullAddress || business?.address,
      streetAddress: buyerStreet || business?.streetAddress || business?.address,
      city: business?.city || business?.billing_city,
      state: business?.state || business?.billing_state,
      pincode: buyerPin,
      gstin: business?.gstin,
      pan: business?.pan,
      phone: business?.phone || business?.mobile,
      email: business?.email,
    },
    items: items.map((i) => ({
      name: i?.product_name || i?.name || 'Item',
      quantity: Number(i?.quantity || 1),
      unit_price: Number(i?.rate || i?.unit_price || 0),
      totalPrice: Number(i?.total_amount || i?.total || 0),
    })),
    subtotal: Number(bill?.subtotal || 0),
    totalAmount: Number(bill?.total_amount || 0),
  };
}

export default UniversalDocumentTemplate;