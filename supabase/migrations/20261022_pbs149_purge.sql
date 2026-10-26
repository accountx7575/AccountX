-- ============================================================================
-- PBS-174 — purge of probe/test tenants + their probe owner accounts
--            (the HUMAN DIRECTIVE of 2026-10-22, predicate corrected)
--
-- WHAT: deletes the throwaway business rows (probe / test tenants) that live
--       probes and manual tests created, AND the auth.users owner accounts
--       that own ONLY those tenants ("permanently delete test accounts").
--
-- RELATION TO PBS-149/159: their 20261021_cleanup_test_tenants.sql only
-- deleted businesses and only matched `%pos149%`. This script is the human's
-- corrected predicate: BOTH spellings `%pbs149%` AND `%pos149%` (case-ILIKE),
-- BOTH columns (`name` AND `legal_name` — the console path stores the name in
-- legal_name and leaves name NULL; the RPC path does the reverse), `verify
-- llp`, `%probe%`, and an EXACT trim+lower match on `asdf` (not a substring
-- match, so a real "asdfghjk Ltd" is never touched). Owner emails are
-- deliberately never part of the predicate.
--
-- THE auth.users RULE (by ID, never by email):
--   * An owner is deleted ONLY when EVERY business they own matches the
--     purge predicate.
--   * An owner who also owns a NON-matching business is NEVER deleted; they
--     are listed in the "kept" notice.
--   * Belt: a user flagged raw_app_meta_data->>'is_super_admin' is never
--     deleted by this script no matter what the verdict says.
--   * Deletion is BY the captured owner_id only — never an email pattern.
--   * The verdicts are computed in the SAME transaction that deletes the
--     businesses: once the businesses are gone, "which businesses did this
--     owner own" is not answerable any more, so the capture MUST happen
--     pre-delete. The second transaction deletes the captured auth.users
--     rows, re-checking only the super-admin belt.
--
-- SAFETY:
--   * Run the preview SELECT below (commented) FIRST and review.
--   * Each section is one transaction (BEGIN/COMMIT); any error rolls that
--     section back without deleting half of anything.
--   * Idempotent — a second full run matches nothing, deletes no user.
--   * Every child of the deleted businesses (business_members, warehouses,
--     accounts, invoices, documents, …) goes via ON DELETE CASCADE; only
--     admin_audit_logs.target_business_id is nulled by its own rule.
--     super_admin_tenant_metrics()/tenant-access helpers are pure functions
--     over live rows — no stored rows keyed on business_id to orphan.
--   * auth.users deletion cascades to auth.identities/sessions/refresh
--     tokens and public.profiles; if anything holds a NO ACTION FK on those
--     ids the transaction aborts cleanly.
--
-- EXECUTION: paste the WHOLE FILE into the Supabase SQL editor and Run.
--   The agents tried every lever first (supabase CLI not installed, no
--   project link, no access token, .env carries only anon credentials,
--   no admin-capable Edge Function): BLOCKED-ON-ENV, not on the SQL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PREVIEW (read-only) — same predicate as the delete below.
-- ---------------------------------------------------------------------------
-- SELECT id, name, legal_name, email, owner_id, gstin, created_at
-- FROM public.businesses b
-- WHERE b.name     ILIKE '%probe%'      OR b.legal_name ILIKE '%probe%'
--    OR b.name     ILIKE '%pbs149%'     OR b.legal_name ILIKE '%pbs149%'
--    OR b.name     ILIKE '%pos149%'     OR b.legal_name ILIKE '%pos149%'
--    OR b.name     ILIKE '%verify llp%' OR b.legal_name ILIKE '%verify llp%'
--    OR lower(trim(coalesce(b.name,'')))      = 'asdf'
--    OR lower(trim(coalesce(b.legal_name,''))) = 'asdf'
-- ORDER BY created_at DESC;
--
-- Owners to DELETE (every business they own matches above):
-- SELECT u.id, u.email
-- FROM auth.users u
-- JOIN public.businesses b ON b.owner_id = u.id
-- GROUP BY u.id
-- HAVING bool_and(
--   b.name ILIKE '%probe%'      OR b.legal_name ILIKE '%probe%'
--   OR b.name ILIKE '%pbs149%'  OR b.legal_name ILIKE '%pbs149%'
--   OR b.name ILIKE '%pos149%'  OR b.legal_name ILIKE '%pos149%'
--   OR b.name ILIKE '%verify llp%' OR b.legal_name ILIKE '%verify llp%'
--   OR lower(trim(coalesce(b.name,'')))      = 'asdf'
--   OR lower(trim(coalesce(b.legal_name,''))) = 'asdf');
--
-- Owners KEPT (own at least one non-matching business):
-- SELECT u.id, u.email, min(coalesce(b.name, b.legal_name)) AS example_saved
-- FROM auth.users u
-- JOIN public.businesses b ON b.owner_id = u.id
-- GROUP BY u.id
-- HAVING bool_not(
--   b.name ILIKE '%probe%'      OR b.legal_name ILIKE '%probe%'
--   OR b.name ILIKE '%pbs149%'  OR b.legal_name ILIKE '%pbs149%'
--   OR b.name ILIKE '%pos149%'  OR b.legal_name ILIKE '%pos149%'
--   OR b.name ILIKE '%verify llp%' OR b.legal_name ILIKE '%verify llp%'
--   OR lower(trim(coalesce(b.name,'')))      = 'asdf'
--   OR lower(trim(coalesce(b.legal_name,''))) = 'asdf');

-- ---------------------------------------------------------------------------
-- SECTION 1 — the businesses purge (one transaction). Preview and owner
-- verdicts are NOTICEd inside this same transaction, before the delete.
-- ---------------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS pbs174_target_businesses;
DROP TABLE IF EXISTS pbs174_owner_delete, pbs174_owner_excluded, pbs174_owner_kept;

CREATE TEMP TABLE pbs174_target_businesses ON COMMIT PRESERVE ROWS AS
SELECT b.id,
       coalesce(b.name, b.legal_name, '(unnamed)') AS label,
       b.email,
       b.owner_id
FROM public.businesses b
WHERE b.name     ILIKE '%probe%'      OR b.legal_name ILIKE '%probe%'
   OR b.name     ILIKE '%pbs149%'     OR b.legal_name ILIKE '%pbs149%'
   OR b.name     ILIKE '%pos149%'     OR b.legal_name ILIKE '%pos149%'
   OR b.name     ILIKE '%verify llp%' OR b.legal_name ILIKE '%verify llp%'
   OR lower(trim(coalesce(b.name,'')))      = 'asdf'
   OR lower(trim(coalesce(b.legal_name,''))) = 'asdf';

-- One row per business owned by a probe owner, with the match verdict — the
-- delete/keep verdict for owners is a pure aggregate over these live rows,
-- computed BEFORE the businesses are gone.
CREATE TEMP TABLE pbs174_owner_businesses ON COMMIT PRESERVE ROWS AS
SELECT b.id,
       b.owner_id,
       coalesce(b.name, b.legal_name, '(unnamed)') AS label,
       (b.name     ILIKE '%probe%'      OR b.legal_name ILIKE '%probe%'
        OR b.name  ILIKE '%pbs149%'     OR b.legal_name ILIKE '%pbs149%'
        OR b.name  ILIKE '%pos149%'     OR b.legal_name ILIKE '%pos149%'
        OR b.name  ILIKE '%verify llp%' OR b.legal_name ILIKE '%verify llp%'
        OR lower(trim(coalesce(b.name,'')))      = 'asdf'
        OR lower(trim(coalesce(b.legal_name,''))) = 'asdf'
       ) AS matched
FROM public.businesses b
WHERE b.owner_id IS NOT NULL
  AND b.owner_id IN (SELECT owner_id FROM pbs174_target_businesses
                      WHERE owner_id IS NOT NULL);

-- owner verdicts: ids only (the delete section never reads an email string)
CREATE TEMP TABLE pbs174_owner_delete ON COMMIT PRESERVE ROWS AS
SELECT owner_id
FROM pbs174_owner_businesses
GROUP BY owner_id
HAVING bool_and(matched);

-- owners saved from deletion: own at least one non-matching business
CREATE TEMP TABLE pbs174_owner_excluded ON COMMIT PRESERVE ROWS AS
SELECT ob.owner_id,
       min(ob.label) AS saved_business
FROM pbs174_owner_businesses ob
WHERE NOT ob.matched
GROUP BY ob.owner_id;

CREATE TEMP TABLE pbs174_owner_kept ON COMMIT PRESERVE ROWS AS
SELECT owner_id
FROM pbs174_owner_excluded
UNION
SELECT u.id
FROM auth.users u
WHERE coalesce(u.raw_app_meta_data ->> 'is_super_admin', 'false')::boolean
  AND u.id IN (SELECT owner_id FROM pbs174_owner_delete);

DO $purge$
DECLARE
  v_row_list text;
  v_owner_list text;
  v_excluded_list text;
  v_businesses_before bigint;
  v_businesses_after bigint;
  v_deleted bigint;
BEGIN
  v_businesses_before := count(*) FROM public.businesses;

  SELECT string_agg(
           format('%s | name=%s | legal=%s | owner=%s', id, label, email, owner_id),
           ' ; ' ORDER BY id)
    INTO v_row_list
    FROM pbs174_target_businesses;

  SELECT string_agg(owner_id::text, ', ' ORDER BY owner_id)
    INTO v_owner_list
    FROM pbs174_owner_delete d
   WHERE NOT EXISTS (SELECT 1 FROM pbs174_owner_kept k WHERE k.owner_id = d.owner_id);

  SELECT string_agg(
           format('%s (owns non-matching: %s)', owner_id, saved_business),
           ' ; ' ORDER BY owner_id)
    INTO v_excluded_list
    FROM pbs174_owner_excluded;

  RAISE NOTICE 'PBS174 PREVIEW (rows+owners captured atomically with the delete below):';
  RAISE NOTICE '  businesses: %', coalesce(v_row_list, '(none)');
  RAISE NOTICE '  owners to DELETE (by id): %', coalesce(v_owner_list, '(none)');
  RAISE NOTICE '  owners KEPT (own non-matching business, or super-admin belt): %',
               coalesce(v_excluded_list, '(none)');
  RAISE NOTICE '  total businesses before: %', v_businesses_before;

  WITH removed AS (
    DELETE FROM public.businesses b
    USING pbs174_target_businesses t
    WHERE b.id = t.id
    RETURNING b.id
  )
  SELECT count(*) INTO v_deleted FROM removed;

  v_businesses_after := count(*) FROM public.businesses;

  RAISE NOTICE 'PBS174 businesses deleted: % (targets %)',
               v_deleted, (SELECT count(*) FROM pbs174_target_businesses);
  RAISE NOTICE 'PBS174 businesses before/after: % / %',
               v_businesses_before, v_businesses_after;
END
$purge$;

COMMIT;

-- ---------------------------------------------------------------------------
-- SECTION 2 — the auth.users companion (one transaction). Deletes the probe
-- OWNER accounts captured pre-delete, BY ID ONLY. Owners that also own a
-- non-matching business and any super admin account were filtered out in
-- section 1; only the super-admin belt is re-checked here.
-- ---------------------------------------------------------------------------
BEGIN;

DO $purge_users$
DECLARE
  v_owner_ids text;
  v_user_ids text;
  v_kept_list text;
  v_deleted bigint;
BEGIN
  SELECT string_agg(owner_id::text, ', ' ORDER BY owner_id)
    INTO v_owner_ids
    FROM pbs174_owner_delete d
   WHERE NOT EXISTS (SELECT 1 FROM pbs174_owner_kept k WHERE k.owner_id = d.owner_id);

  RAISE NOTICE 'PBS174 auth.users to DELETE (by id only): %', coalesce(v_owner_ids, '(none)');

  WITH removed AS (
    DELETE FROM auth.users u
    WHERE coalesce(u.raw_app_meta_data ->> 'is_super_admin', 'false')::boolean = FALSE
      AND u.id IN (
        SELECT owner_id FROM pbs174_owner_delete d
        WHERE NOT EXISTS (SELECT 1 FROM pbs174_owner_kept k WHERE k.owner_id = d.owner_id)
      )
    RETURNING u.id
  )
  SELECT count(*), string_agg(id::text, ', ' ORDER BY id)
    INTO v_deleted, v_user_ids
    FROM removed;

  RAISE NOTICE 'PBS174 auth.users actually deleted: % (%s)',
               v_deleted, coalesce(v_user_ids, '(none)');

  SELECT coalesce(string_agg(owner_id::text, ', ' ORDER BY owner_id), '(none)')
    INTO v_kept_list
    FROM pbs174_owner_kept;

  RAISE NOTICE 'PBS174 owners kept from deletion (belt/excluded): %', v_kept_list;
END
$purge_users$;

COMMIT;
