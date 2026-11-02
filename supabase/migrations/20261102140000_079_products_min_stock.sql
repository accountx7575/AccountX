-- Migration 079: Add min_stock and reorder_level to products table and keep stock levels in sync
-- Resolves PostgREST schema cache error: "Could not find the 'min_stock' column of 'products' in the schema cache"

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS min_stock NUMERIC DEFAULT 0;

-- Also support reorder_level if referenced elsewhere
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS reorder_level NUMERIC DEFAULT 0;

-- Backfill min_stock and reorder_level from existing minimum_stock
UPDATE products
SET min_stock = COALESCE(NULLIF(minimum_stock, 0), min_stock, 0),
    reorder_level = COALESCE(NULLIF(minimum_stock, 0), reorder_level, 0);

-- Sync trigger to keep minimum_stock, min_stock, and reorder_level consistent across all inserts and updates
CREATE OR REPLACE FUNCTION trg_sync_product_stock_levels()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.minimum_stock IS NOT NULL AND NEW.minimum_stock <> 0 THEN
      NEW.min_stock := NEW.minimum_stock;
      NEW.reorder_level := NEW.minimum_stock;
    ELSIF NEW.min_stock IS NOT NULL AND NEW.min_stock <> 0 THEN
      NEW.minimum_stock := NEW.min_stock;
      NEW.reorder_level := NEW.min_stock;
    ELSIF NEW.reorder_level IS NOT NULL AND NEW.reorder_level <> 0 THEN
      NEW.minimum_stock := NEW.reorder_level;
      NEW.min_stock := NEW.reorder_level;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.min_stock IS DISTINCT FROM OLD.min_stock THEN
      NEW.minimum_stock := NEW.min_stock;
      NEW.reorder_level := NEW.min_stock;
    ELSIF NEW.minimum_stock IS DISTINCT FROM OLD.minimum_stock THEN
      NEW.min_stock := NEW.minimum_stock;
      NEW.reorder_level := NEW.minimum_stock;
    ELSIF NEW.reorder_level IS DISTINCT FROM OLD.reorder_level THEN
      NEW.minimum_stock := NEW.reorder_level;
      NEW.min_stock := NEW.reorder_level;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_product_stock_levels_on_products ON products;
CREATE TRIGGER trg_sync_product_stock_levels_on_products
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION trg_sync_product_stock_levels();

-- Ensure permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON products TO authenticated, anon, service_role;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
