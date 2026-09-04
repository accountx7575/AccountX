/*
# 024 — RLS tightening (T29)

1. businesses_update: any-member -> owner/admin only (is_business_admin).
   Profile edits are a governance action, not a daily-use one.
2. NEW helper is_business_admin(b_id): active member with role
   owner/admin. SECURITY DEFINER, pinned search_path, EXECUTE to
   authenticated only (m004 regime).
3. audit_logs: permissive INSERT policy DROPPED. The audit trail is now
   server-written ONLY — inserts happen inside SECURITY DEFINER RPCs
   (017/022 flows already do); direct client inserts will be denied.
   FE paths still writing audit rows client-side must route through the
   document RPCs instead.
4. business_members DELETE: policy added (owner/admin gated) + companion
   remove_business_member(biz, target_user_id) RPC with guards:
   caller must be owner/admin; an owner row can only be removed by its
   own owner or when another owner remains (never leaves a headless
   business); self-removal allowed for non-owner roles; audit row written.
*/

-- ============================================================================
-- Admin helper
-- ============================================================================
CREATE OR REPLACE FUNCTION is_business_admin(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id
      AND user_id = auth.uid()
      AND is_active = true
      AND role IN ('owner', 'admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION is_business_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_business_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_business_admin(uuid) TO authenticated;

-- ============================================================================
-- businesses_update tightened
-- ============================================================================
DROP POLICY IF EXISTS "businesses_update" ON businesses;
CREATE POLICY "businesses_update" ON businesses FOR UPDATE
  TO authenticated USING (is_business_admin(businesses.id))
  WITH CHECK (is_business_admin(businesses.id));

-- ============================================================================
-- audit_logs: server-write only
-- ============================================================================
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;

-- ============================================================================
-- business_members: delete policy + removal RPC
-- ============================================================================
DROP POLICY IF EXISTS "members_delete" ON business_members;
CREATE POLICY "members_delete" ON business_members FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM business_members bm
      WHERE bm.business_id = business_members.business_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin')
        AND bm.is_active = true
    )
  );

CREATE OR REPLACE FUNCTION remove_business_member(
  p_business_id uuid,
  p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target RECORD;
  v_caller_is_owner boolean;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can remove members';
  END IF;

  SELECT * INTO v_target FROM business_members
  WHERE business_id = p_business_id AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found in this business';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = p_business_id AND user_id = auth.uid()
      AND role = 'owner' AND is_active = true
  ) INTO v_caller_is_owner;

  IF v_target.role = 'owner' THEN
    IF NOT v_caller_is_owner THEN
      RAISE EXCEPTION 'Only an owner can remove another owner';
    END IF;

    SELECT count(*) INTO v_owner_count
    FROM business_members
    WHERE business_id = p_business_id
      AND role = 'owner' AND is_active = true;

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of a business';
    END IF;
  END IF;

  DELETE FROM business_members
  WHERE business_id = p_business_id AND user_id = p_target_user_id;

  INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, description)
  VALUES (p_business_id, auth.uid(), 'member_removed', 'business_member', p_target_user_id,
          'Removed member with role ' || v_target.role);

  RETURN p_target_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_business_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION remove_business_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION remove_business_member(uuid, uuid) TO authenticated;
