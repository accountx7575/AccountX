-- ============================================================================
-- Migration: Deploy create_purchase_bill RPC + Table & Schema Cache Reload
-- ============================================================================

-- Ensure tables exist
CREATE TABLE IF NOT EXISTS public.purchase_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  bill_number text NOT NULL,
  bill_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  grand_total numeric(14,2) DEFAULT 0,
  paid_amount numeric(14,2) DEFAULT 0,
  balance_amount numeric(14,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  status text DEFAULT 'confirmed' CHECK (status IN ('draft', 'confirmed', 'partially_paid', 'paid', 'cancelled')),
  payment_method text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, bill_number)
);

CREATE TABLE IF NOT EXISTS public.purchase_bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  hsn_sac text,
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  unit text DEFAULT 'PCS',
  rate numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  tax_rate numeric(5,2) DEFAULT 0,
  taxable_amount numeric(14,2) DEFAULT 0,
  cgst_amount numeric(14,2) DEFAULT 0,
  sgst_amount numeric(14,2) DEFAULT 0,
  igst_amount numeric(14,2) DEFAULT 0,
  cess_amount numeric(14,2) DEFAULT 0,
  total_amount numeric(14,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- RLS policies
ALTER TABLE public.purchase_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_bill_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bills' AND policyname = 'purchase_bills_select') THEN
    CREATE POLICY "purchase_bills_select" ON public.purchase_bills FOR SELECT TO authenticated USING (is_business_member(business_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bills' AND policyname = 'purchase_bills_insert') THEN
    CREATE POLICY "purchase_bills_insert" ON public.purchase_bills FOR INSERT TO authenticated WITH CHECK (can_write_business(business_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bills' AND policyname = 'purchase_bills_update') THEN
    CREATE POLICY "purchase_bills_update" ON public.purchase_bills FOR UPDATE TO authenticated USING (is_business_member(business_id)) WITH CHECK (can_write_business(business_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bills' AND policyname = 'purchase_bills_delete') THEN
    CREATE POLICY "purchase_bills_delete" ON public.purchase_bills FOR DELETE TO authenticated USING (can_write_business(business_id));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bill_items' AND policyname = 'purchase_bill_items_select') THEN
    CREATE POLICY "purchase_bill_items_select" ON public.purchase_bill_items FOR SELECT TO authenticated USING (is_business_member(business_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bill_items' AND policyname = 'purchase_bill_items_insert') THEN
    CREATE POLICY "purchase_bill_items_insert" ON public.purchase_bill_items FOR INSERT TO authenticated WITH CHECK (can_write_business(business_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bill_items' AND policyname = 'purchase_bill_items_update') THEN
    CREATE POLICY "purchase_bill_items_update" ON public.purchase_bill_items FOR UPDATE TO authenticated USING (is_business_member(business_id)) WITH CHECK (can_write_business(business_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_bill_items' AND policyname = 'purchase_bill_items_delete') THEN
    CREATE POLICY "purchase_bill_items_delete" ON public.purchase_bill_items FOR DELETE TO authenticated USING (can_write_business(business_id));
  END IF;
END $$;

-- Drop legacy overloads to avoid PostgREST ambiguity (PGRST203)
DROP FUNCTION IF EXISTS public.create_purchase_bill(uuid, jsonb, jsonb);

-- Canonical create_purchase_bill function
CREATE OR REPLACE FUNCTION public.create_purchase_bill(
  p_business_id uuid,
  p_bill jsonb,
  p_items jsonb,
  p_status text DEFAULT 'confirmed'
)
RETURNS TABLE (bill_id uuid, journal_entry_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill_number text;
  v_bill_id uuid;
  v_je_id uuid := NULL;
  v_item jsonb;
  v_pid uuid;
  v_stock numeric;
  v_bal numeric;
  v_qty numeric;
  v_grand_total numeric;
  v_is_draft boolean;
  v_sum_taxable numeric := 0;
  v_sum_cgst numeric := 0;
  v_sum_sgst numeric := 0;
  v_sum_igst numeric := 0;
  v_sum_cess numeric := 0;
  v_expected_total numeric;
  v_supp_id uuid;
  v_open_bal numeric := 0;
  v_total_purch numeric := 0;
  v_total_paid numeric := 0;
  v_new_supp_bal numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must have at least one item';
  END IF;

  IF p_status NOT IN ('confirmed', 'draft') OR COALESCE(p_bill->>'status', p_status) NOT IN ('confirmed', 'draft') THEN
    RAISE EXCEPTION 'Only statuses ''confirmed'' and ''draft'' are supported by this RPC';
  END IF;

  v_is_draft := (p_status = 'draft') OR (COALESCE(p_bill->>'status', p_status) = 'draft');

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    IF COALESCE(v_item->>'product_name', '') = '' THEN
      RAISE EXCEPTION 'Every item needs a product name';
    END IF;
    IF COALESCE((v_item->>'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % needs a positive quantity', v_item->>'product_name';
    END IF;
    IF COALESCE((v_item->>'taxable_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'cgst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'sgst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'igst_amount')::numeric, 0) < 0
       OR COALESCE((v_item->>'cess_amount')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Item % has a negative amount', v_item->>'product_name';
    END IF;
    v_sum_taxable := v_sum_taxable + COALESCE((v_item->>'taxable_amount')::numeric, 0);
    v_sum_cgst := v_sum_cgst + COALESCE((v_item->>'cgst_amount')::numeric, 0);
    v_sum_sgst := v_sum_sgst + COALESCE((v_item->>'sgst_amount')::numeric, 0);
    v_sum_igst := v_sum_igst + COALESCE((v_item->>'igst_amount')::numeric, 0);
    v_sum_cess := v_sum_cess + COALESCE((v_item->>'cess_amount')::numeric, 0);
  END LOOP;

  v_grand_total := COALESCE((p_bill->>'grand_total')::numeric, 0);

  IF COALESCE((p_bill->>'taxable_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'cgst_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'sgst_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'igst_amount')::numeric, 0) < 0
     OR COALESCE((p_bill->>'cess_amount')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'Bill header has a negative tax component';
  END IF;

  v_expected_total := v_sum_taxable + v_sum_cgst + v_sum_sgst + v_sum_igst
                      + v_sum_cess + COALESCE((p_bill->>'round_off')::numeric, 0);
  IF abs(v_grand_total - v_expected_total) > 0.05 THEN
    RAISE EXCEPTION 'Bill grand_total % does not equal items+round_off %',
      v_grand_total, v_expected_total;
  END IF;

  v_bill_number := COALESCE(
    nullif(btrim(COALESCE(p_bill->>'bill_number', '')), ''),
    next_document_number(p_business_id, 'purchase_bill', COALESCE((p_bill->>'bill_date')::date, CURRENT_DATE))
  );

  IF p_bill->>'bill_number' IS NOT NULL AND nullif(btrim(p_bill->>'bill_number'), '') IS NOT NULL THEN
    BEGIN
      PERFORM register_document_number(p_business_id, 'purchase_bill', v_bill_number);
    EXCEPTION WHEN OTHERS THEN
      -- ignore if sequence tracker not present
    END;
  END IF;

  v_supp_id := (p_bill->>'supplier_id')::uuid;

  INSERT INTO public.purchase_bills (
    business_id, supplier_id, bill_number, bill_date, due_date,
    subtotal, discount_amount, taxable_amount,
    cgst_amount, sgst_amount, igst_amount, cess_amount, round_off,
    grand_total, paid_amount, balance_amount, payment_status, status,
    payment_method, notes, created_by
  ) VALUES (
    p_business_id,
    v_supp_id,
    v_bill_number,
    COALESCE((p_bill->>'bill_date')::date, CURRENT_DATE),
    nullif(p_bill->>'due_date', '')::date,
    COALESCE((p_bill->>'subtotal')::numeric, 0),
    COALESCE((p_bill->>'discount_amount')::numeric, 0),
    COALESCE((p_bill->>'taxable_amount')::numeric, 0),
    COALESCE((p_bill->>'cgst_amount')::numeric, 0),
    COALESCE((p_bill->>'sgst_amount')::numeric, 0),
    COALESCE((p_bill->>'igst_amount')::numeric, 0),
    COALESCE((p_bill->>'cess_amount')::numeric, 0),
    COALESCE((p_bill->>'round_off')::numeric, 0),
    v_grand_total,
    0,
    v_grand_total,
    'unpaid',
    CASE WHEN v_is_draft THEN 'draft' ELSE 'confirmed' END,
    nullif(p_bill->>'payment_method', ''),
    nullif(p_bill->>'notes', ''),
    auth.uid()
  )
  RETURNING id INTO v_bill_id;

  FOR v_item IN SELECT jsonb_array_elements(p_items) LOOP
    INSERT INTO public.purchase_bill_items (
      business_id, bill_id, product_id, product_name, hsn_sac,
      quantity, unit, rate, discount_amount, tax_rate, taxable_amount,
      cgst_amount, sgst_amount, igst_amount, cess_amount, total_amount
    ) VALUES (
      p_business_id,
      v_bill_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      nullif(v_item->>'hsn_sac', ''),
      (v_item->>'quantity')::numeric,
      COALESCE(nullif(v_item->>'unit', ''), 'PCS'),
      COALESCE((v_item->>'rate')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE((v_item->>'tax_rate')::numeric, 0),
      COALESCE((v_item->>'taxable_amount')::numeric, 0),
      COALESCE((v_item->>'cgst_amount')::numeric, 0),
      COALESCE((v_item->>'sgst_amount')::numeric, 0),
      COALESCE((v_item->>'igst_amount')::numeric, 0),
      COALESCE((v_item->>'cess_amount')::numeric, 0),
      COALESCE((v_item->>'total_amount')::numeric, 0)
    );

    IF NOT v_is_draft THEN
      v_pid := nullif(v_item->>'product_id', '')::uuid;
      IF v_pid IS NOT NULL THEN
        BEGIN
          UPDATE public.products
          SET current_stock = round(current_stock + (v_item->>'quantity')::numeric, 2)
          WHERE id = v_pid AND business_id = p_business_id
          RETURNING current_stock INTO v_bal;

          IF to_regclass('public.stock_movements') IS NOT NULL THEN
            INSERT INTO public.stock_movements (
              business_id, product_id, type, quantity, balance_after,
              reference_type, reference_id, notes, created_by
            ) VALUES (
              p_business_id, v_pid, 'purchase', (v_item->>'quantity')::numeric, v_bal,
              'purchase_bill', v_bill_id, 'Bill ' || v_bill_number, auth.uid()
            );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- Stock update failure must not abort bill save
        END;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_is_draft THEN
    -- Sync supplier balance
    IF v_supp_id IS NOT NULL THEN
      BEGIN
        SELECT COALESCE(opening_balance, 0) INTO v_open_bal FROM public.suppliers WHERE id = v_supp_id;
        SELECT COALESCE(sum(grand_total), 0) INTO v_total_purch FROM public.purchase_bills
          WHERE supplier_id = v_supp_id AND business_id = p_business_id AND status IN ('confirmed', 'partially_paid', 'paid');
        SELECT COALESCE(sum(amount), 0) INTO v_total_paid FROM public.payments
          WHERE party_id = v_supp_id AND business_id = p_business_id AND type = 'made';

        v_new_supp_bal := greatest(0, round(v_open_bal + v_total_purch - v_total_paid, 2));

        UPDATE public.suppliers
        SET current_balance = v_new_supp_bal,
            total_purchases = v_total_purch,
            last_transaction_date = now()
        WHERE id = v_supp_id AND business_id = p_business_id;
      EXCEPTION WHEN OTHERS THEN
        -- ignore supplier balance error
      END;
    END IF;

    -- Audit log if table present
    IF to_regclass('public.audit_logs') IS NOT NULL THEN
      BEGIN
        INSERT INTO public.audit_logs (
          business_id, user_id, action, entity_type, entity_id, description
        ) VALUES (
          p_business_id, auth.uid(), 'bill_created', 'purchase_bill', v_bill_id,
          'Bill ' || v_bill_number || ' created'
        );
      EXCEPTION WHEN OTHERS THEN
        -- ignore audit log error
      END;
    END IF;

    -- Post accounting journal if function present
    IF to_regproc('public.post_purchase_bill_journal') IS NOT NULL THEN
      BEGIN
        v_je_id := post_purchase_bill_journal(v_bill_id);
      EXCEPTION WHEN OTHERS THEN
        v_je_id := NULL;
      END;
    END IF;
  END IF;

  RETURN QUERY SELECT v_bill_id, v_je_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_purchase_bill(uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_purchase_bill(uuid, jsonb, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_bill(uuid, jsonb, jsonb, text) TO authenticated;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
