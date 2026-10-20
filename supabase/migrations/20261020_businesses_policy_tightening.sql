-- ============================================================================
-- 20261020 — businesses policy tightening (C3 catalog note, PBS-73 audit)
--
-- WHAT: Restores + hardens row-level security on public.businesses so the
-- platform super-admin role carries a real, verified write path while tenant
-- member bindings stay exactly as the house pattern defines them.
--
-- WHY (C3): PBS-73 found the SuperAdmin businesses write path (direct
-- .update() on businesses, e.g. useSuperAdmin.ts:86-90 fallback after the
-- toggle_business_status_admin RPC fails) touches rows the actor is NOT a
-- member/admin of. Under the current policy (024: businesses_update requires
-- is_business_admin) that write is silently denied — an actor-relative blind
-- spot instead of an audited platform-admin grant. 001's businesses_update
-- as originally authored was ANY-member (001:113-116) — narrower now via
-- 024 but still no platform-admin claw-back; and no businesses_delete policy
-- exists anywhere in migration history (implicit deny only).
--
-- DERIVATION (all mechanisms reuse existing migrations verbatim):
--   * platform-admin predicate: public.is_super_admin() —
--     20260905_enterprise_super_admin_core.sql:20-48 (auth.jwt() -> 'app_metadata'
--     ->> 'is_super_admin', raw_app_meta_data fallback, REVOKE PUBLIC/anon +
--     GRANT authenticated :48-50), policy shape USING/WITH CHECK mirror
--     platform_announcements_super_admin_all :74-80.
--   * member binding: public.is_business_member(b_id) — 001:68-83;
--     public.is_business_admin(b_id) — 024:24-42 (owner/admin + is_active).
--   * house 4-op shape: 001:381-391 products pattern (select member /
--     insert write-checked / update member + write-checked / delete scoped).
--   * 001 base semantics preserved: businesses_insert WITH CHECK
--     (owner_id = auth.uid()) at 001:109-111; onboarding also has the
--     SECURITY DEFINER create_business_with_owner path (002:36-67) which is
--     RLS-independent, so INSERT tightening cannot break signup.
--
-- APPLY (review first): supabase db push   — or:
--   psql "$DATABASE_URL" -f supabase/migrations/20261020_businesses_policy_tightening.sql
-- All statements are idempotent (DROP+CREATE pairs, IF EXISTS).
--
-- SEMANTICS AFTER THIS MIGRATION:
--   SELECT  : business member OR platform super admin (super-admin client
--             list currently relies on the get_all_businesses_admin SECURITY
--             DEFINER RPC, 064:59-95 — the direct .select() in
--             useSuperAdmin.ts:38 is tenant-failing today; this grant makes
--             it correct without widening tenant visibility).
--   INSERT  : owner self-create (001 unchanged) OR platform super admin.
--   UPDATE  : business owner/admin (024 unchanged) OR platform super admin
--             (C3 fix: the audited platform path).
--             ⚠ Deliberately NOT super-admin-only: tenant profile saves run
--             as business admins from the client (SettingsPage.tsx:404,
--             BusinessProfilePanel.tsx:94) and would break under a
--             platform-admin-only UPDATE.
--   DELETE  : platform super admin ONLY — new explicit policy; previously
--             implicit deny. Tenant hard-delete stays closed.
--
-- STORAGE-POLICY GAP NOTE: no storage bucket usage exists in the client
-- (PBS-73), so no storage.objects policies ship here. If buckets exist
-- server-side (unverified from this repo), their policies are NOT covered
-- by this artifact — audit under a separate card before next deploy.
-- ============================================================================

-- Predictable execution surface ------------------------------------------------
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- The platform-admin predicate must exist and be callable by authenticated
-- only (mirrors 20260905:48-50 idempotently).
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- SELECT: member binding, widened ONLY for platform admin
DROP POLICY IF EXISTS "businesses_select" ON businesses;
CREATE POLICY "businesses_select" ON businesses FOR SELECT
  TO authenticated
  USING (is_business_member(businesses.id) OR public.is_super_admin());

-- INSERT: owner self-create preserved, platform admin explicitly allowed
DROP POLICY IF EXISTS "businesses_insert" ON businesses;
CREATE POLICY "businesses_insert" ON businesses FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid() OR public.is_super_admin());

-- UPDATE: owner/admin binding preserved, platform admin granted (C3)
DROP POLICY IF EXISTS "businesses_update" ON businesses;
CREATE POLICY "businesses_update" ON businesses FOR UPDATE
  TO authenticated
  USING (is_business_admin(businesses.id) OR public.is_super_admin())
  WITH CHECK (is_business_admin(businesses.id) OR public.is_super_admin());

-- DELETE: platform admin only — explicit close of the implicit deny
DROP POLICY IF EXISTS "businesses_delete" ON businesses;
CREATE POLICY "businesses_delete" ON businesses FOR DELETE
  TO authenticated
  USING (public.is_super_admin());
