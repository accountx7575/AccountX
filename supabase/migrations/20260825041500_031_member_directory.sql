/*
# 031 — Member directory surface (T54)

Fixes Phyllis's honest short-user-id placeholders in Members management:
the FE could only see business_members.user_id (a uuid); display names and
emails live in auth.users, which RLS'd callers cannot read directly.

Design:
1. auth_user_profile(p_uid) RETURNS TABLE(email, full_name) — SECURITY
   DEFINER helper that reads auth.users as the owner and exposes ONLY two
   display fields (minimal leak surface; no ids/phones/last_sign_in).
   full_name falls back raw_user_meta_data full_name -> name -> email
   local-part, so it is never null.
2. v_member_directory — security_invoker=on VIEW over business_members,
   CROSS JOIN LATERAL auth_user_profile(user_id). Because the view runs
   with the CALLER's rights, business_members RLS applies unchanged: a
   caller sees exactly the businesses they are a member of — same rows
   they can already read, now with human names attached.
3. Grants: helper + view to authenticated only.
*/

CREATE OR REPLACE FUNCTION auth_user_profile(p_uid uuid)
RETURNS TABLE (email text, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email::text,
         COALESCE(
           NULLIF(u.raw_user_meta_data->>'full_name', ''),
           NULLIF(u.raw_user_meta_data->>'name', ''),
           split_part(u.email::text, '@', 1)
         ) AS full_name
  FROM auth.users u
  WHERE u.id = p_uid;
$$;

REVOKE EXECUTE ON FUNCTION auth_user_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_user_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION auth_user_profile(uuid) TO authenticated;

CREATE OR REPLACE VIEW v_member_directory WITH (security_invoker = on) AS
SELECT bm.business_id,
       bm.id AS membership_id,
       bm.user_id,
       p.email,
       p.full_name,
       bm.role,
       bm.is_active,
       bm.invited_at,
       bm.joined_at
FROM business_members bm
CROSS JOIN LATERAL auth_user_profile(bm.user_id) p;

GRANT SELECT ON v_member_directory TO authenticated;
