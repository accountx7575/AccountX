/*
# Fix RLS deadlock on business creation

## Problem
When a new user creates their first business, the flow is:
1. INSERT into `businesses` (allowed by `businesses_insert` policy: `owner_id = auth.uid()`)
2. INSERT into `business_members` with role='owner'

Step 2 FAILS because `members_insert` policy requires an existing owner/admin
member in the business — but the business was just created and has no members
yet. This is a chicken-and-egg RLS deadlock that blocks all business creation.

## Fix
Create a SECURITY DEFINER function `create_business_with_owner` that:
- Inserts the business row
- Inserts the owner membership row
- Seeds default warehouse, accounts, and expense categories
- Returns the new business record

SECURITY DEFINER runs with the function owner's privileges (bypassing RLS),
so both inserts succeed atomically. The function validates `auth.uid()` itself
to ensure only the authenticated user becomes the owner.

## Security
- Function is SECURITY DEFINER with fixed `search_path = public`
- Only callable by `authenticated` role
- Validates that the caller is authenticated via `auth.uid()`
- Uses the caller's uid as owner_id — cannot create businesses for other users
- All RLS policies remain enabled and enforced for normal CRUD operations
*/

-- ============================================================================
-- Function: create_business_with_owner
-- Atomically creates a business + owner membership + seed data
-- ============================================================================
CREATE OR REPLACE FUNCTION create_business_with_owner(
  p_name text,
  p_legal_name text DEFAULT NULL,
  p_business_type text DEFAULT 'trading',
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT 'Maharashtra',
  p_gstin text DEFAULT NULL,
  p_pan text DEFAULT NULL,
  p_financial_year text DEFAULT '2026-27',
  p_currency text DEFAULT 'INR',
  p_currency_symbol text DEFAULT '₹',
  p_invoice_prefix text DEFAULT 'INV',
  p_gst_registered boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_owner_id uuid := auth.uid();
BEGIN
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the business
  INSERT INTO businesses (
    owner_id, name, legal_name, business_type, phone, email, address,
    city, state, gstin, pan, financial_year, currency, currency_symbol,
    invoice_prefix, gst_registered
  ) VALUES (
    v_owner_id, p_name, p_legal_name, p_business_type, p_phone, p_email, p_address,
    p_city, p_state, p_gstin, p_pan, p_financial_year, p_currency, p_currency_symbol,
    p_invoice_prefix, p_gst_registered
  )
  RETURNING id INTO v_business_id;

  -- Create owner membership
  INSERT INTO business_members (business_id, user_id, role, is_active)
  VALUES (v_business_id, v_owner_id, 'owner', true);

  -- Seed default warehouse
  INSERT INTO warehouses (business_id, name, is_default)
  VALUES (v_business_id, 'Main Warehouse', true);

  -- Seed default chart of accounts
  INSERT INTO accounts (business_id, group_name, name, is_system) VALUES
    (v_business_id, 'Cash & Bank', 'Cash In Hand', true),
    (v_business_id, 'Cash & Bank', 'Bank Account', true),
    (v_business_id, 'Direct Income', 'Sales Account', true),
    (v_business_id, 'Direct Expense', 'Purchase Account', true),
    (v_business_id, 'Indirect Expense', 'Rent Expense', true),
    (v_business_id, 'Indirect Expense', 'Salary Expense', true),
    (v_business_id, 'Indirect Expense', 'Electricity Expense', true);

  -- Seed default expense categories
  INSERT INTO expense_categories (business_id, name) VALUES
    (v_business_id, 'Rent'),
    (v_business_id, 'Electricity'),
    (v_business_id, 'Salary'),
    (v_business_id, 'Transport'),
    (v_business_id, 'Marketing'),
    (v_business_id, 'Office'),
    (v_business_id, 'Telephone'),
    (v_business_id, 'Internet'),
    (v_business_id, 'Other');

  RETURN v_business_id;
END;
$$;

-- Grant execute to authenticated only
GRANT EXECUTE ON FUNCTION create_business_with_owner TO authenticated;
