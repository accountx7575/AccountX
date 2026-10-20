import React from 'react';
import {
  UniversalDocumentTemplate,
  mapPurchaseOrderToUniversalData,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

export interface PurchaseOrderPrintProps {
  data?: UniversalDocumentData;
  business?: any;
  order?: any;
  items?: any[];
  className?: string;
  id?: string;
}

export const PurchaseOrderPrint: React.FC<PurchaseOrderPrintProps> = ({
  data,
  business,
  order,
  items = [],
  className,
  id = 'purchase-order-printable-area',
}) => {
  const documentData =
    data ||
    (business && order
      ? mapPurchaseOrderToUniversalData(business, order, items)
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
