import React from 'react';
import {
  UniversalDocumentTemplate,
  mapQuotationToUniversalData,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

export interface QuotationPrintProps {
  data?: UniversalDocumentData;
  business?: any;
  quote?: any;
  items?: any[];
  className?: string;
  id?: string;
}

export const QuotationPrint: React.FC<QuotationPrintProps> = ({
  data,
  business,
  quote,
  items = [],
  className,
  id = 'quotation-printable-area',
}) => {
  const documentData =
    data ||
    (business && quote
      ? mapQuotationToUniversalData(business, quote, items)
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
