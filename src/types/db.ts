export type Business = {
  id: string;
  owner_id: string;
  name: string;
  legal_name: string | null;
  business_type: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  gstin: string | null;
  pan: string | null;
  financial_year: string;
  currency: string;
  currency_symbol: string;
  invoice_prefix: string;
  logo_url: string | null;
  gst_registered: boolean;
  stamp_url?: string | null;
  signature_url?: string | null;
  upi_id?: string | null;
  invoice_footer_text?: string | null;
  invoice_signature_name?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc_code?: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessMember = {
  id: string;
  business_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'manager' | 'accountant' | 'sales_staff' | 'purchase_staff' | 'inventory_staff' | 'viewer';
  is_active: boolean;
  joined_at: string;
};

export type Customer = {
  id: string;
  business_id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  pincode: string | null;
  opening_balance: number;
  current_balance: number;
  credit_limit: number;
  total_sales: number;
  total_paid: number;
  last_transaction_date: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Supplier = {
  id: string;
  business_id: string;
  name: string;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  pincode: string | null;
  opening_balance: number;
  current_balance: number;
  total_purchases: number;
  total_paid: number;
  last_transaction_date: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductCategory = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  type: 'product' | 'service';
  hsn_sac: string | null;
  unit: string;
  purchase_price: number;
  selling_price: number;
  tax_rate: number;
  tax_inclusive: boolean;
  opening_stock: number;
  current_stock: number;
  minimum_stock: number;
  warehouse_id: string | null;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Warehouse = {
  id: string;
  business_id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  is_default: boolean;
  created_at: string;
};

export type StockMovement = {
  id: string;
  business_id: string;
  product_id: string;
  warehouse_id: string | null;
  type: 'opening' | 'purchase' | 'sale' | 'sale_return' | 'purchase_return' | 'adjustment_in' | 'adjustment_out' | 'transfer_in' | 'transfer_out';
  quantity: number;
  balance_after: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type SalesInvoice = {
  id: string;
  business_id: string;
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  place_of_supply: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled' | 'void';
  payment_method: string | null;
  notes: string | null;
  terms: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesInvoiceItem = {
  id: string;
  business_id: string;
  invoice_id: string;
  product_id: string | null;
  product_name: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  discount_amount: number;
  tax_rate: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  total_amount: number;
  created_at: string;
};

export type PurchaseBill = {
  id: string;
  business_id: string;
  supplier_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: 'unpaid' | 'partial' | 'paid';
  status: 'draft' | 'confirmed' | 'partially_paid' | 'paid' | 'cancelled';
  payment_method: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseBillItem = {
  id: string;
  business_id: string;
  bill_id: string;
  product_id: string | null;
  product_name: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  discount_amount: number;
  tax_rate: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  total_amount: number;
  created_at: string;
};

export type Payment = {
  id: string;
  business_id: string;
  type: 'received' | 'made';
  party_type: 'customer' | 'supplier';
  party_id: string;
  invoice_id: string | null;
  bill_id: string | null;
  payment_number: string;
  date: string;
  amount: number;
  allocated_amount: number;
  payment_method: 'cash' | 'upi' | 'bank' | 'card' | 'credit' | 'cheque';
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseCategory = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  business_id: string;
  expense_number: string;
  category_id: string | null;
  date: string;
  description: string | null;
  amount: number;
  tax_amount: number;
  total_amount: number;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Account = {
  id: string;
  business_id: string;
  group_name: string;
  name: string;
  code: string | null;
  opening_balance: number;
  current_balance: number;
  is_system: boolean;
  created_at: string;
};

export type JournalEntry = {
  id: string;
  business_id: string;
  entry_number: string;
  date: string;
  reference_type: string | null;
  reference_id: string | null;
  narration: string | null;
  total_debit: number;
  total_credit: number;
  status: 'draft' | 'posted' | 'cancelled';
  created_by: string | null;
  created_at: string;
};

export type JournalEntryLine = {
  id: string;
  business_id: string;
  entry_id: string;
  account_id: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  created_at: string;
};

export type AuditLog = {
  id: string;
  business_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  description: string | null;
  created_at: string;
};

export type CreditNoteStatus = 'draft' | 'issued' | 'applied' | 'cancelled';

export type CreditNote = {
  id: string;
  business_id: string;
  credit_note_number: string;
  sales_invoice_id: string;
  customer_id: string;
  date: string;
  reason: string | null;
  restock: boolean;
  subtotal: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  status: CreditNoteStatus;
  payment_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditNoteItem = {
  id: string;
  business_id: string;
  credit_note_id: string;
  sales_invoice_item_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  rate: number;
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
  created_at: string;
};

export type DebitNoteStatus = 'draft' | 'issued' | 'applied' | 'cancelled';

export type DebitNote = {
  id: string;
  business_id: string;
  debit_note_number: string;
  purchase_bill_id: string;
  supplier_id: string;
  date: string;
  reason: string | null;
  restock: boolean;
  subtotal: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  status: DebitNoteStatus;
  payment_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DebitNoteItem = {
  id: string;
  business_id: string;
  debit_note_id: string;
  purchase_bill_item_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  rate: number;
  taxable_amount: number;
  tax_amount: number;
  total_amount: number;
  created_at: string;
};

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted' | 'cancelled';

export type Quotation = {
  id: string;
  business_id: string;
  quotation_number: string;
  customer_id: string;
  quote_date: string;
  expiry_date: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  status: QuotationStatus;
  terms: string | null;
  notes: string | null;
  converted_doc_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type QuotationItem = {
  id: string;
  business_id: string;
  quotation_id: string;
  product_id: string | null;
  product_name: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  tax_rate: number;
  taxable_amount: number;
  total_amount: number;
  created_at: string;
};

export type SalesOrderStatus = 'draft' | 'confirmed' | 'fulfilled' | 'converted' | 'cancelled';

export type SalesOrder = {
  id: string;
  business_id: string;
  order_number: string;
  customer_id: string;
  quotation_id: string | null;
  order_date: string;
  expected_date: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  status: SalesOrderStatus;
  notes: string | null;
  converted_doc_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesOrderItem = {
  id: string;
  business_id: string;
  sales_order_id: string;
  product_id: string | null;
  product_name: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  tax_rate: number;
  taxable_amount: number;
  total_amount: number;
  created_at: string;
};

export type PurchaseOrderStatus = 'draft' | 'confirmed' | 'received' | 'converted' | 'cancelled';

export type PurchaseOrder = {
  id: string;
  business_id: string;
  order_number: string;
  supplier_id: string;
  order_date: string;
  expected_date: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  status: PurchaseOrderStatus;
  notes: string | null;
  converted_doc_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderItem = {
  id: string;
  business_id: string;
  purchase_order_id: string;
  product_id: string | null;
  product_name: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  tax_rate: number;
  taxable_amount: number;
  total_amount: number;
  created_at: string;
};
