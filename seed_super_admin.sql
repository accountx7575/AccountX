-- =============================================================================
-- AccountX Super Admin Seed Data
-- 6 Indian Business Tenants for Super Admin Panel
-- =============================================================================

-- Step 1: Insert 6 businesses into public.businesses
-- Note: These inserts assume RLS is temporarily disabled or the user has
-- super_admin capabilities via auth.users raw_app_meta_data

INSERT INTO public.businesses (name, legal_name, business_type, gstin, email, city, state, country, is_active, created_at, updated_at) VALUES
('Reliance Retail Logistics Ltd', 'Reliance Retail Logistics Ltd', 'Logistics', '27AABCR1234F1Z5', 'operations@reliancelogistics.com', 'Mumbai', 'MH', 'India', true, now(), now()),
('Bharat Electronics & Motors', 'Bharat Electronics & Motors', 'Manufacturing', '07AAACB9876Q1Z2', 'info@bharatelectronics.com', 'Delhi', 'DL', 'India', true, now(), now()),
('Apex Cloud Infotech Pvt Ltd', 'Apex Cloud Infotech Pvt Ltd', 'SaaS', '29ABCDE1122C1Z4', 'dev@apexcloud.in', 'Bangalore', 'KA', 'India', true, now(), now()),
('Kashi Textiles & Handloom', 'Kashi Textiles & Handloom', 'Retail', '09AABCK5544H1Z8', 'sales@kashitextiles.com', 'Varanasi', 'UP', 'India', false, now(), now()),
('Deccan Agro Commodities', 'Deccan Agro Commodities', 'Agriculture', '36AABCD9988G1Z1', 'procurement@deccanagro.com', 'Pune', 'MH', 'India', true, now(), now()),
('Avadh Boring Company', 'Avadh Boring Company', 'Services', '09AABCU9603R1ZM', 'contact@avadhboring.com', 'Lucknow', 'UP', 'India', true, now(), now());

-- Step 2: Insert business members (owners) for each business
-- Note: These user_id references assume auth.users entries exist or use placeholder UUIDs
-- In production, these would reference actual Supabase auth.users rows

INSERT INTO public.business_members (business_id, user_id, role, is_active, invited_at, joined_at) VALUES
-- Reliance Retail Logistics Ltd owner
 (gen_random_uuid(), '00000000-0000-0000-0000-000000000001'::uuid, 'owner', true, now(), now()),
-- Bharat Electronics & Motors owner
 (gen_random_uuid(), '00000000-0000-0000-0000-000000000002'::uuid, 'owner', true, now(), now()),
-- Apex Cloud Infotech Pvt Ltd owner
 (gen_random_uuid(), '00000000-0000-0000-0000-000000000003'::uuid, 'owner', true, now(), now()),
-- Kashi Textiles & Handloom owner (blocked business)
 (gen_random_uuid(), '00000000-0000-0000-0000-000000000004'::uuid, 'owner', true, now(), now()),
-- Deccan Agro Commodities owner
 (gen_random_uuid(), '00000000-0000-0000-0000-000000000005'::uuid, 'owner', true, now(), now()),
-- Avadh Boring Company owner
 (gen_random_uuid(), '00000000-0000-0000-0000-000000000006'::uuid, 'owner', true, now(), now());

-- Step 3: Verify the seed data
SELECT id, name, legal_name, business_type, gstin, is_active 
FROM public.businesses 
WHERE is_active = true 
ORDER BY name;

SELECT id, name, business_type, is_active 
FROM public.businesses 
WHERE is_active = false 
ORDER BY name;

-- Step 4: Check business member counts
SELECT b.name AS business_name, 
       COALESCE(m.owner_count, 0) AS owner_members,
       b.is_active AS business_status
FROM public.businesses b
LEFT JOIN (
    SELECT business_id, COUNT(*) AS owner_count
    FROM public.business_members
    WHERE role = 'owner' AND is_active = true
    GROUP BY business_id
) m ON b.id = m.business_id
ORDER BY b.name;