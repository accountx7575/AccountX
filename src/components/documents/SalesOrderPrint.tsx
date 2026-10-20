import React from 'react';
import {
  UniversalDocumentTemplate,
  mapSalesOrderToUniversalData,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

export interface SalesOrderPrintProps {
  data?: UniversalDocumentData;
  business?: any;
  order?: any;
  items?: any[];
  className?: string;
  id?: string;
}

export const SalesOrderPrint: React.FC<SalesOrderPrintProps> = ({
  data,
  business,
  order,
  items = [],
  className,
  id = 'sales-order-printable-area',
}) => {
  const documentData =
    data ||
    (business && order
      ? mapSalesOrderToUniversalData(business, order, items)
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
