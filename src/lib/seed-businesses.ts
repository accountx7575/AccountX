/**
 * AccountX Super Admin Seed Data
 * 6 Indian Business Tenants for Super Admin Panel
 * 
 * This seed data can be imported into the AccountX application
 * or used as mock data for the Super Admin panel development.
 */

export const seedBusinesses = [
  {
    id: 'biz-reliance-retail-logistics',
    name: 'Reliance Retail Logistics Ltd',
    legalName: 'Reliance Retail Logistics Ltd',
    gstin: '27AABCR1234F1Z5',
    businessType: 'Logistics',
    status: 'active',
    ownerEmail: 'operations@reliancelogistics.com',
    city: 'Mumbai',
    state: 'MH',
    country: 'India',
    createdAt: new Date('2024-01-15').toISOString(),
    updatedAt: new Date('2024-01-15').toISOString()
  },
  {
    id: 'biz-bharat-electronics-motors',
    name: 'Bharat Electronics & Motors',
    legalName: 'Bharat Electronics & Motors',
    gstin: '07AAACB9876Q1Z2',
    businessType: 'Manufacturing',
    status: 'active',
    ownerEmail: 'info@bharatelectronics.com',
    city: 'Delhi',
    state: 'DL',
    country: 'India',
    createdAt: new Date('2024-02-20').toISOString(),
    updatedAt: new Date('2024-02-20').toISOString()
  },
  {
    id: 'biz-apex-cloud-infotech',
    name: 'Apex Cloud Infotech Pvt Ltd',
    legalName: 'Apex Cloud Infotech Pvt Ltd',
    gstin: '29ABCDE1122C1Z4',
    businessType: 'SaaS',
    status: 'active',
    ownerEmail: 'dev@apexcloud.in',
    city: 'Bangalore',
    state: 'KA',
    country: 'India',
    createdAt: new Date('2024-03-10').toISOString(),
    updatedAt: new Date('2024-03-10').toISOString()
  },
  {
    id: 'biz-kashi-textiles-handloom',
    name: 'Kashi Textiles & Handloom',
    legalName: 'Kashi Textiles & Handloom',
    gstin: '09AABCK5544H1Z8',
    businessType: 'Retail',
    status: 'blocked',
    ownerEmail: 'sales@kashitextiles.com',
    city: 'Varanasi',
    state: 'UP',
    country: 'India',
    createdAt: new Date('2024-01-25').toISOString(),
    updatedAt: new Date('2024-01-25').toISOString()
  },
  {
    id: 'biz-deccan-agro-commodities',
    name: 'Deccan Agro Commodities',
    legalName: 'Deccan Agro Commodities',
    gstin: '36AABCD9988G1Z1',
    businessType: 'Agriculture',
    status: 'active',
    ownerEmail: 'procurement@deccanagro.com',
    city: 'Pune',
    state: 'MH',
    country: 'India',
    createdAt: new Date('2024-04-05').toISOString(),
    updatedAt: new Date('2024-04-05').toISOString()
  },
  {
    id: 'biz-avadh-boring-company',
    name: 'Avadh Boring Company',
    legalName: 'Avadh Boring Company',
    gstin: '09AABCU9603R1ZM',
    businessType: 'Services',
    status: 'active',
    ownerEmail: 'contact@avadhboring.com',
    city: 'Lucknow',
    state: 'UP',
    country: 'India',
    createdAt: new Date('2024-05-01').toISOString(),
    updatedAt: new Date('2024-05-01').toISOString()
  }
];

/**
 * Get active businesses only
 */
export const getActiveBusinesses = (businesses) => {
  return businesses.filter(b => b.status === 'active');
};

/**
 * Get blocked businesses only
 */
export const getBlockedBusinesses = (businesses) => {
  return businesses.filter(b => b.status === 'blocked');
};

/**
 * Get business by ID
 */
export const getBusinessById = (businesses, id) => {
  return businesses.find(b => b.id === id) || null;
};

/**
 * Get business by GSTIN
 */
export const getBusinessByGstin = (businesses, gstin) => {
  return businesses.find(b => b.gstin === gstin) || null;
};

/**
 * Sample usage:
 * const { seedBusinesses, getActiveBusinesses } = require('./seed-data');
 * const active = getActiveBusinesses(seedBusinesses);
 * console.log(`Active businesses: ${active.length}`);
 */