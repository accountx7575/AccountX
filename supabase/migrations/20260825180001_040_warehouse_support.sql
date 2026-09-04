-- ============================================================================
-- # 040 — Warehouse support for honest CRUD + per-warehouse stock (T66) [oscar]
--
-- m001 already ships full RLS CRUD policies on warehouses, so a UI needs no
-- new access layer. What IS genuinely missing:
--   1. Delete guard: stock_movements.warehouse_id is ON DELETE SET NULL, so
--      deleting a warehouse today SILENTLY erases attribution of all its
--      movement history (and breaks transfer provenance). BEFORE DELETE
--      trigger now blocks when referenced, with an actionable message.
--   2. One default per business: is_default had no uniqueness guarantee;
--      existing duplicate defaults are normalized deterministically
--      (earliest created_at, tie-break id) before a partial unique index.
--   3. v_warehouse_stock: security_invoker net quantity per (warehouse,
--      product) from attributed movements only — the read surface for any
--      warehouse UI. NULL-attribution legacy rows are excluded by design;
--      they remain visible in total product stock.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Referential delete guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.forbid_warehouse_delete_with_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_moves bigint;
  v_transfers bigint;
BEGIN
  SELECT count(*) INTO v_moves FROM stock_movements sm WHERE sm.warehouse_id = OLD.id;
  IF v_moves > 0 THEN
    RAISE EXCEPTION 'Warehouse % has % stock movement(s) on record and cannot be deleted; history must stay attributable', OLD.name, v_moves;
  END IF;

  SELECT count(*) INTO v_transfers FROM stock_transfers t
   WHERE t.from_warehouse_id = OLD.id OR t.to_warehouse_id = OLD.id;
  IF v_transfers > 0 THEN
    RAISE EXCEPTION 'Warehouse % appears in % stock transfer(s) and cannot be deleted; route history must stay intact', OLD.name, v_transfers;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_warehouses_delete_guard ON warehouses;
CREATE TRIGGER trg_warehouses_delete_guard
BEFORE DELETE ON warehouses
FOR EACH ROW EXECUTE FUNCTION forbid_warehouse_delete_with_history();

-- ----------------------------------------------------------------------------
-- B. Normalize duplicate defaults, then enforce one default per business
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE warehouses w
     SET is_default = false
   WHERE is_default
     AND id <> (
       SELECT id FROM warehouses w2
        WHERE w2.business_id = w.business_id
          AND w2.is_default
        ORDER BY w2.created_at, w2.id
        LIMIT 1
     );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_one_default_per_business
  ON warehouses(business_id)
  WHERE is_default;

-- ----------------------------------------------------------------------------
-- C. Per-warehouse stock view (security_invoker: caller's membership gates it)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_warehouse_stock;
CREATE VIEW public.v_warehouse_stock
WITH (security_invoker = on)
AS
SELECT
  sm.business_id,
  sm.warehouse_id,
  w.name  AS warehouse_name,
  sm.product_id,
  p.name  AS product_name,
  SUM(sm.quantity)              AS quantity,
  MAX(sm.created_at)            AS last_movement_at
FROM stock_movements sm
JOIN warehouses w ON w.id = sm.warehouse_id
JOIN products p   ON p.id = sm.product_id
GROUP BY sm.business_id, sm.warehouse_id, w.name, sm.product_id, p.name;
