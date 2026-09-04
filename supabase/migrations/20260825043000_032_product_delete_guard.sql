/*
# 032 — Product delete guard / archive pattern (T39)

Problem (card T39): m001 wires stock_movements.product_id ON DELETE
CASCADE (:408), so deleting a product silently destroys immutable stock
history. Since 023 the append-only trigger on stock_movements already
blocks that cascade — but as a cryptic low-level error fired from the
wrong table, and only by accident of ordering.

Chosen option (simpler J2-legal one per dispatch): BLOCK deletes when
movement history exists, RAISE actionable guidance to ARCHIVE instead.
No new archive column needed — products.is_active (m001:374) already IS
the archive flag; adding a second flag would split the truth.

Behaviour after this migration:
- Product WITH any stock_movements row -> hard DELETE rejected with an
  explicit message naming the product and the archive action.
- Product with NO movements (typo/duplicate never used) -> deletes
  cleanly (nothing historical exists to lose).
- Doc lines are unaffected either way: invoice/bill/CN/DN/QT/SO/PO item
  FKs are SET NULL and every line carries its own product_name snapshot.
- 023's append-only trigger stays as defence-in-depth on movements.

FE implication for Stanley: product lists should default-filter
is_active=true; the destructive "Delete" button becomes "Archive"
(UPDATE is_active=false) once a product has been transacted; plain
delete remains available only for never-moved products (the RPC-free
table delete will simply succeed there).

RLS note: guard runs INVOKER — writers pass can_write_business and
stock_movements SELECT policy is member-scoped, so EXISTS resolves
within the caller's visible rows (a product row itself is already
business-scoped, so no cross-business leak is possible).
*/

CREATE OR REPLACE FUNCTION trg_products_protect_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_move_count bigint;
BEGIN
  SELECT count(*) INTO v_move_count
  FROM stock_movements
  WHERE product_id = OLD.id;

  IF v_move_count > 0 THEN
    RAISE EXCEPTION 'Product % has % stock movement(s) and cannot be deleted - archive it instead (UPDATE products SET is_active = false WHERE id = ''%'')',
      OLD.name, v_move_count, OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_no_delete_history ON products;
CREATE TRIGGER trg_products_no_delete_history
BEFORE DELETE ON products
FOR EACH ROW EXECUTE FUNCTION trg_products_protect_history();
