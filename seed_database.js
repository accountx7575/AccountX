import { createClient } from '@supabase/supabase-js';

const supa = createClient(
  'https://zvdjpxfmhauwihuywnsn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc3Brd3hjeWphenFqcWRkYWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjUzMjYsImV4cCI6MjEwMjgwMTMyNn0.bCBtnWaLwWiwy7fUibFfIAEnqoEOJlgchFNMyC2frUk'
);

async function seedDatabase() {
  try {
    // Step 1: Create 8 Indian businesses with GSTINs and owner emails
    const businesses = [
      {
        name: 'Delhi Traders',
        legal_name: 'Delhi Traders Private Limited',
        business_type: 'Trading',
        gstin: '09AABCD1234E1Z5',
        email: 'contact@delhitraders.in',
        city: 'Delhi',
        state: 'DL',
        phone: '+91-11-23456789'
      },
      {
        name: 'Bangalore Tech',
        legal_name: 'Bangalore Tech Solutions LLP',
        business_type: 'Services',
        gstin: '29AABCE5678F1Z9',
        email: 'info@bangaloretech.io',
        city: 'Bangalore',
        state: 'KA',
        phone: '+91-80-23456789'
      },
      {
        name: 'Mumbai Pharma',
        legal_name: 'Mumbai Pharma Distributors',
        business_type: 'Trading',
        gstin: '27AABCF9012A1Z4',
        email: 'accounts@mumbaipharma.com',
        city: 'Mumbai',
        state: 'MH',
        phone: '+91-22-23456789'
      },
      {
        name: 'Chennai Manufacturing',
        legal_name: 'Chennai Manufacturing Co',
        business_type: 'Manufacturing',
        gstin: '33AABCG5432B1Z8',
        email: 'factory@chennaimfg.com',
        city: 'Chennai',
        state: 'TN',
        phone: '+91-44-23456789'
      },
      {
        name: 'Kolkata Retail',
        legal_name: 'Kolkata Retail Enterprises',
        business_type: 'Retail',
        gstin: '19AABCH7890C1Z2',
        email: 'sales@kolkataretail.com',
        city: 'Kolkata',
        state: 'WB',
        phone: '+91-33-23456789'
      },
      {
        name: 'Pune Tech',
        legal_name: 'Pune Tech Industries',
        business_type: 'Services',
        gstin: '10AABCI3456D1Z7',
        email: 'contact@punetech.io',
        city: 'Pune',
        state: 'MH',
        phone: '+91-20-23456789'
      },
      {
        name: 'Hyderabad Trading',
        legal_name: 'Hyderabad Trading Company',
        business_type: 'Trading',
        gstin: '37AABCJ7890E1Z3',
        email: 'info@hydrabadetrading.com',
        city: 'Hyderabad',
        state: 'AP',
        phone: '+91-40-23456789'
      },
      {
        name: 'Ahmedabad Manufacturing',
        legal_name: 'Ahmedabad Manufacturing Works',
        business_type: 'Manufacturing',
        gstin: '24AABCK1234F1Z6',
        email: 'accounts@ahmedabadmfg.com',
        city: 'Ahmedabad',
        state: 'GJ',
        phone: '+91-79-23456789'
      }
    ];

    console.log('Creating businesses...');
    
    // Insert businesses
    const businessIds = [];
    for (const biz of businesses) {
      const { data, error } = await supa
        .from('businesses')
        .insert({
          name: biz.name,
          legal_name: biz.legal_name,
          business_type: biz.business_type,
          gstin: biz.gstin,
          email: biz.email,
          phone: biz.phone,
          city: biz.city,
          state: biz.state,
          country: 'India',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (error) {
        console.error('Error inserting business:', error.message, biz.name);
      } else {
        businessIds.push(data.id);
        console.log(`Created business: ${biz.name} (ID: ${data.id})`);
      }
    }

    // Step 2: Add business members (owners) for each business
    console.log('Creating business members...');
    const ownerEmails = [
      'contact@delhitraders.in',
      'info@bangaloretech.io', 
      'accounts@mumbaipharma.com',
      'factory@chennaimfg.com',
      'sales@kolkataretail.com',
      'contact@punetech.io',
      'info@hydrabadetrading.com',
      'accounts@ahmedabadmfg.com'
    ];

    for (let i = 0; i < businessIds.length; i++) {
      const bizId = businessIds[i];
      
      // Insert a business member with owner role
      const { error: memberError } = await supa
        .from('business_members')
        .insert({
          business_id: bizId,
          user_id: `00000000-0000-0000-0000-${i + 1}000`, // placeholder user ID
          role: 'owner',
          is_active: true,
          invited_at: new Date().toISOString(),
          joined_at: new Date().toISOString()
        });
      
      if (memberError) {
        console.error('Error inserting member:', memberError.message);
      } else {
        console.log(`Added owner for business ${i + 1}`);
      }
    }

    // Step 3: Create customers for each business (to generate invoices)
    console.log('Creating customers...');
    const customerData = [
      { business_id: businessIds[0], name: 'Rajesh Kumar', company_name: 'Delhi Retail', email: 'rajesh@delhishop.com' },
      { business_id: businessIds[0], name: 'Suresh Gupta', company_name: 'Delhi Enterprises', email: 'suresh@delhimenterprises.com' },
      { business_id: businessIds[1], name: 'Priya Singh', company_name: 'Bangalore Software', email: 'priya@bangalore.biz' },
      { business_id: businessIds[1], name: 'Vijay Reddy', company_name: 'Bangalore Tech', email: 'vijay@bangalore.software' },
      { business_id: businessIds[2], name: 'Anita Sharma', company_name: 'Mumbai Pharma', email: 'anita@mumbaipharma.com' },
      { business_id: businessIds[2], name: 'Sunil Patel', company_name: 'MediKart', email: 'sunil@medikart.com' },
      { business_id: businessIds[3], name: 'Gopalakrishnan', company_name: 'Chennai Mills', email: 'gopi@chennaimills.com' },
      { business_id: businessIds[3], name: 'Kumaravel', company_name: 'Chennai Textiles', email: 'kumar@chennai.textiles' },
      { business_id: businessIds[4], name: 'Mohammed Ali', company_name: 'Kolkata Stores', email: 'ali@kolkatastores.com' },
      { business_id: businessIds[4], name: 'Tapas Bannerjee', company_name: 'Kolkata Traders', email: 'tapas@kolkatabusiness.com' },
      { business_id: businessIds[5], name: 'Arun Mehra', company_name: 'Pune IT Solutions', email: 'arun@punetech.com' },
      { business_id: businessIds[5], name: 'Sanjay Joshi', company_name: 'Pune Computing', email: 'sanjay@punecorp.com' },
      { business_id: businessIds[6], name: 'Rahul Nair', company_name: 'Hyderabad Trade', email: 'rahul@hydrabadetrade.com' },
      { business_id: businessIds[6], name: 'Lakshmi Priya', company_name: 'Hyderabad Enterprises', email: 'lpriya@hydrabad.biz' },
      { business_id: businessIds[7], name: 'Vikram Singh', company_name: 'Ahmedabad Industry', email: 'vikram@ahmedabad.in' },
      { business_id: businessIds[7], name: 'Deepak Patel', company_name: 'Ahmedabad Chemicals', email: 'deepak@ahmedabad.chem' }
    ];

    for (const cust of customerData) {
      const { error: custError } = await supa
        .from('customers')
        .insert({
          business_id: cust.business_id,
          name: cust.name,
          company_name: cust.company_name,
          email: cust.email,
          gstin: '',
          status: 'active',
          opening_balance: 0,
          current_balance: 0,
          total_sales: 0,
          total_paid: 0,
          credit_limit: 0,
          notes: 'Seeded for platform metrics'
        });
      
      if (custError) {
        console.error('Error inserting customer:', custError.message);
      }
    }

    // Step 4: Create products for each business
    console.log('Creating products...');
    const productData = [
      // Delhi Traders (businessIds[0]) - products for retail
      { business_id: businessIds[0], name: 'HP Printer', sku: 'HP-PRT-001', hsn_sac: '84433310', unit: 'PCS', purchase_price: 5000, selling_price: 8000, tax_rate: 18 },
      { business_id: businessIds[0], name: 'Dell Laptop', sku: 'DELL-LAP-001', hsn_sac: '84713010', unit: 'PCS', purchase_price: 45000, selling_price: 65000, tax_rate: 18 },
      
      // Bangalore Tech (businessIds[1]) - services
      { business_id: businessIds[1], name: 'Software Support', sku: 'SRV-BASIC', hsn_sac: '998314', unit: 'HOUR', purchase_price: 0, selling_price: 2000, tax_rate: 18 },
      { business_id: businessIds[1], name: 'Cloud Hosting', sku: 'SRV-CLOUD', hsn_sac: '998314', unit: 'MONTH', purchase_price: 0, selling_price: 5000, tax_rate: 18 },
      
      // Mumbai Pharma (businessIds[2]) - trading pharma
      { business_id: businessIds[2], name: 'Paracetamol 500mg', sku: 'PARA-500', hsn_sac: '30041010', unit: 'STRIP', purchase_price: 10, selling_price: 20, tax_rate: 12 },
      { business_id: businessIds[2], name: 'Amoxicillin 500mg', sku: 'AMOX-500', hsn_sac: '30042010', unit: 'STRIP', purchase_price: 15, selling_price: 30, tax_rate: 12 },
      
      // Chennai Manufacturing (businessIds[3]) - manufacturing
      { business_id: businessIds[3], name: 'Steel Bracket', sku: 'STEEL-BRK', hsn_sac: '73079910', unit: 'PCS', purchase_price: 50, selling_price: 80, tax_rate: 18 },
      { business_id: businessIds[3], name: 'Aluminum Frame', sku: 'ALUM-FRM', hsn_sac: '76109010', unit: 'PCS', purchase_price: 75, selling_price: 120, tax_rate: 18 },
      
      // Kolkata Retail (businessIds[4]) - retail
      { business_id: businessIds[4], name: 'Washing Soap', sku: 'SOAP-001', hsn_sac: '34011110', unit: 'PCS', purchase_price: 15, selling_price: 25, tax_rate: 18 },
      { business_id: businessIds[4], name: 'Rice 1kg', sku: 'RICE-001', hsn_sac: '10063010', unit: 'PCS', purchase_price: 40, selling_price: 60, tax_rate: 5 },
      
      // Pune Tech (businessIds[5]) - services
      { business_id: businessIds[5], name: 'Consulting Session', sku: 'CONS-001', hsn_sac: '998314', unit: 'HOUR', purchase_price: 0, selling_price: 3000, tax_rate: 18 },
      { business_id: businessIds[5], name: 'Training Workshop', sku: 'WRK-001', hsn_sac: '998314', unit: 'SESSION', purchase_price: 0, selling_price: 15000, tax_rate: 18 },
      
      // Hyderabad Trading (businessIds[6]) - trading
      { business_id: businessIds[6], name: 'Tea Leaves', sku: 'TEA-001', hsn_sac: '09023100', unit: 'KG', purchase_price: 200, selling_price: 350, tax_rate: 5 },
      { business_id: businessIds[6], name: 'Coffee Beans', sku: 'COFFEE-001', hsn_sac: '09011100', unit: 'KG', purchase_price: 500, selling_price: 800, tax_rate: 5 },
      
      // Ahmedabad Manufacturing (businessIds[7]) - manufacturing
      { business_id: businessIds[7], name: 'Plastic Container', sku: 'PLASTIC-CON', hsn_sac: '39233010', unit: 'PCS', purchase_price: 25, selling_price: 45, tax_rate: 18 },
      { business_id: businessIds[7], name: 'Steel Pipe', sku: 'STEEL-PIPE', hsn_sac: '73041210', unit: 'PCS', purchase_price: 100, selling_price: 180, tax_rate: 18 }
    ];

    for (const prod of productData) {
      const { error: prodError } = await supa
        .from('products')
        .insert({
          business_id: prod.business_id,
          name: prod.name,
          sku: prod.sku,
          hsn_sac: prod.hsn_sac,
          unit: prod.unit,
          type: 'product',
          purchase_price: prod.purchase_price,
          selling_price: prod.selling_price,
          tax_rate: prod.tax_rate,
          tax_inclusive: false,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (prodError) {
        console.error('Error inserting product:', prodError.message);
      }
    }

    // Step 5: Create sales invoices to reach 40+ total
    console.log('Creating sales invoices...');
    const invoiceData = [];
    
    // Generate ~5 invoices per business to reach 40+
    let invoiceNum = 1001;
    for (let bi = 0; bi < businessIds.length; bi++) {
      const numInvoices = 5 + bi; // 5-12 invoices per business
      for (let i = 0; i < numInvoices; i++) {
        const subtotal = (2000 + Math.random() * 10000).toFixed(2);
        const tax_rate = [5, 12, 18][Math.floor(Math.random() * 3)];
        const cgst = (parseFloat(subtotal) * tax_rate / 2 / 100).toFixed(2);
        const sgst = (parseFloat(subtotal) * tax_rate / 2 / 100).toFixed(2);
        const igst = (parseFloat(subtotal) * tax_rate / 100).toFixed(2);
        const grand_total = (parseFloat(subtotal) + (tax_rate % 2 === 0 ? parseFloat(cgst + sgst) : parseFloat(igst))).toFixed(2);
        const paid_amount = Math.random() > 0.3 ? (parseFloat(grand_total) * (0.7 + Math.random() * 0.3)).toFixed(2) : '0.00';
        const balance_amount = (parseFloat(grand_total) - parseFloat(paid_amount)).toFixed(2);
        const payment_status = paid_amount !== '0.00' ? ('paid'.repeat(Math.floor(Math.random() * 2) + 1)) : 'unpaid';
        const status = ['draft', 'issued', 'partially_paid', 'paid', 'cancelled'][Math.floor(Math.random() * 5)];
        
        invoiceData.push({
          business_id: businessIds[bi],
          customer_id: `00000000-0000-0000-0000-${bi + 1}00`, // placeholder
          invoice_number: `INV-${invoiceNum}`,
          invoice_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          subtotal: parseFloat(subtotal),
          taxable_amount: parseFloat(subtotal),
          cgst_amount: tax_rate === 18 ? parseFloat(cgst) : 0,
          sgst_amount: tax_rate === 18 ? parseFloat(sgst) : 0,
          igst_amount: tax_rate !== 18 ? parseFloat(igst) : 0,
          round_off: (Math.random() * 10).toFixed(2),
          grand_total: parseFloat(grand_total),
          paid_amount: parseFloat(paid_amount),
          balance_amount: parseFloat(balance_amount),
          payment_status: payment_status,
          status: status,
          payment_method: ['cash', 'upi', 'bank', 'card'][Math.floor(Math.random() * 4)],
          notes: 'Seeded for platform metrics',
          created_by: `00000000-0000-0000-0000-${bi + 1}00`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        invoiceNum++;
      }
    }

    // Insert invoices in batches
    const batchSize = 20;
    for (let i = 0; i < invoiceData.length; i += batchSize) {
      const batch = invoiceData.slice(i, i + batchSize);
      const { error: invError } = await supa.from('sales_invoices').insert(batch);
      if (invError) {
        console.error('Error inserting invoices batch:', invError.message);
      } else {
        console.log(`Inserted invoice batch ${Math.floor(i/batchSize) + 1}: ${batch.length} invoices`);
      }
    }

    // Step 6: Verify the counts
    console.log('\n=== VERIFICATION ===');
    
    const { count: businessCount, error: countError } = await supa.from('businesses').select('*', { count: 'exact', head: 'count' });
    console.log(`Total Businesses: ${businessCount}`);
    
    const { count: userCount } = await supa.from('auth.users').select('*', { count: 'exact', head: 'count' });
    console.log(`Total Platform Users: ${userCount}`);
    
    const { count: invoiceCount } = await supa.from('sales_invoices').select('*', { count: 'exact', head: 'count' });
    console.log(`Total Invoices Generated: ${invoiceCount}`);
    
    console.log('\n=== Seed data creation complete ===');
    
  } catch (err) {
    console.error('Fatal error:', err);
  }
}

seedDatabase();