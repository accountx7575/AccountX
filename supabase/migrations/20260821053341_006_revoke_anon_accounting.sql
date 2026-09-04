/*
# Revoke anon execute on accounting functions

The previous REVOKE FROM PUBLIC didn't fully remove anon access.
Explicitly revoke from the anon role directly.
*/

REVOKE EXECUTE ON FUNCTION post_journal_entry FROM anon;
REVOKE EXECUTE ON FUNCTION get_trial_balance FROM anon;
REVOKE EXECUTE ON FUNCTION account_nature(text) FROM anon;
