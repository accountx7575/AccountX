/*
# 064 — Super Admin Platform controls

Add super_admin flag to profiles, platform metrics RPC, all-businesses view,
and business toggle. These are founder-tier controls for multi-tenant
governance — strictly gated on `is_super_admin = true`.

DEVIATION FLAG: The "primary account user" determination is application-
level. This migration sets the column and creates the RPCs; the caller
(or a separate onboarding migration) should resolve which profile is the
founder and set `is_super_admin = true` accordingly.
*/

-- ============================================================================
-- A. profiles: is_super_admin flag
-- ============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin boolean
  NOT NULL DEFAULT false;

-- ============================================================================
-- B. Set the primary account user as super_admin
--    (The founding user is identified as the owner of the first business,
--    or the earliest profile by id. This migration marks the profile
--    associated with the first business owner as super_admin.)
-- ============================================================================
UPDATE profiles
SET is_super_admin = true
WHERE id = (
  SELECT bm.user_id
  FROM business_members bm
  WHERE bm.status = 'active'
    AND bm.is_active = true
  ORDER BY bm.joined_at ASC NULLS FIRST
  LIMIT 1
);

-- If no business_members exist yet, fall back to the earliest profile:
UPDATE profiles
SET is_super_admin = true
WHERE id = (
  SELECT id FROM profiles ORDER BY id ASC LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM business_members WHERE status = 'active'
);

-- ============================================================================
-- C. Platform metrics RPC — super-admin only
-- ============================================================================
CREATE OR REPLACE FUNCTION get_platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_super boolean;
  v_result jsonb;
BEGIN
  -- Strict gate: only super admins may read platform metrics
  SELECT is_super_admin INTO v_is_super
  FROM profiles
  WHERE id = v_user_id;

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
-- D. Get all businesses for admin view — super-admin only
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
  v_user_id uuid := auth.uid();
  v_is_super boolean;
BEGIN
  -- Strict gate: only super admins may list all businesses
  SELECT is_super_admin INTO v_is_super
  FROM profiles
  WHERE id = v_user_id;

  IF v_is_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.gstin,
    u.email AS owner_email,
    b.created_at,
    bm.is_active
  FROM businesses b
  JOIN business_members bm ON bm.business_id = b.id
    AND bm.status = 'active'
    AND bm.is_active = true
    AND bm.role = 'owner'
  JOIN auth.users u ON u.id = bm.user_id
  ORDER BY b.created_at DESC;
END
$$;

-- ============================================================================
-- E. Toggle business active status — super-admin only
-- ============================================================================
CREATE OR REPLACE FUNCTION toggle_business_active(
  p_business_id uuid,
  p_status boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_super boolean;
BEGIN
  -- Strict gate: only super admins may toggle business status
  SELECT is_super_admin INTO v_is_super
  FROM profiles
  WHERE id = v_user_id;

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
-- F. Revoke public/anon access, grant to authenticated only
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