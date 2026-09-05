import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  'https://zvdjpxfmhauwihuywnsn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc3Brd3hjeWphenFqcWRkYWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjUzMjYsImV4cCI6MjEwMjgwMTMyNn0.bCBtnWaLwWiwy7fUibFfIAEnqoEOJlgchFNMyC2frUk'
);

async function seedDatabase() {
  console.log('=== Seeding AccountX Super Admin Panel Data via Supabase RPC ===\n');
  
  try {
    // Step 1: First check current state
    console.log('Step 1: Checking current database state...');
    
    const { count: bizCount } = await supa.from('businesses').select('*', { count: 'exact', head: 'count' });
    const { count: invoiceCount } = await supa.from('sales_invoices').select('*', { count: 'exact', head: 'count' });
    console.log(`  Current businesses: ${bizCount}`);
    console.log(`  Current invoices: ${invoiceCount}`);
    
    // Step 2: Try to use the super admin RPCs
    console.log('\nStep 2: Attempting to seed via super admin functions...');
    
    // The get_platform_metrics RPC requires super_admin role
    // Let me try inserting directly via REST
    
    // Since we can't easily bypass RLS with anon key,
    // let me try using the SQL migration approach
    // by inserting through the service role or checking if there's a way
    
    console.log('\nNote: Direct database seeding requires service_role key');
    console.log('or bypassing RLS. Attempting alternative approach...\n');
    
    // Try inserting businesses - will likely fail due to RLS
    try {
      const { error } = await supa.from('businesses').insert({
        name: 'Test Business',
        legal_name: 'Test Legal',
        business_type: 'Trading',
        gstin: '09AAABCD123E1Z5',
        email: 'test@test.in',
        phone: '+91-11-12345678',
        city: 'Delhi',
        state: 'DL',
        country: 'India',
        is_active: true
      });
      
      if (error) {
        console.log('  ✗ Business insert failed (expected due to RLS):', error.message.substring(0, 100));
      } else {
        console.log('  ✓ Business insert succeeded');
      }
    } catch (e) {
      console.log('  ✗ Business insert error:', e.message.substring(0, 100));
    }
    
    // Step 3: Verify what we can access
    console.log('\nStep 3: Verifying accessible tables...');
    
    try {
      const { data: members, error: memError } = await supa.from('business_members').select('*', { count: 'exact', head: 'count' });
      console.log(`  business_members accessible: ${!memError}, count: ${members?.length || 0}`);
    } catch (e) {
      console.log(`  business_members error: ${e.message.substring(0, 50)}`);
    }
    
    try {
      const { data: products, error: prodError } = await supa.from('products').select('*', { count: 'exact', head: 'count' });
      console.log(`  products accessible: ${!prodError}, count: ${products?.length || 0}`);
    } catch (e) {
      console.log(`  products error: ${e.message.substring(0, 50)}`);
    }
    
    console.log('\n=== Seed Data Complete ===');
    console.log('  Seed data could not be fully inserted via anon key');
    console.log('  due to Row Level Security policies.');
    console.log('  Use service_role key or Supabase SQL editor.');
  } catch (err) {
    console.error('Fatal error:', err);
  }
}

seedDatabase();