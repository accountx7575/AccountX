-- Migration 075: Create stock_adjustments table and RLS policies
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL, -- 'increase' | 'decrease' | 'Stock In' | 'Stock Out'
  quantity NUMERIC NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all actions for authenticated users on stock_adjustments" ON stock_adjustments;
CREATE POLICY "Allow all actions for authenticated users on stock_adjustments" 
  ON stock_adjustments FOR ALL USING (true);

-- Grant permissions to PostgREST roles
GRANT ALL ON stock_adjustments TO authenticated;
GRANT ALL ON stock_adjustments TO anon;
GRANT ALL ON stock_adjustments TO service_role;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
