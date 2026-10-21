-- 20261022 — Super Admin Support Mode: platform-admin access to tenant rows
--
-- WHAT: adds a super-admin RLS policy to every business-scoped table so the
--       Super Admin can actually SEE a tenant's data while impersonating it.
--
-- WHY: tenant tables are owner/member scoped —
--         CREATE POLICY "<t>_select" ON <t> FOR SELECT TO authenticated
--           USING (is_business_member(business_id));
--         CREATE POLICY "<t>_insert" ON <t> FOR INSERT TO authenticated
--           WITH CHECK (can_write_business(business_id));
--       `is_business_member` resolves through business_members rows, and an
--       impersonating super admin has NO membership row in the tenant they
--       are viewing. Result: every list in Support Mode came back empty —
--       the Sales Orders screen showed "No sales orders yet" for a tenant
--       that had three live orders (SO/26-27/1..3), because RLS filtered
--       every row out before the client's .eq('business_id', …) could match.
--       The client was never the bug; the session was not a member.
--
-- HOW: the policy is ADDITIVE — PostgreSQL ORs permissive policies together,
--       so the member/owner policies stay exactly as they are and normal
--       users are unaffected. The gate is public.is_super_admin(), the same
--       platform-admin predicate the `businesses` policies (060) and the
--       platform core (064/065) already use. It reads
--       auth.jwt()->'app_metadata'->>'is_super_admin' with an auth.users
--       fallback — so it works for the console's super admin without any
--       extra table.
--
--       NOT `public.profiles.role = 'super_admin'`: public.profiles (PBS-152)
--       holds name/phone/email only and has no role column, and no migration
--       keeps one in sync with app_metadata.
--
--       business_id is taken from the row itself, so a super admin sees every
--       tenant's rows; the client still scopes the list to the impersonated
--       business, so Support Mode shows one tenant at a time.
--
-- SCOPE NOTES:
--   * business_members gets a READ-ONLY grant. The console needs to show a
--     tenant's staff, but letting a platform admin INSERT or UPDATE
--     membership rows would let them mint themselves owner rights on a
--     tenant — the very thing the impersonation feature avoids.
--   * admin_audit_logs has target_business_id, not business_id, so it is not
--     touched here; the audit trail stays intact.
--   * Every other child table (invoices, items, documents, ledgers, …)
--     inherits the grant through the loop.
--
-- SAFETY: idempotent (DROP + CREATE per table), transactional, and it only
--         ever widens access for a principal that is already a platform admin.
--
-- APPLY BY: the HUMAN, in the Supabase SQL editor — no service_role key is
--            available to the agent. Until it lands, Support Mode keeps
--            showing empty lists.

-- ---------------------------------------------------------------------------
-- Sanity: the gate must exist and be executable by `authenticated`.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'public.is_super_admin() is missing — apply the 064 platform core first';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- The grant.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_granted int := 0;
  v_readonly int := 0;
  v_rls_off text := '';
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'business_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
  LOOP
    IF r.table_name = 'business_members' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'super_admin_all_access', r.table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'super_admin_select_access', r.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_super_admin())',
        'super_admin_select_access', r.table_name);
      v_readonly := v_readonly + 1;
    ELSE
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'super_admin_all_access', r.table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'super_admin_select_access', r.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
        'super_admin_all_access', r.table_name);
      v_granted := v_granted + 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE c2.relname = r.table_name AND n2.nspname = 'public' AND c2.relrowsecurity
    ) THEN
      v_rls_off := v_rls_off || r.table_name || ', ';
    END IF;
  END LOOP;

  RAISE NOTICE 'super_admin_all_access added to % business-scoped table(s); % read-only grant(s) on business_members.',
    v_granted, v_readonly;
  IF v_rls_off <> '' THEN
    RAISE NOTICE 'WARNING: RLS is disabled on these business-scoped tables (policy is inert until RLS is enabled): %', v_rls_off;
  END IF;
END;
$$;
