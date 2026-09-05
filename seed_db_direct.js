import { Pool } from 'pg';

async function seedDatabase() {
  // Try with host as IP and port explicit, no connectionString
  const pool = new Pool({
    host: '65.0.195.55',
    port: 5432,
    database: 'postgres',
    user: 'postgres.zvdjpxfmhauwihuywnsn',
    password: 'sA@9450257575',
    ssl: {
      rejectUnauthorized: false,
      // agent: require('tls').connect({ sni: 'zvdjpxfmhauwihuywnsn.supabase.co' })
    },
    connectionTimeoutMillis: 10000,
    // host: No SSL
    // ssl: false
  });
  
  const client = await pool.connect();
  
  try {
    console.log('=== Connected to Database ===\n');
    
    // Check current state
    console.log('Step 0: Checking current database state...');
    
    const { rows: biz } = await client.query(`SELECT COUNT(*) AS count FROM businesses`);
    console.log(`Current businesses: ${biz[0].count}`);
    
    const { rows: inv } = await client.query(`SELECT COUNT(*) AS count FROM sales_invoices`);
    console.log(`Current invoices: ${inv[0].count}`);
    
    // Step 1: Create businesses
    console.log('\nStep 1: Creating 8 Indian businesses...');
    
    const businesses = [
      { name: 'Delhi Traders', legal_name: 'Delhi Traders Private Limited', business_type: 'Trading', gstin: '09AABCD1234E1Z5', email: 'contact@delhitraders.in', city: 'Delhi', state: 'DL' },
      { name: 'Bangalore Tech', legal_name: 'Bangalore Tech Solutions LLP', business_type: 'Services', gstin: '29AABCE5678F1Z9', email: 'info@bangaloretech.io', city: 'Bangalore', state: 'KA' },
      { name: 'Mumbai Pharma', legal_name: 'Mumbai Pharma Distributors', business_type: 'Trading', gstin: '27AABCF9012A1Z4', email: 'accounts@mumbaipharma.com', city: 'Mumbai', state: 'MH' },
      { name: 'Chennai Manufacturing', legal_name: 'Chennai Manufacturing Co', business_type: 'Manufacturing', gstin: '33AABCG5432B1Z8', email: 'factory@chennaimfg.com', city: 'Chennai', state: 'TN' },
      { name: 'Kolkata Retail', legal_name: 'Kolkata Retail Enterprises', business_type: 'Retail', gstin: '19AABCH7890C1Z2', email: 'sales@kolkataretail.com', city: 'Kolkata', state: 'WB' },
      { name: 'Pune Tech', legal_name: 'Pune Tech Industries', business_type: 'Services', gstin: '10AABCI3456D1Z7', email: 'contact@punetech.io', city: 'Pune', state: 'MH' },
      { name: 'Hyderabad Trading', legal_name: 'Hyderabad Trading Company', business_type: 'Trading', gstin: '37AABCJ7890E1Z3', email: 'info@hydrabadetrading.com', city: 'Hyderabad', state: 'AP' },
      { name: 'Ahmedabad Manufacturing', legal_name: 'Ahmedabad Manufacturing Works', business_type: 'Manufacturing', gstin: '24AABCK1234F1Z6', email: 'accounts@ahmedabadmfg.com', city: 'Ahmedabad', state: 'GJ' }
    ];
    
    const bizResults = [];
    for (const biz of businesses) {
      const sql = `INSERT INTO businesses (name, legal_name, business_type, gstin, email, city, state, country, is_active, created_at, updated_at) VALUES ('${biz.name}', '${biz.legal_name}', '${biz.business_type}', '${biz.gstin}', '${biz.email}', '${biz.city}', '${biz.state}', 'India', true, NOW(), NOW()) RETURNING id, name`;
      const res = await client.query(sql);
      bizResults.push(res.rows[0]);
      console.log(`  ✓ Created: ${biz.name} (ID: ${res.rows[0].id})`);
    }
    
    const businessIds = bizResults.map(b => b.id);
    console.log(`\nStep 1 Complete: ${businessIds.length} businesses created\n`);
    
    // ... (rest would follow but we'll stop here for now)
    console.log('\n=== Partial Complete ===');
    console.log(`${businessCount} businesses seeded successfully`);
    
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDatabase();