import { createRoot } from 'react-dom/client';
import { supabase } from '@/lib/supabase';
import { mergeBusinessExtras } from '@/lib/businessExtras';
import {
  UniversalDocumentTemplate,
  printElementInIframe,
  type UniversalDocumentData,
} from '@/components/documents/UniversalDocumentTemplate';
import { captureElementToPdf } from '@/lib/pdfCapture';
import {
  mapQuotationToUniversalData,
  mapSalesOrderToUniversalData,
  mapSalesInvoiceToUniversalData,
  mapPurchaseOrderToUniversalData,
  mapPurchaseBillToUniversalData,
} from '@/lib/documentMappers';

export type DocumentActionType =
  | 'quotation'
  | 'sales_order'
  | 'sales_invoice'
  | 'purchase_order'
  | 'purchase_bill';

export interface DocumentPayloadResult {
  data: UniversalDocumentData;
  filename: string;
  title: string;
}

export function getDocumentViewPath(type: DocumentActionType, id: string): string {
  switch (type) {
    case 'quotation':
      return `/app/quotations/${id}`;
    case 'sales_order':
      return `/app/sales-orders/${id}`;
    case 'sales_invoice':
      return `/app/sales-invoices/${id}`;
    case 'purchase_order':
      return `/app/purchase-orders/${id}`;
    case 'purchase_bill':
      return `/app/purchase-bills/${id}`;
  }
}

export function resolveUniversalDocumentFromPayload(
  type: DocumentActionType,
  doc: any,
  items: any[],
  activeBusiness: any
): DocumentPayloadResult {
  const resolvedBusiness =
    mergeBusinessExtras(activeBusiness, activeBusiness?.id || '') || activeBusiness;

  switch (type) {
    case 'quotation': {
      const data = mapQuotationToUniversalData(resolvedBusiness, doc, items);
      const docNum = doc?.quotation_number || 'Quotation';
      return {
        data,
        filename: `${docNum}.pdf`,
        title: `Quotation ${docNum}`.trim(),
      };
    }
    case 'sales_order': {
      const data = mapSalesOrderToUniversalData(resolvedBusiness, doc, items);
      const docNum = doc?.order_number || 'SalesOrder';
      return {
        data,
        filename: `${docNum}.pdf`,
        title: `Sales Order ${docNum}`.trim(),
      };
    }
    case 'sales_invoice': {
      const data = mapSalesInvoiceToUniversalData(resolvedBusiness, doc, items);
      const docNum = doc?.invoice_number || 'Invoice';
      return {
        data,
        filename: `${docNum}.pdf`,
        title: `Tax Invoice ${docNum}`.trim(),
      };
    }
    case 'purchase_order': {
      const data = mapPurchaseOrderToUniversalData(resolvedBusiness, doc, items);
      const docNum = doc?.order_number || 'PurchaseOrder';
      return {
        data,
        filename: `${docNum}.pdf`,
        title: `Purchase Order ${docNum}`.trim(),
      };
    }
    case 'purchase_bill': {
      const data = mapPurchaseBillToUniversalData(resolvedBusiness, doc, items);
      const docNum = doc?.bill_number || 'PurchaseBill';
      return {
        data,
        filename: `${docNum}.pdf`,
        title: `Purchase Bill ${docNum}`.trim(),
      };
    }
  }
}

export async function fetchDocumentPayload(
  type: DocumentActionType,
  id: string,
  activeBusiness: any
): Promise<DocumentPayloadResult> {
  let business = activeBusiness;
  if (activeBusiness?.id) {
    const { data: b } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', activeBusiness.id)
      .maybeSingle();
    if (b) business = { ...activeBusiness, ...b };
  }
  const resolvedBusiness =
    mergeBusinessExtras(business, business?.id || '') || business;

  switch (type) {
    case 'quotation': {
      let quote: any = null;
      const { data: q1, error: q1Err } = await supabase
        .from('quotations')
        .select('*, customer:customer_id(*)')
        .eq('id', id)
        .maybeSingle();

      if (!q1Err && q1) {
        quote = q1;
      } else {
        const { data: q2 } = await supabase
          .from('quotations')
          .select('*, customer:customers(*)')
          .eq('id', id)
          .maybeSingle();
        if (q2) {
          quote = q2;
        } else {
          const { data: q3 } = await supabase
            .from('quotations')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          quote = q3;
        }
      }

      if (quote && !quote.customer && quote.customer_id) {
        const { data: cust } = await supabase
          .from('customers')
          .select(
            'id, name, business_name, email, phone, gstin, address, billing_address, city, state, pincode, pin_code'
          )
          .eq('id', quote.customer_id)
          .maybeSingle();
        if (cust) quote.customer = cust;
      }

      const { data: items } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('quotation_id', id)
        .order('created_at');

      return resolveUniversalDocumentFromPayload(
        type,
        quote || { id },
        items || [],
        resolvedBusiness
      );
    }

    case 'sales_order': {
      let order: any = null;
      const { data: o1, error: o1Err } = await supabase
        .from('sales_orders')
        .select('*, customer:customer_id(*)')
        .eq('id', id)
        .maybeSingle();

      if (!o1Err && o1) {
        order = o1;
      } else {
        const { data: o2 } = await supabase
          .from('sales_orders')
          .select('*, customer:customers(*)')
          .eq('id', id)
          .maybeSingle();
        if (o2) {
          order = o2;
        } else {
          const { data: o3 } = await supabase
            .from('sales_orders')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          order = o3;
        }
      }

      if (order && !order.customer && order.customer_id) {
        const { data: cust } = await supabase
          .from('customers')
          .select(
            'id, name, business_name, email, phone, gstin, address, billing_address, city, state, pincode, pin_code'
          )
          .eq('id', order.customer_id)
          .maybeSingle();
        if (cust) order.customer = cust;
      }

      const { data: items } = await supabase
        .from('sales_order_items')
        .select('*')
        .eq('sales_order_id', id)
        .order('created_at');

      return resolveUniversalDocumentFromPayload(
        type,
        order || { id },
        items || [],
        resolvedBusiness
      );
    }

    case 'sales_invoice': {
      let invoice: any = null;
      const { data: inv1, error: inv1Err } = await supabase
        .from('sales_invoices')
        .select('*, customer:customer_id(*)')
        .eq('id', id)
        .maybeSingle();

      if (!inv1Err && inv1) {
        invoice = inv1;
      } else {
        const { data: inv2 } = await supabase
          .from('sales_invoices')
          .select('*, customer:customers(*)')
          .eq('id', id)
          .maybeSingle();
        if (inv2) {
          invoice = inv2;
        } else {
          const { data: inv3 } = await supabase
            .from('sales_invoices')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          invoice = inv3;
        }
      }

      if (invoice && !invoice.customer && invoice.customer_id) {
        const { data: cust } = await supabase
          .from('customers')
          .select(
            'id, name, business_name, email, phone, gstin, address, billing_address, city, state, pincode, pin_code'
          )
          .eq('id', invoice.customer_id)
          .maybeSingle();
        if (cust) invoice.customer = cust;
      }

      const { data: items } = await supabase
        .from('sales_invoice_items')
        .select('*')
        .eq('invoice_id', id)
        .order('created_at');

      return resolveUniversalDocumentFromPayload(
        type,
        invoice || { id },
        items || [],
        resolvedBusiness
      );
    }

    case 'purchase_order': {
      let po: any = null;
      const { data: po1, error: po1Err } = await supabase
        .from('purchase_orders')
        .select('*, supplier:supplier_id(*)')
        .eq('id', id)
        .maybeSingle();

      if (!po1Err && po1) {
        po = po1;
      } else {
        const { data: po2 } = await supabase
          .from('purchase_orders')
          .select('*, supplier:suppliers(*)')
          .eq('id', id)
          .maybeSingle();
        if (po2) {
          po = po2;
        } else {
          const { data: po3 } = await supabase
            .from('purchase_orders')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          po = po3;
        }
      }

      if (po && !po.supplier && po.supplier_id) {
        const { data: supp } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', po.supplier_id)
          .maybeSingle();
        if (supp) po.supplier = supp;
      }

      const { data: items } = await supabase
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', id)
        .order('created_at');

      return resolveUniversalDocumentFromPayload(
        type,
        po || { id },
        items || [],
        resolvedBusiness
      );
    }

    case 'purchase_bill': {
      let bill: any = null;
      const { data: bill1, error: bill1Err } = await supabase
        .from('purchase_bills')
        .select('*, supplier:supplier_id(*)')
        .eq('id', id)
        .maybeSingle();

      if (!bill1Err && bill1) {
        bill = bill1;
      } else {
        const { data: bill2 } = await supabase
          .from('purchase_bills')
          .select('*, supplier:suppliers(*)')
          .eq('id', id)
          .maybeSingle();
        if (bill2) {
          bill = bill2;
        } else {
          const { data: bill3 } = await supabase
            .from('purchase_bills')
            .select('*')
            .eq('id', id)
            .maybeSingle();
          bill = bill3;
        }
      }

      if (bill && !bill.supplier && bill.supplier_id) {
        const { data: supp } = await supabase
          .from('suppliers')
          .select('*')
          .eq('id', bill.supplier_id)
          .maybeSingle();
        if (supp) bill.supplier = supp;
      }

      const { data: items } = await supabase
        .from('purchase_bill_items')
        .select('*')
        .eq('bill_id', id)
        .order('created_at');

      return resolveUniversalDocumentFromPayload(
        type,
        bill || { id },
        items || [],
        resolvedBusiness
      );
    }
  }
}

const MOUNT_STYLE =
  'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;z-index:-9999;pointer-events:none;';

export async function renderUniversalDocumentOffscreen<T>(
  data: UniversalDocumentData,
  handler: (element: HTMLElement) => Promise<T> | T
): Promise<T> {
  const host = document.createElement('div');
  host.style.cssText = MOUNT_STYLE;
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    root.render(<UniversalDocumentTemplate data={data} />);
    // Allow React to commit the DOM
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Wait for any images (logo, signature, QR) to complete loading
    const images = Array.from(host.querySelectorAll('img'));
    if (images.length > 0) {
      await Promise.all(
        images.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    const element = (host.firstElementChild as HTMLElement) ?? host;
    return await handler(element);
  } finally {
    setTimeout(() => {
      try {
        root.unmount();
        host.remove();
      } catch {
        // ignore unmount cleanup errors
      }
    }, 1000);
  }
}

export async function printDocument(
  type: DocumentActionType,
  idOrPayload: string | { doc: any; items?: any[] },
  activeBusiness?: any,
  navigate?: (path: string) => void
): Promise<void> {
  if (typeof idOrPayload === 'string') {
    const targetUrl = `${getDocumentViewPath(type, idOrPayload)}?action=print`;
    if (navigate) {
      navigate(targetUrl);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.location?.assign === 'function') {
      window.location.assign(targetUrl);
      return;
    }
  }

  const resolved =
    typeof idOrPayload === 'string'
      ? await fetchDocumentPayload(type, idOrPayload, activeBusiness)
      : resolveUniversalDocumentFromPayload(
          type,
          idOrPayload.doc,
          idOrPayload.items || [],
          activeBusiness
        );

  await renderUniversalDocumentOffscreen(resolved.data, (element) => {
    printElementInIframe(element, resolved.title);
  });
}

export async function downloadDocumentPdf(
  type: DocumentActionType,
  idOrPayload: string | { doc: any; items?: any[] },
  activeBusiness: any
): Promise<void> {
  let docData: UniversalDocumentData;
  let filename: string;

  if (typeof idOrPayload === 'string') {
    const fetched = await fetchDocumentPayload(type, idOrPayload, activeBusiness);
    docData = fetched.data;
    filename = fetched.filename;
  } else {
    const resolved = resolveUniversalDocumentFromPayload(
      type,
      idOrPayload.doc,
      idOrPayload.items || [],
      activeBusiness
    );
    docData = resolved.data;
    filename = resolved.filename;
  }

  await renderUniversalDocumentOffscreen(docData, async (element) => {
    await captureElementToPdf(element, filename);
  });
}
