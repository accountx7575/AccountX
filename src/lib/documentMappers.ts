/**
 * documentMappers.ts
 *
 * Mappers and address formatters for UniversalDocumentTemplate.
 * Formats party (customer/supplier) addresses and calculates GST totals (Subtotal,
 * CGST, SGST, IGST, and Grand Total) across all document types.
 */

import type {
  UniversalDocumentData,
  UniversalItem,
} from '@/components/documents/UniversalDocumentTemplate';
import { numberToWordsINR } from '@/components/documents/UniversalDocumentTemplate';
import { readBusinessColumnStash, readBusinessExtras } from './businessExtras';
import { readTncCache } from './tncDefaults';

export interface FormattedAddress {
  streetAddress: string;
  cityStatePin: string;
  fullAddress: string;
}

export interface UniversalBankDetails {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  ifsc: string;
  upiId: string;
}

export function extractBankDetails(business: any): UniversalBankDetails {
  const b = business || {};
  const id = b.id;
  const stash = typeof window !== 'undefined' && id ? readBusinessColumnStash(id) : {};
  const extras = typeof window !== 'undefined' && id ? readBusinessExtras(id) : {};

  const bankName = String(
    b.bank_name ||
    b.bankName ||
    b.bank ||
    stash?.bank_name ||
    ''
  ).trim();

  const accountNumber = String(
    b.bank_account_number ||
    b.bank_account_no ||
    b.account_number ||
    b.accountNumber ||
    b.bankAccountNo ||
    stash?.bank_account_number ||
    ''
  ).trim();

  const accountHolderName = String(
    b.account_name ||
    b.account_holder_name ||
    b.accountHolderName ||
    b.accountName ||
    b.bank_account_holder_name ||
    extras?.account_name ||
    stash?.account_name ||
    ''
  ).trim();

  const ifsc = String(
    b.bank_ifsc_code ||
    b.bank_ifsc ||
    b.ifsc_code ||
    b.ifsc ||
    b.bankIfsc ||
    stash?.bank_ifsc_code ||
    ''
  ).trim();

  const upiId = String(
    b.upi_id ||
    b.upiId ||
    b.upi ||
    stash?.upi_id ||
    ''
  ).trim();

  return {
    bankName,
    accountNumber,
    accountHolderName,
    ifsc,
    upiId,
  };
}

export interface TaxCalculationResult {
  items: UniversalItem[];
  subtotal: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  grandTotal: number;
  isIntraState: boolean;
  amountInWords: string;
}

export interface ResolvedBusinessProfile {
  id?: string;
  name?: string;
  legal_name?: string;
  legalName?: string;
  logo_url: string | null;
  logoUrl: string | null;
  signature_url: string | null;
  signatureUrl: string | null;
  stamp_url: string | null;
  stampUrl: string | null;
  signature_name: string;
  signatureName: string;
  invoice_signature_name: string;
  terms_quotations: string | null;
  termsQuotations: string | null;
  terms_sales_orders: string | null;
  termsSalesOrders: string | null;
  terms_invoices: string | null;
  termsInvoices: string | null;
  terms_purchase: string | null;
  termsPurchase: string | null;
  terms_payment_receipt: string | null;
  termsPaymentReceipt: string | null;
  invoice_footer_text: string | null;
  invoiceFooterText: string | null;
  [key: string]: any;
}

/**
 * Resolves business profile settings (signature/stamp image, signature name,
 * and document-type terms) from database fields with graceful fallbacks
 * to cached settings / localStorage.
 */
export function resolveBusinessProfile(business: any): ResolvedBusinessProfile {
  if (!business) {
    return {
      logo_url: null,
      logoUrl: null,
      signature_url: null,
      signatureUrl: null,
      stamp_url: null,
      stampUrl: null,
      signature_name: 'Authorized Signatory',
      signatureName: 'Authorized Signatory',
      invoice_signature_name: 'Authorized Signatory',
      terms_quotations: null,
      termsQuotations: null,
      terms_sales_orders: null,
      termsSalesOrders: null,
      terms_invoices: null,
      termsInvoices: null,
      terms_purchase: null,
      termsPurchase: null,
      terms_payment_receipt: null,
      termsPaymentReceipt: null,
      invoice_footer_text: null,
      invoiceFooterText: null,
    };
  }

  const id = business?.id;
  const stash = typeof window !== 'undefined' && id ? readBusinessColumnStash(id) : {};
  const extras = typeof window !== 'undefined' && id ? readBusinessExtras(id) : {};

  const logoUrl =
    business.logo_url ||
    business.logoUrl ||
    business.logo ||
    stash?.logo_url ||
    stash?.logoUrl ||
    stash?.logo ||
    (extras as any)?.logo_url ||
    (extras as any)?.logoUrl ||
    null;

  const signatureUrl =
    business.signature_url ||
    business.signatureUrl ||
    business.stamp_url ||
    business.stampUrl ||
    stash?.signature_url ||
    stash?.stamp_url ||
    null;

  const signatureName =
    business.signature_name ||
    business.signatureName ||
    business.invoice_signature_name ||
    business.invoiceSignatureName ||
    stash?.signature_name ||
    stash?.invoice_signature_name ||
    'Authorized Signatory';

  const termsQuotations =
    business.terms_quotations ||
    business.termsQuotations ||
    business.tnc_quotation ||
    (typeof window !== 'undefined' && id ? readTncCache(id, 'quotation') : '') ||
    stash?.terms_quotations ||
    stash?.tnc_quotation ||
    business.terms_and_conditions ||
    business.termsAndConditions ||
    null;

  const termsSalesOrders =
    business.terms_sales_orders ||
    business.termsSalesOrders ||
    business.tnc_sales_order ||
    (typeof window !== 'undefined' && id ? readTncCache(id, 'sales_order') : '') ||
    stash?.terms_sales_orders ||
    stash?.tnc_sales_order ||
    business.terms_and_conditions ||
    business.termsAndConditions ||
    null;

  const termsInvoices =
    business.terms_invoices ||
    business.termsInvoices ||
    business.tnc_invoice ||
    (typeof window !== 'undefined' && id ? readTncCache(id, 'sales_invoice') : '') ||
    stash?.terms_invoices ||
    stash?.tnc_invoice ||
    business.terms_and_conditions ||
    business.termsAndConditions ||
    null;

  const termsPurchase =
    business.terms_purchase ||
    business.termsPurchase ||
    business.tnc_purchase ||
    (typeof window !== 'undefined' && id ? readTncCache(id, 'purchase') : '') ||
    stash?.terms_purchase ||
    stash?.tnc_purchase ||
    business.terms_and_conditions ||
    business.termsAndConditions ||
    null;

  const termsPaymentReceipt =
    business.terms_payment_receipt ||
    business.termsPaymentReceipt ||
    business.tnc_payment_receipt ||
    (typeof window !== 'undefined' && id ? readTncCache(id, 'payment_receipt') : '') ||
    stash?.terms_payment_receipt ||
    stash?.tnc_payment_receipt ||
    null;

  const invoiceFooterText =
    business.invoice_footer_text ||
    business.invoiceFooterText ||
    stash?.invoice_footer_text ||
    null;

  return {
    ...extras,
    ...business,
    logo_url: logoUrl,
    logoUrl,
    signature_url: signatureUrl,
    signatureUrl,
    stamp_url: signatureUrl,
    stampUrl: signatureUrl,
    signature_name: signatureName,
    signatureName,
    invoice_signature_name: signatureName,
    terms_quotations: termsQuotations,
    termsQuotations,
    terms_sales_orders: termsSalesOrders,
    termsSalesOrders,
    terms_invoices: termsInvoices,
    termsInvoices,
    terms_purchase: termsPurchase,
    termsPurchase,
    terms_payment_receipt: termsPaymentReceipt,
    termsPaymentReceipt,
    invoice_footer_text: invoiceFooterText,
    invoiceFooterText,
  };
}

/**
 * Format customer or client address matching the company header layout:
 * - Line 1: street address (address || billing_address)
 * - Line 2: City, State - Pincode
 */
export function formatCustomerAddress(party: any): FormattedAddress {
  const cust = (Array.isArray(party) ? party[0] : party) || {};
  const streetAddress = String(
    cust.address ||
    cust.billing_address ||
    cust.billingAddress ||
    cust.addressLine1 ||
    ''
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
    streetAddress,
    cityStatePin,
    fullAddress,
  };
}

function cleanStateName(s?: string | null): string {
  if (!s) return '';
  return s
    .replace(/^\d+\s*[-–]\s*/, '')
    .replace(/\(\d+\)/g, '')
    .trim()
    .toLowerCase();
}

function roundTo2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isIntraStateSupply(
  businessState?: string | null,
  partyState?: string | null,
  doc?: any
): boolean {
  if (doc?.is_intra_state !== undefined) {
    return Boolean(doc.is_intra_state);
  }
  if (doc?.igst_amount !== undefined && Number(doc.igst_amount) > 0) {
    return false;
  }
  if (
    (doc?.cgst_amount !== undefined && Number(doc.cgst_amount) > 0) ||
    (doc?.sgst_amount !== undefined && Number(doc.sgst_amount) > 0)
  ) {
    return true;
  }
  const bState = cleanStateName(businessState);
  const pState = cleanStateName(partyState || doc?.place_of_supply);
  if (bState && pState) {
    return bState === pState;
  }
  return true;
}

export function calculateDocumentTotals(
  doc: any,
  rawItems: any[],
  businessState?: string | null,
  partyState?: string | null
): TaxCalculationResult {
  const isIntraState = isIntraStateSupply(businessState, partyState, doc);

  let calculatedTaxable = 0;
  let calculatedCgst = 0;
  let calculatedSgst = 0;
  let calculatedIgst = 0;

  const items: UniversalItem[] = (rawItems || []).map((item, idx) => {
    const qty = Number(item?.quantity ?? item?.qty ?? 1);
    const rate = Number(item?.rate ?? item?.unit_price ?? item?.price ?? item?.denomination ?? 0);
    const taxRate = Number(
      item?.tax_rate ??
      item?.gst_rate ??
      item?.tax_percentage ??
      item?.tax_percent ??
      0
    );

    const lineTaxable = roundTo2(Number(item?.taxable_amount ?? (qty * rate)));
    calculatedTaxable += lineTaxable;

    if (isIntraState) {
      const halfRate = taxRate / 2;
      calculatedCgst += roundTo2(lineTaxable * (halfRate / 100));
      calculatedSgst += roundTo2(lineTaxable * (halfRate / 100));
    } else {
      calculatedIgst += roundTo2(lineTaxable * (taxRate / 100));
    }

    const lineTotal = roundTo2(Number(
      item?.total_amount ??
      item?.totalPrice ??
      item?.total ??
      (lineTaxable + roundTo2(lineTaxable * (taxRate / 100)))
    ));

    return {
      id: item?.id ?? `item-${idx}`,
      name: item?.product_name || item?.name || 'Item',
      product_name: item?.product_name || item?.name || 'Item',
      description: item?.description,
      hsn_sac: item?.hsn_sac || item?.hsnSac || item?.hsn_code || '998434',
      hsn_code: item?.hsn_code || item?.hsn_sac || '998434',
      quantity: qty,
      unit: item?.unit || 'PCS',
      rate: rate,
      unit_price: rate,
      denomination: rate,
      tax_rate: taxRate,
      taxRate: taxRate,
      tax: (taxRate > 0 ? `${taxRate}%` : '0%') as unknown as number,
      taxable_amount: lineTaxable,
      total_amount: lineTotal,
      totalPrice: lineTotal,
      total: lineTotal,
      code: item?.code,
      recipientEmail: item?.recipientEmail,
    };
  });

  calculatedTaxable = roundTo2(calculatedTaxable);
  calculatedCgst = roundTo2(calculatedCgst);
  calculatedSgst = roundTo2(calculatedSgst);
  calculatedIgst = roundTo2(calculatedIgst);

  const subtotal = roundTo2(Number(
    doc?.subtotal ||
    doc?.taxable_amount ||
    calculatedTaxable
  ));

  const cgstAmount = isIntraState
    ? roundTo2(Number(doc?.cgst_amount) || calculatedCgst)
    : 0;

  const sgstAmount = isIntraState
    ? roundTo2(Number(doc?.sgst_amount) || calculatedSgst)
    : 0;

  const igstAmount = !isIntraState
    ? roundTo2(Number(doc?.igst_amount) || calculatedIgst)
    : 0;

  const totalTax = roundTo2(cgstAmount + sgstAmount + igstAmount);

  const grandTotal = roundTo2(Number(
    doc?.grand_total ||
    doc?.total_amount ||
    doc?.total ||
    (subtotal + totalTax)
  ));

  const amountInWords = numberToWordsINR(grandTotal);

  return {
    items,
    subtotal,
    taxableAmount: subtotal,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    grandTotal,
    isIntraState,
    amountInWords,
  };
}

export function mapSalesOrderToUniversalData(
  business: any,
  order: any,
  items: any[] = []
): UniversalDocumentData {
  const persistedNumber = order?.order_number || order?.number || 'SO-001';
  const cust = (Array.isArray(order?.customer) ? order?.customer[0] : order?.customer) || order?.client || {};
  const formattedAddr = formatCustomerAddress(cust);
  const streetAddress = formattedAddr.streetAddress || order?.customer_address || order?.party_address || '';
  const fullAddress = formattedAddr.fullAddress || streetAddress;

  const rawItems = (items && items.length > 0)
    ? items
    : (order?.items || order?.sales_order_items || []);

  const businessState = business?.state || business?.billingState || '';
  const partyState = cust?.state || cust?.billingState || order?.place_of_supply || '';

  const totals = calculateDocumentTotals(order, rawItems, businessState, partyState);

  const resolvedBiz = resolveBusinessProfile(business);
  const signatureUrl =
    business?.signature_url ||
    business?.signatureUrl ||
    business?.stamp_url ||
    business?.stampUrl ||
    resolvedBiz?.signature_url ||
    null;
  const signatureName =
    business?.signature_name ||
    business?.signatureName ||
    business?.invoice_signature_name ||
    business?.invoiceSignatureName ||
    resolvedBiz?.signature_name ||
    'Authorized Signatory';
  const bankDetails = extractBankDetails(business);
  const companyObj = {
    ...business,
    ...resolvedBiz,
    bankName: bankDetails.bankName,
    bank_name: bankDetails.bankName,
    accountNumber: bankDetails.accountNumber,
    bank_account_no: bankDetails.accountNumber,
    bank_account_number: bankDetails.accountNumber,
    account_number: bankDetails.accountNumber,
    accountHolderName: bankDetails.accountHolderName,
    account_holder_name: bankDetails.accountHolderName,
    account_name: bankDetails.accountHolderName,
    ifsc: bankDetails.ifsc,
    bank_ifsc: bankDetails.ifsc,
    bank_ifsc_code: bankDetails.ifsc,
    upiId: bankDetails.upiId,
    upi_id: bankDetails.upiId,
    bankDetails,
    signatureUrl,
    signature_url: signatureUrl,
    signatureName,
    signature_name: signatureName,
    stampUrl: signatureUrl,
    stamp_url: signatureUrl,
    logoUrl: resolvedBiz.logoUrl,
    logo_url: resolvedBiz.logo_url,
  };
  const dynamicTerms =
    order?.terms ||
    business?.terms_sales_orders ||
    business?.termsSalesOrders ||
    business?.tnc_sales_order ||
    resolvedBiz?.terms_sales_orders ||
    business?.terms_and_conditions ||
    business?.termsAndConditions ||
    null;

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
    dueDate: order?.due_date || order?.expected_date || null,
    placeOfSupply: order?.place_of_supply || cust.state || business?.state,
    company: companyObj,
    seller: companyObj,
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
      address: fullAddress || streetAddress,
      streetAddress,
      city: cust.city,
      state: cust.state,
      pincode: cust.pincode || cust.pin_code,
      gstin: cust.gstin || order?.customer_gstin || order?.party_gstin,
      pan: cust.pan || (cust.gstin && cust.gstin.length >= 12 ? cust.gstin.slice(2, 12) : undefined),
      aadhaar: cust.aadhaar || undefined,
      phone: cust.phone || order?.customer_phone || order?.party_phone,
      email: cust.email || order?.customer_email,
    },
    buyer: {
      name: String(cust.name || cust.company_name || '').trim(),
      address: fullAddress || streetAddress,
      city: cust.city,
      state: cust.state,
      pincode: cust.pincode || cust.pin_code,
      gstin: cust.gstin || order?.customer_gstin,
      pan: cust.pan || (cust.gstin && cust.gstin.length >= 12 ? cust.gstin.slice(2, 12) : undefined),
      aadhaar: cust.aadhaar || undefined,
    },
    items: totals.items,
    subtotal: totals.subtotal,
    taxableAmount: totals.taxableAmount,
    tax: totals.totalTax,
    taxAmount: totals.totalTax,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    cgst: totals.cgstAmount,
    sgst: totals.sgstAmount,
    igst: totals.igstAmount,
    isIntraState: totals.isIntraState,
    discount: Number(order?.discount_amount || order?.discount || 0),
    roundOff: Number(order?.round_off || 0),
    totalAmount: totals.grandTotal,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
    bankDetails,
    notes: order?.notes || null,
    terms: dynamicTerms,
    invoiceFooterText: companyObj.invoiceFooterText || companyObj.invoice_footer_text || null,
    invoice_footer_text: companyObj.invoice_footer_text || null,
  };
}

export function mapSalesInvoiceToUniversalData(
  business: any,
  invoice: any,
  items: any[] = []
): UniversalDocumentData {
  const persistedNumber = invoice?.invoice_number || invoice?.number || 'INV-001';
  const cust = (Array.isArray(invoice?.customer) ? invoice?.customer[0] : invoice?.customer) || invoice?.client || {};
  const formattedAddr = formatCustomerAddress(cust);
  const streetAddress = formattedAddr.streetAddress || invoice?.customer_address || invoice?.party_address || '';
  const fullAddress = formattedAddr.fullAddress || streetAddress;

  const rawItems = (items && items.length > 0)
    ? items
    : (invoice?.items || invoice?.sales_invoice_items || []);

  const businessState = business?.state || business?.billingState || '';
  const partyState = cust?.state || cust?.billingState || invoice?.place_of_supply || '';

  const totals = calculateDocumentTotals(invoice, rawItems, businessState, partyState);

  const resolvedBiz = resolveBusinessProfile(business);
  const signatureUrl =
    business?.signature_url ||
    business?.signatureUrl ||
    business?.stamp_url ||
    business?.stampUrl ||
    resolvedBiz?.signature_url ||
    null;
  const signatureName =
    business?.signature_name ||
    business?.signatureName ||
    business?.invoice_signature_name ||
    business?.invoiceSignatureName ||
    resolvedBiz?.signature_name ||
    'Authorized Signatory';
  const bankDetails = extractBankDetails(business);
  const companyObj = {
    ...business,
    ...resolvedBiz,
    bankName: bankDetails.bankName,
    bank_name: bankDetails.bankName,
    accountNumber: bankDetails.accountNumber,
    bank_account_no: bankDetails.accountNumber,
    bank_account_number: bankDetails.accountNumber,
    account_number: bankDetails.accountNumber,
    accountHolderName: bankDetails.accountHolderName,
    account_holder_name: bankDetails.accountHolderName,
    account_name: bankDetails.accountHolderName,
    ifsc: bankDetails.ifsc,
    bank_ifsc: bankDetails.ifsc,
    bank_ifsc_code: bankDetails.ifsc,
    upiId: bankDetails.upiId,
    upi_id: bankDetails.upiId,
    bankDetails,
    signatureUrl,
    signature_url: signatureUrl,
    signatureName,
    signature_name: signatureName,
    stampUrl: signatureUrl,
    stamp_url: signatureUrl,
    logoUrl: resolvedBiz.logoUrl,
    logo_url: resolvedBiz.logo_url,
  };
  const dynamicTerms =
    invoice?.terms ||
    business?.terms_invoices ||
    business?.termsInvoices ||
    business?.tnc_invoice ||
    resolvedBiz?.terms_invoices ||
    business?.terms_and_conditions ||
    business?.termsAndConditions ||
    null;

  return {
    documentType: 'TAX_INVOICE',
    documentNumber: persistedNumber,
    invoiceNumber: persistedNumber,
    date: invoice?.invoice_date || invoice?.created_at || '19 Oct 2026, 12:34 pm',
    invoice_date: invoice?.invoice_date,
    time: invoice?.invoice_time || invoice?.time,
    invoice_time: invoice?.invoice_time || invoice?.time,
    created_at: invoice?.created_at,
    status: invoice?.status || 'Confirmed',
    dueDate: invoice?.due_date || null,
    placeOfSupply: invoice?.place_of_supply || cust.state || business?.state,
    company: companyObj,
    seller: companyObj,
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
      address: fullAddress || streetAddress,
      streetAddress,
      city: cust.city,
      state: cust.state,
      pincode: cust.pincode || cust.pin_code,
      gstin: cust.gstin || invoice?.customer_gstin || invoice?.party_gstin,
      pan: cust.pan || (cust.gstin && cust.gstin.length >= 12 ? cust.gstin.slice(2, 12) : undefined),
      aadhaar: cust.aadhaar || undefined,
      phone: cust.phone || invoice?.customer_phone || invoice?.party_phone,
      email: cust.email || invoice?.customer_email,
    },
    buyer: {
      name: String(cust.name || cust.company_name || '').trim(),
      address: fullAddress || streetAddress,
      city: cust.city,
      state: cust.state,
      pincode: cust.pincode || cust.pin_code,
      gstin: cust.gstin || invoice?.customer_gstin,
      pan: cust.pan || (cust.gstin && cust.gstin.length >= 12 ? cust.gstin.slice(2, 12) : undefined),
      aadhaar: cust.aadhaar || undefined,
    },
    items: totals.items,
    subtotal: totals.subtotal,
    taxableAmount: totals.taxableAmount,
    tax: totals.totalTax,
    taxAmount: totals.totalTax,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    cgst: totals.cgstAmount,
    sgst: totals.sgstAmount,
    igst: totals.igstAmount,
    isIntraState: totals.isIntraState,
    discount: Number(invoice?.discount_amount || invoice?.discount || 0),
    roundOff: Number(invoice?.round_off || 0),
    totalAmount: totals.grandTotal,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
    bankDetails,
    notes: invoice?.notes || null,
    terms: dynamicTerms,
    invoiceFooterText: companyObj.invoiceFooterText || companyObj.invoice_footer_text || null,
    invoice_footer_text: companyObj.invoice_footer_text || null,
    paymentMethod: invoice?.payment_method || null,
    paymentStatus: invoice?.payment_status || null,
  };
}

export function mapQuotationToUniversalData(
  business: any,
  quote: any,
  items: any[] = []
): UniversalDocumentData {
  const persistedNumber = quote?.quotation_number || quote?.number || 'QT-001';
  const cust = (Array.isArray(quote?.customer) ? quote?.customer[0] : quote?.customer) || quote?.client || {};
  const formattedAddr = formatCustomerAddress(cust);
  const streetAddress = formattedAddr.streetAddress || quote?.customer_address || quote?.party_address || '';
  const fullAddress = formattedAddr.fullAddress || streetAddress;

  const rawItems = (items && items.length > 0)
    ? items
    : (quote?.items || quote?.quotation_items || []);

  const businessState = business?.state || business?.billingState || '';
  const partyState = cust?.state || cust?.billingState || quote?.place_of_supply || '';

  const totals = calculateDocumentTotals(quote, rawItems, businessState, partyState);

  const resolvedBiz = resolveBusinessProfile(business);
  const signatureUrl =
    business?.signature_url ||
    business?.signatureUrl ||
    business?.stamp_url ||
    business?.stampUrl ||
    resolvedBiz?.signature_url ||
    null;
  const signatureName =
    business?.signature_name ||
    business?.signatureName ||
    business?.invoice_signature_name ||
    business?.invoiceSignatureName ||
    resolvedBiz?.signature_name ||
    'Authorized Signatory';
  const bankDetails = extractBankDetails(business);
  const companyObj = {
    ...business,
    ...resolvedBiz,
    bankName: bankDetails.bankName,
    bank_name: bankDetails.bankName,
    accountNumber: bankDetails.accountNumber,
    bank_account_no: bankDetails.accountNumber,
    bank_account_number: bankDetails.accountNumber,
    account_number: bankDetails.accountNumber,
    accountHolderName: bankDetails.accountHolderName,
    account_holder_name: bankDetails.accountHolderName,
    account_name: bankDetails.accountHolderName,
    ifsc: bankDetails.ifsc,
    bank_ifsc: bankDetails.ifsc,
    bank_ifsc_code: bankDetails.ifsc,
    upiId: bankDetails.upiId,
    upi_id: bankDetails.upiId,
    bankDetails,
    signatureUrl,
    signature_url: signatureUrl,
    signatureName,
    signature_name: signatureName,
    stampUrl: signatureUrl,
    stamp_url: signatureUrl,
    logoUrl: resolvedBiz.logoUrl,
    logo_url: resolvedBiz.logo_url,
  };
  const dynamicTerms =
    quote?.terms ||
    business?.terms_quotations ||
    business?.termsQuotations ||
    business?.tnc_quotation ||
    resolvedBiz?.terms_quotations ||
    business?.terms_and_conditions ||
    business?.termsAndConditions ||
    null;

  return {
    documentType: 'QUOTATION',
    documentNumber: persistedNumber,
    orderNumber: persistedNumber,
    date: quote?.quotation_date || quote?.quote_date || quote?.created_at || '19 Oct 2026, 12:34 pm',
    time: quote?.quotation_time || quote?.time,
    created_at: quote?.created_at,
    status: quote?.status || 'Draft',
    expiryDate: quote?.expiry_date || quote?.valid_until || null,
    dueDate: quote?.due_date || quote?.expiry_date || null,
    placeOfSupply: quote?.place_of_supply || cust.state || business?.state,
    company: companyObj,
    seller: companyObj,
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
      address: fullAddress || streetAddress,
      streetAddress,
      city: cust.city,
      state: cust.state,
      pincode: cust.pincode || cust.pin_code,
      gstin: cust.gstin || quote?.customer_gstin || quote?.party_gstin,
      pan: cust.pan || (cust.gstin && cust.gstin.length >= 12 ? cust.gstin.slice(2, 12) : undefined),
      aadhaar: cust.aadhaar || undefined,
      phone: cust.phone || quote?.customer_phone || quote?.party_phone,
      email: cust.email || quote?.customer_email,
    },
    buyer: {
      name: String(cust.name || cust.company_name || '').trim(),
      address: fullAddress || streetAddress,
      city: cust.city,
      state: cust.state,
      pincode: cust.pincode || cust.pin_code,
      gstin: cust.gstin || quote?.customer_gstin,
      pan: cust.pan || (cust.gstin && cust.gstin.length >= 12 ? cust.gstin.slice(2, 12) : undefined),
      aadhaar: cust.aadhaar || undefined,
    },
    items: totals.items,
    subtotal: totals.subtotal,
    taxableAmount: totals.taxableAmount,
    tax: totals.totalTax,
    taxAmount: totals.totalTax,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    cgst: totals.cgstAmount,
    sgst: totals.sgstAmount,
    igst: totals.igstAmount,
    isIntraState: totals.isIntraState,
    discount: Number(quote?.discount_amount || quote?.discount || 0),
    roundOff: Number(quote?.round_off || 0),
    totalAmount: totals.grandTotal,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
    bankDetails,
    notes: quote?.notes || null,
    terms: dynamicTerms,
    invoiceFooterText: companyObj.invoiceFooterText || companyObj.invoice_footer_text || null,
    invoice_footer_text: companyObj.invoice_footer_text || null,
  };
}

export function mapPurchaseOrderToUniversalData(
  business: any,
  order: any,
  items: any[] = []
): UniversalDocumentData {
  const persistedNumber = order?.order_number || order?.po_number || order?.number || 'PO-001';
  const supplier = (Array.isArray(order?.supplier) ? order?.supplier[0] : order?.supplier) || order?.vendor || {};
  const formattedAddr = formatCustomerAddress(supplier);
  const streetAddress = formattedAddr.streetAddress || order?.supplier_address || '';
  const fullAddress = formattedAddr.fullAddress || streetAddress;

  const rawItems = (items && items.length > 0)
    ? items
    : (order?.items || order?.purchase_order_items || []);

  const businessState = business?.state || business?.billingState || '';
  const partyState = supplier?.state || supplier?.billingState || '';

  const totals = calculateDocumentTotals(order, rawItems, businessState, partyState);

  const resolvedBiz = resolveBusinessProfile(business);
  const signatureUrl =
    business?.signature_url ||
    business?.signatureUrl ||
    business?.stamp_url ||
    business?.stampUrl ||
    resolvedBiz?.signature_url ||
    null;
  const signatureName =
    business?.signature_name ||
    business?.signatureName ||
    business?.invoice_signature_name ||
    business?.invoiceSignatureName ||
    resolvedBiz?.signature_name ||
    'Authorized Signatory';
  const bankDetails = extractBankDetails(business);
  const companyObj = {
    ...business,
    ...resolvedBiz,
    bankName: bankDetails.bankName,
    bank_name: bankDetails.bankName,
    accountNumber: bankDetails.accountNumber,
    bank_account_no: bankDetails.accountNumber,
    bank_account_number: bankDetails.accountNumber,
    account_number: bankDetails.accountNumber,
    accountHolderName: bankDetails.accountHolderName,
    account_holder_name: bankDetails.accountHolderName,
    account_name: bankDetails.accountHolderName,
    ifsc: bankDetails.ifsc,
    bank_ifsc: bankDetails.ifsc,
    bank_ifsc_code: bankDetails.ifsc,
    upiId: bankDetails.upiId,
    upi_id: bankDetails.upiId,
    bankDetails,
    signatureUrl,
    signature_url: signatureUrl,
    signatureName,
    signature_name: signatureName,
    stampUrl: signatureUrl,
    stamp_url: signatureUrl,
    logoUrl: resolvedBiz.logoUrl,
    logo_url: resolvedBiz.logo_url,
  };
  const dynamicTerms =
    order?.terms ||
    business?.terms_purchase ||
    business?.termsPurchase ||
    business?.tnc_purchase ||
    resolvedBiz?.terms_purchase ||
    resolvedBiz?.terms_quotations ||
    business?.terms_and_conditions ||
    business?.termsAndConditions ||
    null;

  return {
    documentType: 'PURCHASE_ORDER',
    documentNumber: persistedNumber,
    date: order?.order_date || order?.created_at || '19 Oct 2026, 12:34 pm',
    time: order?.order_time || order?.time,
    created_at: order?.created_at,
    status: order?.status || 'Confirmed',
    dueDate: order?.due_date || order?.expected_date || null,
    company: companyObj,
    buyer: companyObj,
    seller: {
      name: supplier.name || order?.supplier_name || 'Supplier',
      companyName: supplier.company_name || supplier.name || order?.supplier_name,
      address: fullAddress || streetAddress || order?.supplier_address,
      streetAddress: streetAddress || order?.supplier_address,
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode || supplier.pin_code,
      gstin: supplier.gstin || order?.supplier_gstin,
      phone: supplier.phone || order?.supplier_phone,
      email: supplier.email || order?.supplier_email,
    },
    customer: {
      name: supplier.name || order?.supplier_name || 'Supplier',
      companyName: supplier.company_name || supplier.name || order?.supplier_name,
      address: fullAddress || streetAddress || order?.supplier_address,
      streetAddress: streetAddress || order?.supplier_address,
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode || supplier.pin_code,
      gstin: supplier.gstin || order?.supplier_gstin,
      phone: supplier.phone || order?.supplier_phone,
      email: supplier.email || order?.supplier_email,
    },
    items: totals.items,
    subtotal: totals.subtotal,
    taxableAmount: totals.taxableAmount,
    tax: totals.totalTax,
    taxAmount: totals.totalTax,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    cgst: totals.cgstAmount,
    sgst: totals.sgstAmount,
    igst: totals.igstAmount,
    isIntraState: totals.isIntraState,
    discount: Number(order?.discount_amount || order?.discount || 0),
    roundOff: Number(order?.round_off || 0),
    totalAmount: totals.grandTotal,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
    bankDetails,
    notes: order?.notes || null,
    terms: dynamicTerms,
    invoiceFooterText: companyObj.invoiceFooterText || companyObj.invoice_footer_text || null,
    invoice_footer_text: companyObj.invoice_footer_text || null,
  };
}

export function mapPurchaseBillToUniversalData(
  business: any,
  bill: any,
  items: any[] = []
): UniversalDocumentData {
  const persistedNumber = bill?.bill_number || bill?.number || 'BILL-001';
  const supplier = (Array.isArray(bill?.supplier) ? bill?.supplier[0] : bill?.supplier) || bill?.vendor || {};
  const formattedAddr = formatCustomerAddress(supplier);
  const streetAddress = formattedAddr.streetAddress || bill?.supplier_address || '';
  const fullAddress = formattedAddr.fullAddress || streetAddress;

  const rawItems = (items && items.length > 0)
    ? items
    : (bill?.items || bill?.purchase_bill_items || []);

  const businessState = business?.state || business?.billingState || '';
  const partyState = supplier?.state || supplier?.billingState || '';

  const totals = calculateDocumentTotals(bill, rawItems, businessState, partyState);

  const buyerAddr = formatCustomerAddress(business);
  const buyerStreet = buyerAddr.streetAddress || business?.address || business?.registered_address || '';
  const buyerFullAddr = buyerAddr.fullAddress || buyerStreet;

  return {
    documentType: 'PURCHASE_BILL',
    documentNumber: persistedNumber,
    date: bill?.bill_date || bill?.created_at || '19 Oct 2026, 12:34 pm',
    time: bill?.bill_time || bill?.time,
    created_at: bill?.created_at,
    status: bill?.status || 'Confirmed',
    dueDate: bill?.due_date || null,
    isPurchaseBill: true,
    company: {
      name: bill?.supplier_name || supplier.name || 'Supplier',
      address: fullAddress || streetAddress || supplier.address,
      streetAddress: streetAddress || supplier.address,
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode || supplier.pin_code,
      gstin: supplier.gstin || bill?.supplier_gstin,
      phone: supplier.phone || bill?.supplier_phone,
      email: supplier.email || bill?.supplier_email,
    },
    seller: {
      name: bill?.supplier_name || supplier.name || 'Supplier',
      address: fullAddress || streetAddress || supplier.address,
      streetAddress: streetAddress || supplier.address,
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode || supplier.pin_code,
      gstin: supplier.gstin || bill?.supplier_gstin,
      phone: supplier.phone || bill?.supplier_phone,
      email: supplier.email || bill?.supplier_email,
    },
    customer: {
      ...business,
      name: business?.name || business?.legal_name || 'Buyer',
      companyName: business?.legal_name || business?.name,
      address: buyerFullAddr || business?.address,
      streetAddress: buyerStreet || business?.streetAddress || business?.address,
      city: business?.city || business?.billing_city || business?.billingCity,
      state: business?.state || business?.billing_state || business?.billingState,
      pincode: business?.pincode || business?.pin_code || business?.billing_pincode || business?.billingPincode,
      gstin: business?.gstin,
      pan: business?.pan || (business?.gstin && business.gstin.length >= 12 ? business.gstin.slice(2, 12) : undefined),
      phone: business?.phone || business?.mobile || business?.phone_number,
      email: business?.email || business?.email_address,
    },
    buyer: {
      ...business,
      name: business?.name || business?.legal_name || 'Buyer',
      companyName: business?.legal_name || business?.name,
      address: buyerFullAddr || business?.address,
      streetAddress: buyerStreet || business?.streetAddress || business?.address,
      city: business?.city || business?.billing_city || business?.billingCity,
      state: business?.state || business?.billing_state || business?.billingState,
      pincode: business?.pincode || business?.pin_code || business?.billing_pincode || business?.billingPincode,
      gstin: business?.gstin,
      pan: business?.pan || (business?.gstin && business.gstin.length >= 12 ? business.gstin.slice(2, 12) : undefined),
      phone: business?.phone || business?.mobile || business?.phone_number,
      email: business?.email || business?.email_address,
    },
    items: totals.items,
    subtotal: totals.subtotal,
    taxableAmount: totals.taxableAmount,
    tax: totals.totalTax,
    taxAmount: totals.totalTax,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    igstAmount: totals.igstAmount,
    cgst: totals.cgstAmount,
    sgst: totals.sgstAmount,
    igst: totals.igstAmount,
    isIntraState: totals.isIntraState,
    discount: Number(bill?.discount_amount || bill?.discount || 0),
    roundOff: Number(bill?.round_off || 0),
    totalAmount: totals.grandTotal,
    grandTotal: totals.grandTotal,
    amountInWords: totals.amountInWords,
    notes: bill?.notes || null,
    terms: bill?.terms || null,
  };
}
