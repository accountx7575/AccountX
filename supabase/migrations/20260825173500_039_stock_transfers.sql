-- ============================================================================
-- # 039 — Stock transfers between warehouses (T65) [oscar]
--
-- Feasibility verdict recorded in hive: clean design EXISTS because m001
-- already anticipated multi-location stock:
--   * stock_movements.warehouse_id + types 'transfer_in'/'transfer_out'
--   * 023 recompute groups by PRODUCT only -> paired +/- legs net to zero
--     on products.current_stock (total conserved across warehouses)
--   * 023 append-only is insert-compatible; 033 cost-capture trigger leaves
--     explicitly-set unit_cost untouched -> FIFO value preservable.
--
-- ## Schema
-- stock_transfers header: business-scoped, from/to warehouse (RESTRICT keeps
-- route provenance; distinctness enforced), one-way status machine
-- completed -> cancelled (cancelled terminal + immutable), numbering unique
-- per business. Lines: one row per product, qty > 0.
-- RLS: SELECT/INSERT for members only; NO update/delete policies (status
-- transitions happen exclusively inside the SECURITY DEFINER cancel RPC).
--
-- ## Numbering
-- document_sequences CHECK widened (dynamic conname lookup, 022 pattern)
-- + next_document_number re-emitted with 'stock_transfer' => 'TRF'.
--
-- ## Semantics
-- NO financial journal entry — moving stock between own warehouses is not a
-- financial event. Both movement legs carry the FIFO-consumption cost of the
-- outgoing quantity so inventory VALUE is exactly preserved (get_stock_
-- valuation walk converges regardless of same-timestamp leg tie-break:
-- consume-then-repush == push-then-consume-oldest).
--
-- ## Availability honesty
-- Origin check sums movements attributed to the from-warehouse ONLY. Legacy
-- rows with NULL warehouse (pre-transfer-era data) are unattributable and
-- deliberately EXCLUDED; the RAISE reports what was found at origin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Tables + RLS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  transfer_number text NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_distinct_wh CHECK (from_warehouse_id <> to_warehouse_id),
  CONSTRAINT stock_transfers_number_unique UNIQUE (business_id, transfer_number)
);

CREATE TABLE IF NOT EXISTS public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4),
  CONSTRAINT stock_transfer_lines_unique_product UNIQUE (transfer_id, product_id)
);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_select" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT TO authenticated USING (is_business_member(business_id));

DROP POLICY IF EXISTS "stock_transfers_insert" ON public.stock_transfers;
CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT TO authenticated WITH CHECK (is_business_member(business_id));

-- Deliberately NO update/delete policies: corrections flow through the
-- cancel RPC (definer) + compensating movements, mirroring 023 philosophy.

DROP POLICY IF EXISTS "stock_transfer_lines_select" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_select" ON public.stock_transfer_lines
  FOR SELECT TO authenticated USING (
    is_business_member((
      SELECT t.business_id FROM public.stock_transfers t WHERE t.id = transfer_id
    ))
  );

DROP POLICY IF EXISTS "stock_transfer_lines_insert" ON public.stock_transfer_lines;
CREATE POLICY "stock_transfer_lines_insert" ON public.stock_transfer_lines
  FOR INSERT TO authenticated WITH CHECK (
    is_business_member((
      SELECT t.business_id FROM public.stock_transfers t WHERE t.id = transfer_id
    ))
  );

GRANT SELECT, INSERT ON public.stock_transfers TO authenticated;
GRANT SELECT, INSERT ON public.stock_transfer_lines TO authenticated;
REVOKE ALL ON public.stock_transfers FROM anon;
REVOKE ALL ON public.stock_transfer_lines FROM anon;

CREATE INDEX IF NOT EXISTS idx_stock_transfers_business
  ON public.stock_transfers(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_lines_transfer
  ON public.stock_transfer_lines(transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse
  ON public.stock_movements(business_id, warehouse_id, product_id)
  WHERE warehouse_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- B. Numbering service extension (CHECK widen + function re-emit, 022 pattern)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  c text;
BEGIN
  SELECT max(conname) INTO c
  FROM pg_constraint
  WHERE conrelid = 'document_sequences'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%sales_invoice%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE document_sequences DROP CONSTRAINT ' || c;
  END IF;
END $$;

ALTER TABLE public.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_doc_type_check;
ALTER TABLE public.document_sequences ADD CONSTRAINT document_sequences_doc_type_check
  CHECK (doc_type IN (
    'sales_invoice','purchase_bill','payment_received','payment_made',
    'credit_note','debit_note','expense',
    'quotation','sales_order','purchase_order',
    'stock_transfer'
  ));

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_business_id uuid,
  p_doc_type text,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
  v_prefix text;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  INSERT INTO document_sequences (business_id, doc_type, next_no)
  VALUES (p_business_id, p_doc_type, 2)
  ON CONFLICT (business_id, doc_type)
  DO UPDATE SET next_no = document_sequences.next_no + 1
  RETURNING next_no - 1 INTO v_seq;

  v_prefix := CASE p_doc_type
    WHEN 'sales_invoice' THEN 'INV'
    WHEN 'purchase_bill' THEN 'BILL'
    WHEN 'payment_received' THEN 'RCV'
    WHEN 'payment_made' THEN 'PAY'
    WHEN 'credit_note' THEN 'CN'
    WHEN 'debit_note' THEN 'DN'
    WHEN 'expense' THEN 'EXP'
    WHEN 'quotation' THEN 'QT'
    WHEN 'sales_order' THEN 'SO'
    WHEN 'purchase_order' THEN 'PO'
    WHEN 'stock_transfer' THEN 'TRF'
    ELSE NULL
  END;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown document type %', p_doc_type;
  END IF;

  v_number := v_prefix || '/' || extract(year from COALESCE(p_date, CURRENT_DATE))::text
              || '/' || lpad(v_seq::text, 6, '0');

  INSERT INTO document_numbers (business_id, doc_type, number)
  VALUES (p_business_id, p_doc_type, v_number)
  ON CONFLICT (business_id, doc_type, number) DO NOTHING;

  RETURN v_number;
END;
$$;

-- ----------------------------------------------------------------------------
-- C. FIFO consumption-cost helper (same walk as 033's valuation, read-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fifo_consumption_cost(
  p_product_id uuid,
  p_quantity numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r_move RECORD;
  v_layers_q numeric[];
  v_layers_c numeric[];
  v_head int := 1;
  v_len int;
  v_take numeric;
  v_rem numeric;
  v_cost_total numeric := 0;
  v_remaining numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN 0;
  END IF;

  FOR r_move IN
    SELECT quantity, unit_cost
    FROM stock_movements
    WHERE product_id = p_product_id
    ORDER BY created_at, id
  LOOP
    IF r_move.quantity > 0 THEN
      v_layers_q := array_append(v_layers_q, r_move.quantity);
      v_layers_c := array_append(v_layers_c, COALESCE(r_move.unit_cost, 0));
    ELSIF r_move.quantity < 0 THEN
      v_rem := -r_move.quantity;
      WHILE v_rem > 0 LOOP
        v_len := COALESCE(array_length(v_layers_q, 1), 0);
        EXIT WHEN v_head > v_len;
        v_take := least(v_layers_q[v_head], v_rem);
        v_layers_q[v_head] := v_layers_q[v_head] - v_take;
        v_rem := v_rem - v_take;
        IF v_layers_q[v_head] <= 0 THEN
          v_head := v_head + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  v_remaining := p_quantity;
  v_len := COALESCE(array_length(v_layers_q, 1), 0);
  WHILE v_remaining > 0 AND v_head <= v_len LOOP
    v_take := least(v_layers_q[v_head], v_remaining);
    v_cost_total := v_cost_total + v_take * v_layers_c[v_head];
    v_remaining := v_remaining - v_take;
    v_head := v_head + 1;
  END LOOP;
  -- oversold remainder consumes at zero, matching 033's honest convention

  RETURN round((v_cost_total / p_quantity)::numeric, 4);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_fifo_consumption_cost(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fifo_consumption_cost(uuid, numeric) TO authenticated;

-- ----------------------------------------------------------------------------
-- D. execute_stock_transfer
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_stock_transfer(
  p_business_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL,
  p_transfer_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (transfer_id uuid, transfer_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_bad text;
  v_qty numeric;
  v_avail numeric;
  v_rec RECORD;
  v_cost numeric;
  v_id uuid;
  v_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;

  -- Warehouses: same business, physically distinct
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'Source and destination warehouses must differ';
  END IF;
  SELECT count(*) INTO v_count FROM warehouses w
   WHERE w.business_id = p_business_id
     AND w.id IN (p_from_warehouse_id, p_to_warehouse_id);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Both warehouses must belong to this business';
  END IF;

  -- Items sanity
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;
  FOR v_rec IN
    SELECT elem->>'product_id' AS pid, elem->>'quantity' AS q
    FROM jsonb_array_elements(p_items) elem
  LOOP
    BEGIN
      v_qty := v_rec.q::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid quantity % for product %', v_rec.q, v_rec.pid;
    END;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantities must be positive (got %)', v_rec.q;
    END IF;
    BEGIN
      v_count := NULL;
      EXECUTE 'SELECT count(*) FROM products p WHERE p.id = $1 AND p.business_id = $2 AND p.type = ''product'''
        INTO v_count USING v_rec.pid::uuid, p_business_id;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Invalid product id %', v_rec.pid;
    END;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'Product % is not a product of this business', v_rec.pid;
    END IF;
  END LOOP;

  -- Serialize same-product stock decisions (deterministic lock order)
  PERFORM 1 FROM products p
   WHERE p.id IN (SELECT (elem->>'product_id')::uuid FROM jsonb_array_elements(p_items) elem)
   ORDER BY p.id
   FOR UPDATE;

  -- Duplicate product lines would double-spend availability
  SELECT count(*) INTO v_count
  FROM (SELECT DISTINCT elem->>'product_id' AS pid FROM jsonb_array_elements(p_items) elem) d;
  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Duplicate product lines are not allowed';
  END IF;

  -- Per-origin-warehouse availability (legacy NULL-wh rows excluded, see header)
  FOR v_rec IN
    SELECT (elem->>'product_id')::uuid AS pid, (elem->>'quantity')::numeric AS qty
    FROM jsonb_array_elements(p_items) elem
  LOOP
    SELECT COALESCE(SUM(sm.quantity), 0) INTO v_avail
    FROM stock_movements sm
    WHERE sm.product_id = v_rec.pid
      AND sm.business_id = p_business_id
      AND sm.warehouse_id = p_from_warehouse_id;
    IF v_avail < v_rec.qty THEN
      RAISE EXCEPTION 'Insufficient stock at source warehouse for product %: requested %, available %',
        v_rec.pid, v_rec.qty, v_avail;
    END IF;
  END LOOP;

  -- Header (number claimed inside 016 service)
  v_number := next_document_number(p_business_id, 'stock_transfer', p_transfer_date);

  INSERT INTO stock_transfers (business_id, transfer_number, from_warehouse_id, to_warehouse_id, notes, created_by)
  VALUES (p_business_id, v_number, p_from_warehouse_id, p_to_warehouse_id, p_notes, auth.uid())
  RETURNING id INTO v_id;

  -- Lines capture the FIFO cost actually consumed, for audit
  INSERT INTO stock_transfer_lines (transfer_id, product_id, quantity, unit_cost)
  SELECT v_id,
         (elem->>'product_id')::uuid,
         (elem->>'quantity')::numeric,
         get_fifo_consumption_cost((elem->>'product_id')::uuid, (elem->>'quantity')::numeric)
  FROM jsonb_array_elements(p_items) elem;

  -- BOTH legs in ONE statement: 023's statement-level recompute runs once
  -- afterwards and wins with the conserved total. Explicit unit_cost bypasses
  -- 033's fallback capture (trigger returns NEW unchanged when cost set).
  INSERT INTO stock_movements
    (business_id, product_id, warehouse_id, type, quantity, unit_cost,
     reference_type, reference_id, notes, created_by)
  SELECT t.business_id,
         l.product_id,
         CASE s.leg WHEN 0 THEN t.from_warehouse_id ELSE t.to_warehouse_id END,
         CASE s.leg WHEN 0 THEN 'transfer_out' ELSE 'transfer_in' END,
         CASE s.leg WHEN 0 THEN -l.quantity ELSE l.quantity END,
         l.unit_cost,
         'stock_transfer',
         t.id,
         t.notes,
         auth.uid()
  FROM stock_transfers t
  JOIN stock_transfer_lines l ON l.transfer_id = t.id
  CROSS JOIN (VALUES (0),(1)) AS s(leg)
  WHERE t.id = v_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 * (SELECT count(*) FROM stock_transfer_lines l WHERE l.transfer_id = v_id) THEN
    RAISE EXCEPTION 'Transfer leg insertion incomplete; transaction aborted';
  END IF;

  RETURN QUERY SELECT v_id, v_number;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_stock_transfer(uuid, uuid, uuid, jsonb, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_stock_transfer(uuid, uuid, uuid, jsonb, text, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- E. cancel_stock_transfer — flip status FIRST, then mirror actual posted legs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(
  p_transfer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_t RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO r_t FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock transfer % not found', p_transfer_id;
  END IF;
  IF NOT can_write_business(r_t.business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF r_t.status = 'cancelled' THEN
    RETURN;  -- idempotent
  END IF;

  UPDATE stock_transfers SET status = 'cancelled' WHERE id = r_t.id;

  -- Reversal built by READING actually-posted legs (house pattern): flip
  -- type and sign; the warehouse attribution stays on each original leg.
  INSERT INTO stock_movements
    (business_id, product_id, warehouse_id, type, quantity, unit_cost,
     reference_type, reference_id, notes, created_by)
  SELECT m.business_id,
         m.product_id,
         m.warehouse_id,
         CASE m.type WHEN 'transfer_out' THEN 'transfer_in' ELSE 'transfer_out' END,
         -m.quantity,
         m.unit_cost,
         'stock_transfer',
         r_t.id,
         'Reversal of ' || r_t.transfer_number,
         auth.uid()
  FROM stock_movements m
  WHERE m.reference_type = 'stock_transfer'
    AND m.reference_id = r_t.id;
END;
$$;
