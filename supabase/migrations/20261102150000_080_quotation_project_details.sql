-- Migration 080: Add project_details JSONB and discom_utility to quotations and customers
-- Replaces Quotation "Payment & Fulfillment" with customizable "Project & Plant Details"

ALTER TABLE quotations
ADD COLUMN IF NOT EXISTS project_details JSONB DEFAULT '{
  "project_name": "10 kW On-Grid Solar Plant",
  "plant_type": "Grid-Tie Rooftop with Net-Metering",
  "roof_type": "RCC Flat Roof / Metal Shed (Hot-Dip GI)",
  "subsidy_scheme": "Central PM Surya Ghar + UPNEDA State DBT"
}'::jsonb;

ALTER TABLE quotations 
ADD COLUMN IF NOT EXISTS discom_utility TEXT DEFAULT 'PVVNL';

ALTER TABLE customers
ADD COLUMN IF NOT EXISTS discom_utility TEXT DEFAULT 'PVVNL';

-- Update existing quotations so they have default project details and discom utility
UPDATE quotations
SET project_details = COALESCE(project_details, '{
  "project_name": "10 kW On-Grid Solar Plant",
  "plant_type": "Grid-Tie Rooftop with Net-Metering",
  "roof_type": "RCC Flat Roof / Metal Shed (Hot-Dip GI)",
  "subsidy_scheme": "Central PM Surya Ghar + UPNEDA State DBT"
}'::jsonb),
    discom_utility = COALESCE(discom_utility, 'PVVNL')
WHERE project_details IS NULL OR discom_utility IS NULL;

-- Ensure permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO authenticated, anon, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers TO authenticated, anon, service_role;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
