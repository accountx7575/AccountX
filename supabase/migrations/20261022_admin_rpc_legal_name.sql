-- ============================================================================
-- PBS-177 — durable fix: get_all_businesses_admin() displayed NULL names for
--            console-created tenants
--
-- FACT CHAIN
--   * get_all_businesses_admin() (20260827000000_064:59-101, SECURITY DEFINER)
--     RETURN QUERY selected ONLY b.name. This was the family's column blind
--     spot, same as the human's verification query found.
--   * The console onboard path (SuperAdminPage.tsx:691-696) writes the tenant
--     display name into legal_name (trade_name too) and does NOT set `name`
--     — console rows have name NULL by design.
--   * The RPC creation path (20260821052132_002:67-76) inserts BOTH name and
--     legal_name.
--   * So once PBS-174's purge removes the probe rows, every FUTURE
--     console-created REAL tenant listed as 'Unnamed Business' on the admin
--     RPC path (the primary): the page mapping is `b.legal_name || b.name`
--     (SuperAdminPage.tsx:336), the rpc row carries neither.
--
-- THE FIX (minimal)
--   * coalesce(b.legal_name, b.name) into the existing `name` display
--     column — the SAME convention super_admin_tenant_metrics() already
--     uses (20261022_super_admin_tenant_metrics.sql line 101). Shape,
--     gate, role, VOLATILITY, and grants are unchanged.
--   * A row with BOTH columns NULL still displays NULL → the page's
--     'Unnamed Business' fallback catches it (console tenants always have
--     legal_name, so a NULL/NULL row is a hand-poke anomaly, not a path bug).
--
-- SAFETY
--   * CREATE OR REPLACE — the function keeps its owner (and therefore its
--     SECURITY DEFINER target); privileges are re-asserted idempotently
--     anyway so the 064 contract (REVOKE PUBLIC/anon, GRANT authenticated)
--     is guaranteed after this file runs.
--   * Idempotent: safe to re-run.
--   * The preview block is a commented transaction WITH ROLLBACK — run it
--     first, verify the display name and shape, then run the CREATE OR
--     REPLACE. It needs the JWT-claims hijack because the SQL editor has no
--     real session (auth.uid() is NULL there → the function would reject a
--     plain invocation with 'Super admin access required' — the gate is
--     working; the preview just has to look like a super admin console).
-- ============================================================================
BEGIN;

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
  -- 064 gate, verbatim: JWT app_metadata first, auth.users fallback second.
  -- Never user_metadata; the server-side gate reads app_metadata only.
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
    coalesce(b.legal_name, b.name) AS name,   -- PBS-177: the console path stores the display name in legal_name
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

-- 064 contract re-asserted (idempotent)
REVOKE EXECUTE ON FUNCTION get_all_businesses_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_all_businesses_admin() FROM anon;
GRANT EXECUTE ON FUNCTION get_all_businesses_admin() TO authenticated;

COMMIT;

-- ============================================================================
-- PREVIEW-FIRST VERIFICATION (read the printed name column, then rollback)
-- A transaction-scoped console-style tenant (legal_name only, name NULL) and
-- an RPC-style tenant (both columns) prove BOTH creation paths display.
-- Nothing persists: the ROLLBACK erases everything, and the claims hijack
-- lives only in this transaction (SET LOCAL).
-- ============================================================================
-- BEGIN;
-- SET LOCAL "request.jwt.claims" = '{"role":"postgres","app_metadata":{"is_super_admin":true}}';
--
-- INSERT INTO businesses (legal_name, email, gstin)
-- VALUES ('ConsolePath Probe (rollback)', 'probe-console@rollback.test', NULL);
-- INSERT INTO businesses (name, legal_name, email, gstin)
-- VALUES ('RpcPath Probe (rollback)', 'RpcPath Probe Legal (rollback)', 'probe-rpc@rollback.test', NULL);
--
-- SELECT id, name, gstin, owner_email, created_at, is_active
-- FROM get_all_businesses_admin()
-- WHERE name LIKE '%Probe (rollback)%';
--   Expect TWO rows, printed name = 'ConsolePath Probe (rollback)' and
--   'RpcPath Probe Legal (rollback)' — never NULL, never 'Unnamed Business'.
--
-- ROLLBACK;  -- erases both probe rows and the local claims override
-- ============================================================================
