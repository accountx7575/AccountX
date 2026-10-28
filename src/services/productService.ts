import { supabase } from '@/lib/supabase';

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
