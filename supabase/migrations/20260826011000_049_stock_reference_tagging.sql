-- ============================================================================
-- 049: stock movement reference tagging (T92 verification-sweep patch)
--
-- Sweep finding: the ONLY writers that leave stock_movements.reference_type /
-- reference_id NULL are legitimate root events with no upstream document:
--   * type='opening'           — FE product creation (ProductCreatePage
--                                inserts directly; no source doc exists)
--   * reference_type='manual_adjustment' — post_stock_adjustment_atomic
--                                (036) passes its movement id to the JOURNAL,
--                                but leaves the movement's own reference_id NULL
-- Every doc-driven writer (017 issue/confirm, 030 promotion, 022 CN/DN and
-- cancellations, 036 invoice/bill cancels, 039 transfer legs + cancel)
-- already tags fully.
--
-- This card makes the "every movement references its source" invariant
-- universally true, metadata-only (no quantity / balance / date is touched):
--   1) BEFORE INSERT trigger tags future rows at write time;
--   2) one-time idempotent backfill for existing NULL rows. The backfill
--      temporarily disables trg_stock_append_only (023 forbids UPDATE on
--      this table) INSIDE this migration's transaction — if anything raises,
--      the whole migration rolls back WITH the trigger still enabled.
-- Backfill is safe to re-run: WHERE clauses leave tagged rows untouched.
-- Idempotency note: uq-style partial unique indexes are unaffected; the
-- 036 duplicate-posting backstop lives on journal_entries, not here.
-- ============================================================================

CREATE OR REPLACE FUNCTION tag_stock_movement_references()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Opening stock: root event, source = the product row itself.
  IF NEW.type = 'opening' AND NEW.reference_type IS NULL THEN
    NEW.reference_type := 'product_opening';
  END IF;
  IF NEW.reference_type = 'product_opening' AND NEW.reference_id IS NULL THEN
    NEW.reference_id := NEW.product_id;
  END IF;
  -- Manual adjustments: self-reference so the movement is joinable from
  -- its journal (which already carries this id as reference_id).
  IF NEW.reference_type = 'manual_adjustment' AND NEW.reference_id IS NULL THEN
    NEW.reference_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_reference_tagging ON stock_movements;
CREATE TRIGGER trg_stock_reference_tagging
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION tag_stock_movement_references();

-- ----------------------------------------------------------------------------
-- One-time backfill (metadata only). Append-only guard lifted for exactly
-- these two statements inside this transaction.
-- ----------------------------------------------------------------------------
ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_append_only;

UPDATE stock_movements
SET reference_type = 'product_opening', reference_id = product_id
WHERE type = 'opening'
  AND reference_type IS NULL;

UPDATE stock_movements
SET reference_id = id
WHERE reference_type = 'manual_adjustment'
  AND reference_id IS NULL;

ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_append_only;
