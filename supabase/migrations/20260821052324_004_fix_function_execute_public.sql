/*
# Fix function execute permissions

Functions default to PUBLIC execute. REVOKE FROM PUBLIC then GRANT only
to authenticated so anon and unauthenticated users cannot call them.
*/

REVOKE EXECUTE ON FUNCTION is_business_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION can_write_business(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_business_with_owner FROM PUBLIC;

GRANT EXECUTE ON FUNCTION is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION can_write_business(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION create_business_with_owner TO authenticated;
