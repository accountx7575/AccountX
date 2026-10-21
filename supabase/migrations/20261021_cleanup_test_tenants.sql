-- 20261021 — cleanup of probe/test tenants left on the live project
--
-- WHAT: removes throwaway business rows that live probes and manual tests
--       created ("POS149 Probe Star", "RLSBoundaryProbe", "Verify LLP",
--       "asdf", …). Those rows were created through the normal creation paths
--       (the create_business_with_owner RPC or the Super Admin console), so
--       they are ordinary tenant rows — not a separate table — and every child
--       table cascades from them.
--
-- WHY: a tenant row is a real, billable record. Probe tenants pollute the
--       Super Admin console, the owner business list of the logged-in user
--       and the per-plan quota counts.
--
-- HOW IT MATCHES: the live businesses table has `name`, `legal_name`, `email`,
--       `owner_id` and `gstin` — it has no trade-name column (nor
--       `is_active` / `plan_type` / `monthly_invoice_quota`), so the predicate
--       looks at `name` AND `legal_name` only. Referencing the trade-name column here
--       would abort the whole script with 42703.
--         name / legal_name ILIKE '%probe%'
--                         OR ILIKE '%pos149%'
--                         OR ILIKE '%verify llp%'
--                         OR LOWER(trim(...)) = 'asdf'
--       Both creation paths are covered: the RPC path writes `name` (legal_name
--       stays NULL) and the console path writes `legal_name` (name stays NULL),
--       so the predicate has to look at both columns.
--       The owner email is deliberately NOT part of the predicate — a real
--       account could legitimately contain those substrings.
--
--       The source of truth for these names is now the creation-time guard in
--       src/lib/businessNameGuard.ts — new tenants with these names are
--       refused before they are created. This migration only cleans up the
--       rows that already exist.
--
-- SAFETY:
--   * Run the preview SELECT first to see exactly what will be removed.
--   * The whole delete runs inside one transaction; if any row fails, nothing
--     is deleted.
--   * Idempotent — a second run removes nothing.
--   * Every child row (business_members, warehouses, accounts, invoices,
--     documents, …) is removed by ON DELETE CASCADE; only
--     admin_audit_logs.target_business_id is set to NULL by its own rule.
--
-- APPLY BY: the HUMAN, in the Supabase SQL editor. There is no service_role
--            key on the agent floor and RLS blocks anon writes, so no agent can
--            run this for you.

-- ---------------------------------------------------------------------------
-- Step 1 (read-only preview) — run this first and check the list.
-- ---------------------------------------------------------------------------
SELECT id,
       name,
       legal_name,
       email,
       owner_id,
       gstin,
       created_at
FROM public.businesses
WHERE name ILIKE '%probe%'
   OR legal_name ILIKE '%probe%'
   OR name ILIKE '%pos149%'
   OR legal_name ILIKE '%pos149%'
   OR name ILIKE '%verify llp%'
   OR legal_name ILIKE '%verify llp%'
   OR lower(trim(coalesce(name, ''))) = 'asdf'
   OR lower(trim(coalesce(legal_name, ''))) = 'asdf'
ORDER BY created_at DESC;

-- ---------------------------------------------------------------------------
-- Step 2 (the delete) — run after reviewing the preview above.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_deleted integer;
  v_ids text;
BEGIN
  WITH targets AS (
    SELECT id
    FROM public.businesses
    WHERE name ILIKE '%probe%'
       OR legal_name ILIKE '%probe%'
       OR name ILIKE '%pos149%'
       OR legal_name ILIKE '%pos149%'
       OR name ILIKE '%verify llp%'
       OR legal_name ILIKE '%verify llp%'
       OR lower(trim(coalesce(name, ''))) = 'asdf'
       OR lower(trim(coalesce(legal_name, ''))) = 'asdf'
  ), removed AS (
    DELETE FROM public.businesses b
    USING targets t
    WHERE b.id = t.id
    RETURNING b.id::text
  )
  SELECT count(*), string_agg(id, ', ') INTO v_deleted, v_ids FROM removed;

  RAISE NOTICE 'Deleted % test tenant(s): %', v_deleted, coalesce(v_ids, '(none)');
END;
$$;
