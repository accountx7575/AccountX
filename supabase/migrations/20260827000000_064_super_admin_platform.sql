/*
# 064 — Super Admin Platform controls (Native Auth Version)
Uses Supabase auth.users raw_app_meta_data for platform-level RBAC
*/

-- ============================================================================
-- A. Mark existing registered user as Super Admin in auth.users
-- ============================================================================
UPDATE auth.users
SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_super_admin": true}'::jsonb;

-- ============================================================================
-- B. Platform metrics RPC — super-admin only
-- ============================================================================
CREATE OR REPLACE FUNCTION get_platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super boolean;
  v_result jsonb;
BEGIN
  -- Strict gate: read from Supabase JWT / auth metadata
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) INTO v_is_super;

  -- Fallback check directly in auth.users table
  IF v_is_super IS NOT TRUE THEN
    SELECT coalesce((raw_app_meta_data ->> 'is_super_admin')::boolean, false)
    INTO v_is_super
    FROM auth.users
    WHERE id = auth.uid();
  END IF;

  IF v_is_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  SELECT jsonb_build_object(
    'total_businesses', (SELECT count(*) FROM businesses),
    'total_users', (SELECT count(*) FROM auth.users),
    'total_invoices', (SELECT count(*) FROM sales_invoices),
    'total_revenue', COALESCE((
      SELECT COALESCE(sum(total_amount), 0)
      FROM sales_invoices
      WHERE status IN ('paid', 'completed')
    ), 0)
  ) INTO v_result;

  RETURN v_result;
END
$$;

-- ============================================================================
-- C. Get all businesses for admin view — super-admin only
-- ============================================================================
CREATE OR REPLACE FUNCTION get_all_businesses_admin()
RETURNS TABLE (
  id uuid,
  name text,
  gstin text,
  owner_email text,
  created_at timestamptz,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super boolean;
BEGIN
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) INTO v_is_super;

  IF v_is_super IS NOT TRUE THEN
    SELECT coalesce((raw_app_meta_data ->> 'is_super_admin')::boolean, false)
    INTO v_is_super
    FROM auth.users
    WHERE id = auth.uid();
  END IF;

  IF v_is_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.gstin,
    u.email::text AS owner_email,
    b.created_at,
    COALESCE(b.is_active, true) AS is_active
  FROM businesses b
  LEFT JOIN business_members bm ON bm.business_id = b.id AND bm.role = 'owner'
  LEFT JOIN auth.users u ON u.id = bm.user_id
  ORDER BY b.created_at DESC;
END
$$;

-- ============================================================================
-- D. Toggle business active status — super-admin only
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_business_active(
  p_business_id uuid,
  p_status boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super boolean;
BEGIN
  SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false) INTO v_is_super;

  IF v_is_super IS NOT TRUE THEN
    SELECT coalesce((raw_app_meta_data ->> 'is_super_admin')::boolean, false)
    INTO v_is_super
    FROM auth.users
    WHERE id = auth.uid();
  END IF;

  IF v_is_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  UPDATE businesses
  SET is_active = p_status,
      updated_at = now()
  WHERE id = p_business_id;

  RETURN true;
END
$$;

-- ============================================================================
-- E. Permissions
-- ============================================================================
REVOKE EXECUTE ON FUNCTION get_platform_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_platform_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION get_platform_metrics() TO authenticated;

REVOKE EXECUTE ON FUNCTION get_all_businesses_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_all_businesses_admin() FROM anon;
GRANT EXECUTE ON FUNCTION get_all_businesses_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION toggle_business_active(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION toggle_business_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION toggle_business_active(uuid, boolean) TO authenticated;