/*
# 013a — GST group_name CHECK repair (BLOCKER B1)

## Problem
Migration 011 posts GST through ledger accounts created in groups
'GST Payable' / 'GST Receivable' (find_or_create_gst_accounts, 011:68-73),
but the accounts.group_name CHECK constraint added in 001 (line 763) never
listed those values. Every taxed sales invoice / purchase bill therefore
fails at posting time with:

  ERROR: new row for relation "accounts" violates check constraint
         "accounts_group_name_check"

Untaxed documents skip the GST lines entirely, which is why the breakage
stayed invisible until real taxed usage.

## Fix
Widen the CHECK to admit the two GST groups used by the 011 engine.
No existing row can violate the widened constraint (it is a strict
superset of the old value set), so no NOT VALID / revalidation dance is
needed.

Cess ledgers ('Output Cess' / 'Input Cess', introduced by 013b) are
homed INSIDE these two groups, so no further group values are required.

Existing behaviour for untaxed docs: unchanged (this migration touches
only the constraint, not any function or row).
*/

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_group_name_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_group_name_check
  CHECK (group_name IN (
    'Current Assets',
    'Fixed Assets',
    'Current Liabilities',
    'Long-term Liabilities',
    'Capital Account',
    'Direct Income',
    'Indirect Income',
    'Direct Expense',
    'Indirect Expense',
    'Sundry Debtors',
    'Sundry Creditors',
    'Cash & Bank',
    'GST Payable',
    'GST Receivable'
  ));
