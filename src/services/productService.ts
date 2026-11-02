import { supabase } from '@/lib/supabase';

export interface ProductUpdateInput {
  name?: string;
  type?: 'product' | 'service' | string;
  unit?: string;
  sku?: string | null;
  barcode?: string | null;
  hsn_sac?: string | null;
  tax_rate?: number | string;
  purchase_price?: number | string;
  selling_price?: number | string;
  minimum_stock?: number | string;
  min_stock?: number | string;
  reorder_level?: number | string;
  description?: string | null;
  category_id?: string | null;
  [key: string]: any;
}

export interface SanitizedProductUpdatePayload {
  name: string;
  type: string;
  unit: string;
  sku: string | null;
  barcode: string | null;
  hsn_sac: string | null;
  tax_rate: number;
  purchase_price: number;
  selling_price: number;
  minimum_stock: number;
  min_stock: number;
  reorder_level: number;
  description: string | null;
  category_id: string | null;
}

export interface UpdateProductParams {
  businessId: string;
  productId: string;
  form: ProductUpdateInput;
}

/**
 * Sanitizes product form input into a clean, safe payload matching
 * the Postgres products table columns, stripping out non-existent
 * or calculated/historical fields (e.g. opening_stock, current_stock).
 */
export function sanitizeProductUpdatePayload(form: ProductUpdateInput): SanitizedProductUpdatePayload {
  const stockLimit =
    Number(form.minimum_stock ?? form.min_stock ?? form.reorder_level ?? 0) || 0;

  return {
    name: (form.name || '').trim(),
    type: form.type || 'product',
    unit: (form.unit || 'PCS').trim(),
    sku: form.sku?.trim() || null,
    barcode: form.barcode?.trim() || null,
    hsn_sac: form.hsn_sac?.trim() || null,
    tax_rate: Number(form.tax_rate) || 0,
    purchase_price: Number(form.purchase_price) || 0,
    selling_price: Number(form.selling_price) || 0,
    minimum_stock: stockLimit,
    min_stock: stockLimit,
    reorder_level: stockLimit,
    description: form.description?.trim() || null,
    category_id: form.category_id || null,
  };
}

/**
 * Updates an existing product with schema-safe column mapping.
 * Safely maps min_stock, minimum_stock, and reorder_level. If the
 * schema cache reports missing min_stock/reorder_level, gracefully
 * retries with minimum_stock alone.
 */
export async function updateProductService(params: UpdateProductParams): Promise<void> {
  const { businessId, productId, form } = params;
  const sanitized = sanitizeProductUpdatePayload(form);

  const { error } = await supabase
    .from('products')
    .update(sanitized)
    .eq('business_id', businessId)
    .eq('id', productId);

  if (!error) return;

  // Defensive fallback if PostgREST schema cache hasn't loaded min_stock or reorder_level
  const errMessage = (error.message || '').toLowerCase();
  if (
    errMessage.includes('min_stock') ||
    errMessage.includes('reorder_level') ||
    error.code === 'PGRST204'
  ) {
    const fallbackPayload: Record<string, any> = { ...sanitized };
    delete fallbackPayload.min_stock;
    delete fallbackPayload.reorder_level;

    const { error: fallbackError } = await supabase
      .from('products')
      .update(fallbackPayload)
      .eq('business_id', businessId)
      .eq('id', productId);

    if (fallbackError) throw fallbackError;
    return;
  }

  throw error;
}

/**
 * Checks whether a product has any existing transaction linkages
 * (sales invoices or purchase bills).
 */
export async function checkProductLinked(productId: string): Promise<boolean> {
  const [invItemsRes, billItemsRes] = await Promise.all([
    supabase
      .from('sales_invoice_items')
      .select('id')
      .eq('product_id', productId)
      .limit(1),
    supabase
      .from('purchase_bill_items')
      .select('id')
      .eq('product_id', productId)
      .limit(1),
  ]);

  return (invItemsRes.data?.length ?? 0) > 0 || (billItemsRes.data?.length ?? 0) > 0;
}

/**
 * Permanently deletes a product from the database.
 * If the product is linked to existing invoices or bills, prevents deletion
 * and informs the user to archive instead.
 */
export async function deleteProduct(businessId: string, productId: string): Promise<void> {
  // Pre-check for linked transactions
  const isLinked = await checkProductLinked(productId);
  if (isLinked) {
    throw new Error('Cannot delete product linked to existing invoices or bills. You can archive it instead.');
  }

  // Attempt direct permanent deletion
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
    .eq('business_id', businessId);

  if (error) {
    if (
      error.code === '23503' ||
      error.message?.toLowerCase().includes('foreign key') ||
      error.message?.toLowerCase().includes('violates foreign key')
    ) {
      throw new Error('Cannot delete product linked to existing invoices or bills. You can archive it instead.');
    }
    throw error;
  }
}

/**
 * Soft archives a product when deletion is prevented due to past records.
 */
export async function archiveProduct(businessId: string, productId: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ is_active: false })
    .eq('id', productId)
    .eq('business_id', businessId);

  if (error) throw error;
}
