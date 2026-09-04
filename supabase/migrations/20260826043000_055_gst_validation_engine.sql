-- ============================================================================
-- # 055 — get_gst_validation_issues: GST data-quality engine
--         (GST BACKEND W2, T100) [oscar]
--
-- READ-ONLY validator over live documents in [from, to]. NEVER mutates.
-- One row per finding: severity critical|warning|info + doc coordinates +
-- machine-readable code + human problem text + suggested_fix.
--
-- CHECKS (codes):
--   critical  GSTIN_FORMAT        party gstin present but fails structural regex
--   warning   PARTY_GSTIN_MISSING taxable doc charged to party without gstin
--                             (forces B2C / buyer loses ITC)
--   warning   POS_MISSING         live invoice without place_of_supply
--   warning   HSN_MISSING         items with neither item- nor product-level hsn_sac
--   critical  TAX_MODE_CONFLICT   intra-state doc carrying IGST, or inter-state
--                             doc carrying CGST/SGST (businesses.state vs
--                             place_of_supply, case-insensitive trim match;
--                             unknown either side => warning STATE_UNKNOWN)
--   critical  TAXABLE_MISMATCH    header taxable_amount vs SUM(items) beyond 0.01
--   critical  GRAND_TOTAL_IDENTITY grand_total <> taxable + (cgst+sgst+igst)
--                             + cess + round_off beyond 0.01 (013b identity)
--   warning   DOC_NUMBER_DUP_CI   case-insensitive duplicate number among live docs
--                             (exact dupes impossible: UNIQUE constraints)
--   info      EXCLUDED_FROM_REPORT draft/cancelled/void docs inside the period,
--                             listed so the FE can show what was left out
--
-- NOTES: state names are free text; equality is btrim(lower()). Tolerance
-- 0.01 absorbs display rounding only. Language SQL STABLE, invoker-RLS
-- applies to every underlying read.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gst_validation_issues(
  p_business_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  severity text,
  doc_type text,
  doc_id uuid,
  doc_number text,
  doc_date date,
  party text,
  problem text,
  code text,
  suggested_fix text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH li AS (
  SELECT
    si.id, si.business_id, si.customer_id, si.invoice_number, si.invoice_date,

    c.name AS party_name, NULLIF(btrim(c.gstin), '') AS party_gstin,
    si.place_of_supply, si.status, si.subtotal,
    si.taxable_amount, si.cgst_amount, si.sgst_amount, si.igst_amount,
    si.cess_amount, si.round_off, si.grand_total,
    COALESCE((SELECT SUM(sii.taxable_amount) FROM sales_invoice_items sii
              WHERE sii.invoice_id = si.id), 0) AS items_taxable,
    COALESCE((SELECT COUNT(*) FROM sales_invoice_items sii
              WHERE sii.invoice_id = si.id
                AND NULLIF(btrim(sii.hsn_sac), '') IS NULL
                AND NOT EXISTS (SELECT 1 FROM products pp WHERE pp.id = sii.product_id
                                 AND NULLIF(btrim(pp.hsn_sac), '') IS NOT NULL)), 0) AS items_no_hsn
  FROM sales_invoices si
  JOIN customers c ON c.id = si.customer_id
  WHERE si.business_id = p_business_id
    AND si.invoice_date BETWEEN p_from AND p_to
),
lb AS (
  SELECT
    pb.id, pb.business_id, pb.supplier_id, pb.bill_number, pb.bill_date,
    sup.name AS party_name, NULLIF(btrim(sup.gstin), '') AS party_gstin,
    pb.status, pb.subtotal,
    pb.taxable_amount, pb.cgst_amount, pb.sgst_amount, pb.igst_amount,
    pb.cess_amount, pb.round_off, pb.grand_total,
    COALESCE((SELECT SUM(pbi.taxable_amount) FROM purchase_bill_items pbi
              WHERE pbi.bill_id = pb.id), 0) AS items_taxable,
    COALESCE((SELECT COUNT(*) FROM purchase_bill_items pbi
              WHERE pbi.bill_id = pb.id
                AND NULLIF(btrim(pbi.hsn_sac), '') IS NULL
                AND NOT EXISTS (SELECT 1 FROM products pp WHERE pp.id = pbi.product_id
                                 AND NULLIF(btrim(pp.hsn_sac), '') IS NOT NULL)), 0) AS items_no_hsn
  FROM purchase_bills pb
  JOIN suppliers sup ON sup.id = pb.supplier_id
  WHERE pb.business_id = p_business_id
    AND pb.bill_date BETWEEN p_from AND p_to
),
live_li AS (
  SELECT * FROM li WHERE status IN ('issued', 'partially_paid', 'paid')
),
live_lb AS (
  SELECT * FROM lb WHERE status IN ('confirmed', 'partially_paid', 'paid')
),
biz AS (
  SELECT b.state FROM businesses b WHERE b.id = p_business_id
)
-- 1. GSTIN structural format (both directions, live docs only)
SELECT 'critical', 'customer', c.id, c.name, NULL::date,
       c.name,
       'Customer GSTIN ' || c.gstin || ' fails the structural GSTIN format.',
       'GSTIN_FORMAT',
       'Correct the GSTIN on the customer record before filing.'
FROM customers c
WHERE c.business_id = p_business_id
  AND NULLIF(btrim(c.gstin), '') IS NOT NULL
  AND c.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  AND EXISTS (SELECT 1 FROM live_li WHERE customer_id = c.id)

UNION ALL

SELECT 'critical', 'supplier', sup.id, sup.name, NULL::date,
       sup.name,
       'Supplier GSTIN ' || sup.gstin || ' fails the structural GSTIN format.',
       'GSTIN_FORMAT',
       'Correct the GSTIN on the supplier record before claiming ITC.'
FROM suppliers sup
WHERE sup.business_id = p_business_id
  AND NULLIF(btrim(sup.gstin), '') IS NOT NULL
  AND sup.gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  AND EXISTS (SELECT 1 FROM live_lb WHERE supplier_id = sup.id)

UNION ALL

-- 2. Taxed doc billed to party without GSTIN (warning, both directions)
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'GST was charged but the customer has no GSTIN; the doc files under B2C.',
       'PARTY_GSTIN_MISSING',
       'Capture the customer GSTIN if they are registered.'
FROM live_li x
WHERE (x.cgst_amount + x.sgst_amount + x.igst_amount + x.cess_amount) > 0
  AND x.party_gstin IS NULL

UNION ALL

SELECT 'warning', 'purchase_bill', y.id, y.bill_number, y.bill_date,
       y.party_name,
       'Input GST was charged but the supplier has no GSTIN; ITC documentation is weak.',
       'PARTY_GSTIN_MISSING',
       'Capture the supplier GSTIN to support the ITC claim.'
FROM live_lb y
WHERE (y.cgst_amount + y.sgst_amount + y.igst_amount + y.cess_amount) > 0
  AND y.party_gstin IS NULL

UNION ALL

-- 3. Missing place_of_supply on live invoices
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'place_of_supply is blank; intra/inter-state tax mode cannot be verified.',
       'POS_MISSING',
       'Set place_of_supply on the invoice.'
FROM live_li x
WHERE NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NULL

UNION ALL

-- 4. Items without resolvable HSN/SAC (live invoices)
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       x.items_no_hsn || ' item(s) have no HSN/SAC (item-level and product-level both blank).',
       'HSN_MISSING',
       'Add hsn_sac to the items or their products.'
FROM live_li x
WHERE x.items_no_hsn > 0

UNION ALL

-- 5a. Intra-state expectation violated (pos == business state, IGST present)
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Intra-state supply (place_of_supply matches business state "' || bz.state || '") but IGST ' || x.igst_amount || ' was charged.',
       'TAX_MODE_CONFLICT',
       'Charge CGST+SGST instead of IGST, or correct place_of_supply.'
FROM live_li x, biz bz
WHERE NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(bz.state, '')), '') IS NOT NULL
  AND lower(btrim(x.place_of_supply)) = lower(btrim(bz.state))
  AND x.igst_amount > 0

UNION ALL

-- 5b. Inter-state expectation violated (pos != business state, CGST/SGST present)
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Inter-state supply (place_of_supply "' || x.place_of_supply || '" differs from business state "' || bz.state || '") but CGST/SGST were charged.',
       'TAX_MODE_CONFLICT',
       'Charge IGST instead of CGST+SGST, or correct place_of_supply.'
FROM live_li x, biz bz
WHERE NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(bz.state, '')), '') IS NOT NULL
  AND lower(btrim(x.place_of_supply)) <> lower(btrim(bz.state))
  AND (x.cgst_amount + x.sgst_amount) > 0

UNION ALL

-- 5c. Business state unknown while tax present and POS given
--     (blank-POS docs already carry POS_MISSING - no double reporting)
SELECT 'warning', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Businesses.state is blank; tax mode could not be verified on a taxed document.',
       'STATE_UNKNOWN',
       'Set businesses.state so intra/inter-state checks can run.'
FROM live_li x, biz bz
WHERE (x.cgst_amount + x.sgst_amount + x.igst_amount) > 0
  AND NULLIF(btrim(COALESCE(x.place_of_supply, '')), '') IS NOT NULL
  AND NULLIF(btrim(COALESCE(bz.state, '')), '') IS NULL

UNION ALL

-- 6. Header taxable vs items taxable mismatch (beyond penny tolerance)
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'Header taxable ' || x.taxable_amount || ' <> items taxable ' || x.items_taxable || '.',
       'TAXABLE_MISMATCH',
       'Re-save the invoice so header totals recompute from items.'
FROM live_li x
WHERE abs(x.taxable_amount - x.items_taxable) > 0.01

UNION ALL

SELECT 'critical', 'purchase_bill', y.id, y.bill_number, y.bill_date,
       y.party_name,
       'Header taxable ' || y.taxable_amount || ' <> items taxable ' || y.items_taxable || '.',
       'TAXABLE_MISMATCH',
       'Re-save the bill so header totals recompute from items.'
FROM live_lb y
WHERE abs(y.taxable_amount - y.items_taxable) > 0.01

UNION ALL

-- 7. Grand-total identity (013b): taxable + taxes + cess + round_off
SELECT 'critical', 'sales_invoice', x.id, x.invoice_number, x.invoice_date,
       x.party_name,
       'grand_total ' || x.grand_total || ' <> taxable + taxes + cess + round_off '
       || (x.taxable_amount + x.cgst_amount + x.sgst_amount + x.igst_amount + x.cess_amount + x.round_off) || '.',
       'GRAND_TOTAL_IDENTITY',
       'Re-save the invoice; the journal identity expects this sum.'
FROM live_li x
WHERE abs(x.grand_total - (x.taxable_amount + x.cgst_amount + x.sgst_amount
      + x.igst_amount + x.cess_amount + x.round_off)) > 0.01

UNION ALL

SELECT 'critical', 'purchase_bill', y.id, y.bill_number, y.bill_date,
       y.party_name,
       'grand_total ' || y.grand_total || ' <> taxable + taxes + cess + round_off '
       || (y.taxable_amount + y.cgst_amount + y.sgst_amount + y.igst_amount + y.cess_amount + y.round_off) || '.',
       'GRAND_TOTAL_IDENTITY',
       'Re-save the bill; the journal identity expects this sum.'
FROM live_lb y
WHERE abs(y.grand_total - (y.taxable_amount + y.cgst_amount + y.sgst_amount
      + y.igst_amount + y.cess_amount + y.round_off)) > 0.01

UNION ALL

-- 8. Case-insensitive duplicate numbers among live docs
SELECT 'warning', 'sales_invoice', a.id, a.invoice_number, a.invoice_date,
       a.party_name,
       'Invoice number collides case-insensitively with another live invoice.',
       'DOC_NUMBER_DUP_CI',
       'Renumber one of the documents; filing portals treat these as duplicates.'
FROM live_li a
JOIN live_li b2
  ON lower(btrim(a.invoice_number)) = lower(btrim(b2.invoice_number))
 AND a.id < b2.id

UNION ALL

SELECT 'warning', 'purchase_bill', a.id, a.bill_number, a.bill_date,
       a.party_name,
       'Bill number collides case-insensitively with another live bill.',
       'DOC_NUMBER_DUP_CI',
       'Renumber one of the documents; filing portals treat these as duplicates.'
FROM live_lb a
JOIN live_lb b2
  ON lower(btrim(a.bill_number)) = lower(btrim(b2.bill_number))
 AND a.id < b2.id

UNION ALL

-- 9. Info: non-reportable docs inside the period
SELECT 'info', 'sales_invoice', z.id, z.invoice_number, z.invoice_date,
       z.party_name,
       'Status "' || z.status || '" - excluded from GSTR surfaces for this period.',
       'EXCLUDED_FROM_REPORT',
       'Issue the draft or ignore if cancellation was intended.'
FROM li z
WHERE z.status NOT IN ('issued', 'partially_paid', 'paid')

UNION ALL

SELECT 'info', 'purchase_bill', z2.id, z2.bill_number, z2.bill_date,
       z2.party_name,
       'Status "' || z2.status || '" - excluded from GSTR surfaces for this period.',
       'EXCLUDED_FROM_REPORT',
       'Confirm the bill or ignore if cancellation was intended.'
FROM lb z2
WHERE z2.status NOT IN ('confirmed', 'partially_paid', 'paid');
$$;

REVOKE EXECUTE ON FUNCTION public.get_gst_validation_issues(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_validation_issues(uuid, date, date) TO authenticated;
