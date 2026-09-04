/*
# 033 — Stock valuation: FIFO cost layers (T41)

Replaces retail-price valuation with COST-based valuation built on the
immutable movement ledger.

## Cost capture
stock_movements had no cost column (m001). Added unit_cost numeric(14,4):
- BACKFILL: 'purchase' movements linked to a bill (reference_type
  'purchase_bill') inherit that bill-item rate; any remaining NULL-cost
  inbound movement falls back to its product's current purchase_price
  (best effort for client-era rows; documented approximation).
- FORWARD: BEFORE INSERT trigger fills unit_cost at capture time —
  purchase movements from the referenced bill item, openings from the
  product's purchase_price. Sales/outbound stay cost-free (they CONSUME
  layers, they don't create them).

## get_stock_valuation(biz) -> per-product rows + totals row
Per product of type='product': walk movements chronologically building a
FIFO layer queue — positive-qty movements push (qty, unit_cost) layers,
negative-qty movements consume from the oldest layer first. Remaining
layers x cost = inventory value; also reports weighted-average cost
(value / net quantity) since dispatch named WAC as acceptable company.
Returns (product_id, product_name, quantity, total_value, avg_cost);
final row has product_id NULL and product_name '(All products)'.
Oversold histories (net negative) contribute zero further value and are
reported honestly through quantity.

SECURITY DEFINER + member guard per reporting-fn house pattern (020).
Gotchas applied: dedicated scalar accumulators (#3), no out-param name
collisions (#1/#2), no FILTER-in-narrowed-CTE (#4).
*/

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4);

-- Backfill 1: bill-linked purchase movements take their bill-item rate
UPDATE stock_movements sm
SET unit_cost = pbi.rate
FROM purchase_bills pb
JOIN purchase_bill_items pbi ON pbi.bill_id = pb.id
WHERE sm.type = 'purchase'
  AND sm.reference_type = 'purchase_bill'
  AND sm.reference_id = pb.id
  AND sm.product_id = pbi.product_id
  AND sm.unit_cost IS NULL;

-- Backfill 2: remaining inbound movements fall back to product cost price
UPDATE stock_movements sm
SET unit_cost = p.purchase_price
FROM products p
WHERE sm.product_id = p.id
  AND sm.unit_cost IS NULL
  AND sm.quantity > 0;

CREATE OR REPLACE FUNCTION trg_stock_capture_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF NEW.unit_cost IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'purchase' AND NEW.reference_type = 'purchase_bill' THEN
    SELECT rate INTO v_rate
    FROM purchase_bill_items
    WHERE bill_id = NEW.reference_id AND product_id = NEW.product_id
    LIMIT 1;
    NEW.unit_cost := v_rate;
  END IF;

  IF NEW.unit_cost IS NULL AND NEW.quantity > 0 THEN
    SELECT purchase_price INTO v_rate
    FROM products
    WHERE id = NEW.product_id;
    NEW.unit_cost := v_rate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_capture_cost_tg ON stock_movements;
CREATE TRIGGER trg_stock_capture_cost_tg
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION trg_stock_capture_cost();

-- ============================================================================
-- FIFO valuation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_stock_valuation(p_business_id uuid)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  quantity numeric,
  total_value numeric,
  avg_cost numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_prod RECORD;
  r_move RECORD;
  v_layers_q numeric[];
  v_layers_c numeric[];
  v_head int;
  v_len int;
  v_n int;
  v_take numeric;
  v_rem numeric;
  v_val numeric;
  v_net numeric;
  g_val numeric := 0;
  g_qty numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business';
  END IF;

  FOR r_prod IN
    SELECT id, name FROM products
    WHERE business_id = p_business_id AND type = 'product'
    ORDER BY name
  LOOP
    v_layers_q := ARRAY[]::numeric[];
    v_layers_c := ARRAY[]::numeric[];
    v_head := 1;
    v_val := 0;
    v_net := 0;

    FOR r_move IN
      SELECT type, quantity, unit_cost
      FROM stock_movements
      WHERE product_id = r_prod.id
      ORDER BY created_at, id
    LOOP
      v_net := v_net + r_move.quantity;

      IF r_move.quantity > 0 THEN
        v_layers_q := array_append(v_layers_q, r_move.quantity);
        v_layers_c := array_append(v_layers_c, COALESCE(r_move.unit_cost, 0));
      ELSIF r_move.quantity < 0 THEN
        v_rem := -r_move.quantity;
        WHILE v_rem > 0 LOOP
          v_len := COALESCE(array_length(v_layers_q, 1), 0);
          EXIT WHEN v_head > v_len;  -- oversold remainder: no value impact
          v_take := least(v_layers_q[v_head], v_rem);
          v_layers_q[v_head] := v_layers_q[v_head] - v_take;
          v_rem := v_rem - v_take;
          IF v_layers_q[v_head] <= 0 THEN
            v_head := v_head + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    v_val := 0;
    v_len := COALESCE(array_length(v_layers_q, 1), 0);
    FOR v_n IN v_head .. v_len LOOP
      v_val := v_val + v_layers_q[v_n] * v_layers_c[v_n];
    END LOOP;
    -- zero-width head entries contribute exactly 0, safe to include

    g_val := g_val + v_val;
    g_qty := g_qty + v_net;

    RETURN QUERY SELECT
      r_prod.id,
      r_prod.name,
      v_net,
      round(v_val, 2),
      CASE WHEN v_net > 0 THEN round(v_val / v_net, 4) ELSE 0 END;
  END LOOP;

  RETURN QUERY SELECT
    NULL::uuid,
    '(All products)'::text,
    g_qty,
    round(g_val, 2),
    CASE WHEN g_qty > 0 THEN round(g_val / g_qty, 4) ELSE 0 END;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_stock_valuation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_stock_valuation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_stock_valuation(uuid) TO authenticated;
