import React from 'react';
import {
  UniversalDocumentTemplate,
  mapSalesInvoiceToUniversalData,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

export interface SaleInvoicePrintProps {
  data?: UniversalDocumentData;
  business?: any;
  invoice?: any;
  items?: any[];
  className?: string;
  id?: string;
}

export const SaleInvoicePrint: React.FC<SaleInvoicePrintProps> = ({
  data,
  business,
  invoice,
  items = [],
  className,
  id = 'sale-invoice-printable-area',
}) => {
  const documentData =
    data ||
    (business && invoice
      ? mapSalesInvoiceToUniversalData(business, invoice, items)
      : null);

  if (!documentData) return null;

  return (
    <UniversalDocumentTemplate
      data={documentData}
      className={className}
      id={id}
    />
  );
};
