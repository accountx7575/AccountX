import React from 'react';
import {
  UniversalDocumentTemplate,
  mapPurchaseBillToUniversalData,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

export interface PurchaseBillPrintProps {
  data?: UniversalDocumentData;
  business?: any;
  bill?: any;
  items?: any[];
  className?: string;
  id?: string;
}

export const PurchaseBillPrint: React.FC<PurchaseBillPrintProps> = ({
  data,
  business,
  bill,
  items = [],
  className,
  id = 'purchase-bill-printable-area',
}) => {
  const documentData =
    data ||
    (business && bill
      ? mapPurchaseBillToUniversalData(business, bill, items)
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
