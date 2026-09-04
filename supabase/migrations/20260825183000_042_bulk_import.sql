-- ============================================================================
-- # 042 — Bulk CSV-import RPCs: customers / suppliers / products (T75) [oscar]
--
-- ## SEMANTICS (chosen deliberately, one of two honest options)
-- VALID-ROWS-INSERTED-WITH-PER-ROW-ERROR-LIST. All three RPCs run in ONE
-- transaction; every row that passes validation is inserted, every rejected
-- row is SKIPPED and returned in errors[{row,field,message}] using the row's
-- ORIGINAL 0-based index in p_rows. There are no silent partials either way:
-- the caller always receives the exact fate of every row. (All-or-nothing
-- was rejected because a 500-row sheet with 1 bad row would force a full
-- re-upload cycle for one fix.)
--
-- ## DUPLICATE RULES
-- parties (customers/suppliers): within-business duplicate =
--    case/space-insensitive NAME match, else same non-blank GSTIN.
-- products: within-business duplicate =
--    case/space-insensitive NAME match, else same non-blank SKU.
-- Duplicates inside the payload are flagged ('duplicate in file'); races
-- against concurrent writers fall through to the m001 UNIQUE(business_id,
-- name) constraint and are caught as per-row unique_violation errors
-- WITHOUT aborting the rest of the batch.
--
-- ## FIELD RULES (server-side mirrors of client validators where they exist)
-- name required (non-blank). email: must contain '@' when present.
-- gstin: ^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$ when present. pan:
-- ^[A-Z]{5}[0-9]{4}[A-Z]$ when present. opening_balance: numeric >= 0,
-- ALLOWED for parties (m001 column exists; current_balance seeded equal).
-- products: type in ('product','service') default 'product'; prices/
-- tax_rate numeric >= 0. OPENING/CURRENT STOCK DELIBERATELY NOT IMPORTED —
-- stock changes must flow through stock_movements (023 append-only ledger +
-- FIFO valuation integrity); an importer writing product rows directly
-- would create unvalued catalog ghosts. Documented v1 boundary.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_import_customers(
  p_business_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rec RECORD;
  v_idx int := -1;
  v_name text;
  v_email text;
  v_gstin text;
  v_pan text;
  v_ob numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must be a non-empty JSON array';
  END IF;

  FOR v_rec IN
    SELECT elem.*, ordinality - 1 AS rownum
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS elem
  LOOP
    v_idx := v_rec.rownum;
    BEGIN
      v_name  := NULLIF(btrim(COALESCE(v_rec.value->>'name', '')), '');
      v_email := NULLIF(btrim(COALESCE(v_rec.value->>'email', '')), '');
      v_gstin := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'gstin', ''))), '');
      v_pan   := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'pan', ''))), '');

      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Name is required');
        CONTINUE;
      END IF;

      IF v_email IS NOT NULL AND v_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'Invalid email format');
        CONTINUE;
      END IF;

      IF v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'gstin', 'message', 'Invalid GSTIN format');
        CONTINUE;
      END IF;

      IF v_pan IS NOT NULL AND v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'pan', 'message', 'Invalid PAN format');
        CONTINUE;
      END IF;

      BEGIN
        v_ob := NULLIF(btrim(COALESCE(v_rec.value->>'opening_balance', '')), '')::numeric;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Not a valid number');
        CONTINUE;
      END;
      IF v_ob IS NOT NULL AND v_ob < 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Must be zero or positive');
        CONTINUE;
      END IF;

      -- Duplicate rule: name (case/space-insensitive) or GSTIN
      IF EXISTS (
        SELECT 1 FROM customers c
        WHERE c.business_id = p_business_id
          AND (lower(btrim(c.name)) = lower(v_name)
               OR (v_gstin IS NOT NULL AND c.gstin = v_gstin))
      ) THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate: a customer with this name or GSTIN already exists');
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO customers
          (business_id, name, company_name, phone, email, gstin, pan,
           address, city, state, opening_balance, current_balance)
        VALUES
          (p_business_id, v_name,
           NULLIF(btrim(COALESCE(v_rec.value->>'company_name','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'phone','')), ''),
           v_email, v_gstin, v_pan,
           NULLIF(btrim(COALESCE(v_rec.value->>'address','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'city','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'state','')), ''),
           COALESCE(v_ob, 0), COALESCE(v_ob, 0));
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate customer name (concurrent insert)');
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', NULL, 'message', 'Unexpected error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_import_suppliers(
  p_business_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rec RECORD;
  v_idx int := -1;
  v_name text;
  v_email text;
  v_gstin text;
  v_pan text;
  v_ob numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must be a non-empty JSON array';
  END IF;

  FOR v_rec IN
    SELECT elem.*, ordinality - 1 AS rownum
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS elem
  LOOP
    v_idx := v_rec.rownum;
    BEGIN
      v_name  := NULLIF(btrim(COALESCE(v_rec.value->>'name', '')), '');
      v_email := NULLIF(btrim(COALESCE(v_rec.value->>'email', '')), '');
      v_gstin := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'gstin', ''))), '');
      v_pan   := NULLIF(btrim(UPPER(COALESCE(v_rec.value->>'pan', ''))), '');

      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Name is required');
        CONTINUE;
      END IF;

      IF v_email IS NOT NULL AND v_email !~* '^[^@]+@[^@]+\.[^@]+$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'email', 'message', 'Invalid email format');
        CONTINUE;
      END IF;

      IF v_gstin IS NOT NULL AND v_gstin !~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'gstin', 'message', 'Invalid GSTIN format');
        CONTINUE;
      END IF;

      IF v_pan IS NOT NULL AND v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'pan', 'message', 'Invalid PAN format');
        CONTINUE;
      END IF;

      BEGIN
        v_ob := NULLIF(btrim(COALESCE(v_rec.value->>'opening_balance', '')), '')::numeric;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Not a valid number');
        CONTINUE;
      END;
      IF v_ob IS NOT NULL AND v_ob < 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'opening_balance', 'message', 'Must be zero or positive');
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM suppliers s
        WHERE s.business_id = p_business_id
          AND (lower(btrim(s.name)) = lower(v_name)
               OR (v_gstin IS NOT NULL AND s.gstin = v_gstin))
      ) THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate: a supplier with this name or GSTIN already exists');
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO suppliers
          (business_id, name, company_name, phone, email, gstin, pan,
           address, city, state, opening_balance, current_balance)
        VALUES
          (p_business_id, v_name,
           NULLIF(btrim(COALESCE(v_rec.value->>'company_name','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'phone','')), ''),
           v_email, v_gstin, v_pan,
           NULLIF(btrim(COALESCE(v_rec.value->>'address','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'city','')), ''),
           NULLIF(btrim(COALESCE(v_rec.value->>'state','')), ''),
           COALESCE(v_ob, 0), COALESCE(v_ob, 0));
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate supplier name (concurrent insert)');
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', NULL, 'message', 'Unexpected error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
END;
$$;

-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_import_products(
  p_business_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rec RECORD;
  v_idx int := -1;
  v_name text;
  v_sku text;
  v_type text;
  v_pp numeric;
  v_sp numeric;
  v_tax numeric;
  v_min numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT can_write_business(p_business_id) THEN
    RAISE EXCEPTION 'You do not have write access to this business';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must be a non-empty JSON array';
  END IF;

  FOR v_rec IN
    SELECT elem.*, ordinality - 1 AS rownum
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS elem
  LOOP
    v_idx := v_rec.rownum;
    BEGIN
      v_name := NULLIF(btrim(COALESCE(v_rec.value->>'name', '')), '');
      v_sku  := NULLIF(btrim(COALESCE(v_rec.value->>'sku', '')), '');
      v_type := LOWER(btrim(COALESCE(v_rec.value->>'type', 'product')));

      IF v_name IS NULL THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Name is required');
        CONTINUE;
      END IF;

      IF v_type NOT IN ('product', 'service') THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'type', 'message', 'Must be product or service');
        CONTINUE;
      END IF;

      BEGIN
        v_pp  := NULLIF(btrim(COALESCE(v_rec.value->>'purchase_price', '')), '')::numeric;
        v_sp  := NULLIF(btrim(COALESCE(v_rec.value->>'selling_price', '')), '')::numeric;
        v_tax := NULLIF(btrim(COALESCE(v_rec.value->>'tax_rate', '')), '')::numeric;
        v_min := NULLIF(btrim(COALESCE(v_rec.value->>'minimum_stock', '')), '')::numeric;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'prices', 'message', 'Price/tax/minimum_stock must be numeric');
        CONTINUE;
      END;
      IF COALESCE(v_pp, 0) < 0 OR COALESCE(v_sp, 0) < 0 OR COALESCE(v_tax, 0) < 0 OR COALESCE(v_min, 0) < 0 THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'prices', 'message', 'Prices, tax rate and minimum stock must be zero or positive');
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1 FROM products pr
        WHERE pr.business_id = p_business_id
          AND (lower(btrim(pr.name)) = lower(v_name)
               OR (v_sku IS NOT NULL AND pr.sku = v_sku))
      ) THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate: a product with this name or SKU already exists');
        CONTINUE;
      END IF;

      BEGIN
        INSERT INTO products
          (business_id, name, sku, type, hsn_sac, unit,
           purchase_price, selling_price, tax_rate, minimum_stock, description)
        VALUES
          (p_business_id, v_name, v_sku, v_type,
           NULLIF(btrim(COALESCE(v_rec.value->>'hsn_sac','')), ''),
           COALESCE(NULLIF(btrim(COALESCE(v_rec.value->>'unit','')), ''), 'PCS'),
           COALESCE(v_pp, 0), COALESCE(v_sp, 0), COALESCE(v_tax, 0), COALESCE(v_min, 0),
           NULLIF(btrim(COALESCE(v_rec.value->>'description','')), ''));
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', 'name', 'message', 'Duplicate product name/SKU (concurrent insert)');
      END;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'field', NULL, 'message', 'Unexpected error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_import_customers(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_import_suppliers(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bulk_import_products(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_customers(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_suppliers(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_products(uuid, jsonb) TO authenticated;
