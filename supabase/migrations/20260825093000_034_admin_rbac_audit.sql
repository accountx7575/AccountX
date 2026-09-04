/*
# 034 — Admin control panel: member lifecycle RPCs + audit hardening (T60)

Reconciles the T60 audit-log contract with the EXISTING audit_logs table
(m001:873, server-write-only since 024 dropped its INSERT policy) instead
of creating a second log: additive columns only, legacy writers (024/027/
028) keep working untouched.

DEVIATION FROM CONTRACT (flagged to god): id stays uuid — converting a
live audited table's pk to bigint generated buys nothing and risks
Stanley's already-coded hooks reading string ids.

A. business_members evolution: status ('pending'|'active'|'revoked'),
   nullable user_id (pending rows carry invite_email instead), CHECK
   tying them together, dedupe index on pending invites.
B. Helpers tightened: revoked/pending rows grant NOTHING (status='active'
   added to is_business_member / can_write_business / is_business_admin).
C. audit_logs gains actor / actor_email / meta / ip / device (+ backfill).
D. write_audit() internal definer helper capturing invoker identity.
E. Frozen-signature member RPCs: invite / change-role / revoke /
   transfer-ownership — all owner/admin-gated per THAT business,
   last-owner guarded, every mutation audited.
F. GST settings change trigger on businesses (security-sensitive field).
*/

-- ============================================================================
-- A. business_members: pending/revoked lifecycle
-- ============================================================================
ALTER TABLE business_members ADD COLUMN IF NOT EXISTS status text
  NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'revoked'));

ALTER TABLE business_members ADD COLUMN IF NOT EXISTS invite_email text;

ALTER TABLE business_members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE business_members DROP CONSTRAINT IF EXISTS bm_lifecycle_shape;
ALTER TABLE business_members ADD CONSTRAINT bm_lifecycle_shape CHECK (
  (status = 'pending' AND user_id IS NULL AND invite_email IS NOT NULL)
  OR (status <> 'pending' AND user_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bm_pending_email_per_biz
  ON business_members(business_id, lower(invite_email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bm_status ON business_members(business_id, status);

-- ============================================================================
-- B. Membership helpers: only ACTIVE members count
-- ============================================================================
CREATE OR REPLACE FUNCTION is_business_member(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION can_write_business(b_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = b_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND is_active = true
      AND role IN ('owner', 'admin', 'manager', 'accountant', 'sales_staff', 'purchase_staff', 'inventory_staff')
  );
$$;

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
      AND status = 'active'
      AND is_active = true
      AND role IN ('owner', 'admin')
  );
$$;

-- ============================================================================
-- C. audit_logs: extend toward T60 contract + backfill
-- ============================================================================
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_email text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device text;

UPDATE audit_logs SET actor = user_id WHERE actor IS NULL AND user_id IS NOT NULL;

UPDATE audit_logs a
SET actor_email = u.email
FROM auth.users u
WHERE a.actor = u.id AND a.actor_email IS NULL;

-- ============================================================================
-- D. Audit writer (definer-internal)
-- ============================================================================
CREATE OR REPLACE FUNCTION write_audit(
  p_business_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_meta jsonb DEFAULT '{}',
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_email text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  INSERT INTO audit_logs (business_id, user_id, actor, actor_email, action,
    entity_type, entity_id, meta, description)
  VALUES (p_business_id, v_actor, v_actor, COALESCE(v_email, 'unknown'),
    p_action, p_entity_type, p_entity_id, p_meta, p_description);
END;
$$;

REVOKE EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION write_audit(uuid, text, text, text, jsonb, text) FROM authenticated;

-- ============================================================================
-- E. Member management RPCs (frozen signatures)
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_invite_member(
  p_business_id uuid,
  p_email text,
  p_role text
)
RETURNS business_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_row business_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT is_business_admin(p_business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can invite members';
  END IF;

  v_clean := lower(trim(p_email));
  IF v_clean !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;
  IF p_role NOT IN ('admin', 'manager', 'accountant', 'sales_staff', 'purchase_staff', 'inventory_staff', 'viewer') THEN
    RAISE EXCEPTION 'Role % cannot be granted via invite', p_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM business_members bm
    JOIN auth.users u ON u.id = bm.user_id
    WHERE bm.business_id = p_business_id
      AND bm.status <> 'revoked'
      AND lower(u.email) = v_clean
  ) OR EXISTS (
    SELECT 1 FROM business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.status = 'pending'
      AND lower(bm.invite_email) = v_clean
  ) THEN
    RAISE EXCEPTION 'That email is already a member or has a pending invitation';
  END IF;

  INSERT INTO business_members (business_id, user_id, role, status, is_active, invited_at, invite_email)
  VALUES (p_business_id, NULL, p_role, 'pending', true, now(), v_clean)
  RETURNING * INTO v_row;

  PERFORM write_audit(p_business_id, 'member_invited', 'business_member',
    v_row.id::text, jsonb_build_object('email', v_clean, 'role', p_role),
    'Invitation created for ' || v_clean || ' as ' || p_role);

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION admin_change_member_role(
  p_member_id uuid,
  p_new_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target business_members%ROWTYPE;
  v_caller_is_owner boolean;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_target FROM business_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'Only active members can change role';
  END IF;
  IF NOT is_business_admin(v_target.business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can change member roles';
  END IF;
  IF p_new_role NOT IN ('owner','admin','manager','accountant','sales_staff','purchase_staff','inventory_staff','viewer') THEN
    RAISE EXCEPTION 'Unknown role %', p_new_role;
  END IF;

  IF v_target.role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT EXISTS (
      SELECT 1 FROM business_members
      WHERE business_id = v_target.business_id AND user_id = auth.uid()
        AND role = 'owner' AND status = 'active'
    ) INTO v_caller_is_owner;
    IF NOT v_caller_is_owner THEN
      RAISE EXCEPTION 'Only an owner can demote another owner';
    END IF;
    SELECT count(*) INTO v_owner_count
    FROM business_members
    WHERE business_id = v_target.business_id
      AND role = 'owner' AND status = 'active' AND is_active = true;
    IF v_target.user_id = auth.uid() AND v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of a business';
    END IF;
    IF v_target.user_id <> auth.uid() AND v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of a business';
    END IF;
  END IF;

  UPDATE business_members SET role = p_new_role WHERE id = p_member_id;

  PERFORM write_audit(v_target.business_id, 'member_role_changed', 'business_member',
    p_member_id::text, jsonb_build_object('from', v_target.role, 'to', p_new_role),
    'Role changed from ' || v_target.role || ' to ' || p_new_role);

  RETURN p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_revoke_member(
  p_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target business_members%ROWTYPE;
  v_owner_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_target FROM business_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target.status = 'revoked' THEN
    RAISE EXCEPTION 'Member is already revoked';
  END IF;
  IF NOT is_business_admin(v_target.business_id) THEN
    RAISE EXCEPTION 'Only owners and admins can revoke members';
  END IF;
  IF v_target.role = 'owner' THEN
    IF v_target.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Cannot revoke yourself as the only owner - transfer ownership first';
    END IF;
    SELECT count(*) INTO v_owner_count
    FROM business_members
    WHERE business_id = v_target.business_id
      AND role = 'owner' AND status = 'active' AND is_active = true;
    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot revoke the last owner of a business';
    END IF;
  END IF;

  UPDATE business_members
  SET status = 'revoked', is_active = false
  WHERE id = p_member_id;

  PERFORM write_audit(v_target.business_id, 'member_revoked', 'business_member',
    p_member_id::text, jsonb_build_object('role', v_target.role, 'was_pending', v_target.status = 'pending'),
    'Membership revoked (soft delete - row preserved for audit integrity)');

  RETURN p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_transfer_ownership(
  p_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target business_members%ROWTYPE;
  v_caller business_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_target FROM business_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'Ownership can only transfer to an active member';
  END IF;

  SELECT * INTO v_caller FROM business_members
  WHERE business_id = v_target.business_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_caller.role <> 'owner' OR v_caller.status <> 'active' OR v_caller.is_active = false THEN
    RAISE EXCEPTION 'Only the current owner can transfer ownership';
  END IF;
  IF v_target.id = v_caller.id THEN
    RAISE EXCEPTION 'You already own this business';
  END IF;

  UPDATE business_members SET role = 'owner'
  WHERE id = v_target.id;

  UPDATE business_members SET role = 'admin'
  WHERE id = v_caller.id;

  PERFORM write_audit(v_target.business_id, 'ownership_transferred', 'business_member',
    v_target.id::text, jsonb_build_object('new_owner_member', v_target.id, 'previous_owner_user', v_caller.user_id),
    'Ownership transferred; previous owner demoted to admin');

  RETURN v_target.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_invite_member(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_invite_member(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_invite_member(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_change_member_role(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_change_member_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_change_member_role(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_revoke_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_revoke_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_revoke_member(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_transfer_ownership(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_transfer_ownership(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_transfer_ownership(uuid) TO authenticated;

-- ============================================================================
-- F. GST settings change hook (security-sensitive)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_businesses_audit_gst()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.gst_registered IS DISTINCT FROM NEW.gst_registered
     OR OLD.gstin IS DISTINCT FROM NEW.gstin
     OR OLD.pan IS DISTINCT FROM NEW.pan THEN
    PERFORM write_audit(NEW.id, 'gst_settings_changed', 'business', NEW.id::text,
      jsonb_build_object(
        'gst_registered', NEW.gst_registered,
        'gstin_was', OLD.gstin, 'gstin_now', NEW.gstin,
        'pan_was', OLD.pan, 'pan_now', NEW.pan
      ),
      'GST registration details changed');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_gst_audit_tg ON businesses;
CREATE TRIGGER trg_businesses_gst_audit_tg
AFTER UPDATE ON businesses
FOR EACH ROW EXECUTE FUNCTION trg_businesses_audit_gst();
