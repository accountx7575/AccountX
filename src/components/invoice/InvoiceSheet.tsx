import { buildUpiUri } from '@/lib/upi';
import type { Business, SalesInvoice, SalesInvoiceItem, Customer } from '@/types/db';
import {
  UniversalDocumentTemplate,
  mapSalesInvoiceToUniversalData,
} from '@/components/documents/UniversalDocumentTemplate';

export type InvoiceWithCustomer = SalesInvoice & { customer: Customer | null };

export { buildUpiUri };

export type InvoiceSheetProps = {
  business: Business | null;
  invoice: InvoiceWithCustomer;
  items: SalesInvoiceItem[];
  ewayBillNo?: string | null;
  vehicleNo?: string | null;
  id?: string;
  className?: string;
};

/**
 * Shared printable A4 GST tax-invoice document powered by UniversalDocumentTemplate.
 * Light-only styling by design so browser print and PDF capture are theme-independent.
 * Reused by: SalesInvoiceViewPage (print/PDF source) and SalesInvoiceCreatePage (live preview).
 */
export function InvoiceSheet({
  business,
  invoice,
  items,
  ewayBillNo,
  vehicleNo,
  id = 'invoice-print-area',
  className = '',
}: InvoiceSheetProps) {
  const data = mapSalesInvoiceToUniversalData(business, invoice, items);

  if (ewayBillNo || vehicleNo) {
    const ewayInfo = [
      ewayBillNo ? `e-Way Bill No: ${ewayBillNo}` : '',
      vehicleNo ? `Vehicle No: ${vehicleNo}` : '',
    ]
      .filter(Boolean)
      .join(' • ');
    data.taxNote = data.taxNote ? `${data.taxNote} | ${ewayInfo}` : ewayInfo;
  }

  return (
    <UniversalDocumentTemplate
      data={data}
      id={id}
      className={className}
    />
  );
}
