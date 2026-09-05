-- ============================================================================
-- 065: Business subscription management (Super Admin Tenant Drawer)
-- Adds plan tier + expiry columns consumed by SuperAdminPage Plan Management.
-- Idempotent: safe to re-run. Existing rows default to 'Free Tier'.
-- ============================================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'Free Tier'
    CHECK (subscription_tier IN ('Free Tier', 'Professional Plan', 'Enterprise GST'));

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

-- Backfill any legacy NULL tiers (belt & braces; column default covers new rows)
UPDATE businesses
SET subscription_tier = 'Free Tier'
WHERE subscription_tier IS NULL;
