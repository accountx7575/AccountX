/*
# Fix security advisor warnings

## Changes
1. Revoke EXECUTE from anon role on all SECURITY DEFINER functions
   - create_business_with_owner: only authenticated users should create businesses
   - is_business_member: only authenticated users need membership checks
   - can_write_business: only authenticated users need write checks
2. Fix search_path on update_updated_at trigger function
*/

-- Revoke anon execute on SECURITY DEFINER helper functions
REVOKE EXECUTE ON FUNCTION is_business_member(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION can_write_business(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION create_business_with_owner FROM anon;

-- Fix mutable search_path on update_updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
