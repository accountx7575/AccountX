import { describe, it, expect } from 'vitest';
import {
  formatCustomerAddress,
  mapQuotationToUniversalData,
  mapSalesOrderToUniversalData,
  mapSalesInvoiceToUniversalData,
  mapPurchaseOrderToUniversalData,
  mapPurchaseBillToUniversalData,
  resolveBusinessProfile,
} from './documentMappers';

describe('documentMappers', () => {
  describe('formatCustomerAddress', () => {
    it('constructs clean address lines with street and City, State - PIN', () => {
      const cust = {
        name: 'ayan',
        address: '123 Business Street',
        city: 'Barabanki',
        state: 'Uttar Pradesh',
        pincode: '225001',
      };
      const formatted = formatCustomerAddress(cust);
      expect(formatted.streetAddress).toBe('123 Business Street');
      expect(formatted.cityStatePin).toBe('Barabanki, Uttar Pradesh - 225001');
      expect(formatted.fullAddress).toBe('123 Business Street\nBarabanki, Uttar Pradesh - 225001');
    });

    it('handles billing_address and pin_code aliases defensively', () => {
      const cust = {
        name: 'ayan',
        billing_address: '456 Market Lane',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
        pin_code: '226001',
      };
      const formatted = formatCustomerAddress(cust);
      expect(formatted.streetAddress).toBe('456 Market Lane');
      expect(formatted.cityStatePin).toBe('Lucknow, Uttar Pradesh - 226001');
      expect(formatted.fullAddress).toBe('456 Market Lane\nLucknow, Uttar Pradesh - 226001');
    });

    it('handles missing street address or missing city/state gracefully', () => {
      const onlyStreet = formatCustomerAddress({ address: '123 Street' });
      expect(onlyStreet.fullAddress).toBe('123 Street');

      const onlyCity = formatCustomerAddress({ city: 'Barabanki', state: 'Uttar Pradesh', pincode: '225001' });
      expect(onlyCity.fullAddress).toBe('');
      expect(onlyCity.cityStatePin).toBe('Barabanki, Uttar Pradesh - 225001');

      const empty = formatCustomerAddress({});
      expect(empty.fullAddress).toBe('');
    });
  });

  describe('mapQuotationToUniversalData', () => {
    it('maps customer address to fullAddress matching company header structure', () => {
      const quote = {
        quotation_number: 'QT/26-27/001',
        customer: {
          name: 'ayan',
          address: '123 Business Street',
          city: 'Barabanki',
          state: 'Uttar Pradesh',
          pincode: '225001',
        },
      };
      const data = mapQuotationToUniversalData({ name: 'GyftKart' }, quote);
      expect(data.customer.name).toBe('ayan');
      expect(data.customer.address).toBe('123 Business Street\nBarabanki, Uttar Pradesh - 225001');
      expect(data.customer.city).toBe('Barabanki');
      expect(data.customer.state).toBe('Uttar Pradesh');
      expect(data.customer.pincode).toBe('225001');
    });
  });

  describe('mapSalesOrderToUniversalData', () => {
    it('maps customer address to fullAddress matching company header structure', () => {
      const order = {
        order_number: 'SO/26-27/001',
        customer: {
          name: 'ayan',
          address: '123 Business Street',
          city: 'Barabanki',
          state: 'Uttar Pradesh',
          pincode: '225001',
        },
      };
      const data = mapSalesOrderToUniversalData({ name: 'GyftKart' }, order);
      expect(data.customer.name).toBe('ayan');
      expect(data.customer.address).toBe('123 Business Street\nBarabanki, Uttar Pradesh - 225001');
    });
  });

  describe('mapSalesInvoiceToUniversalData', () => {
    it('maps customer address to fullAddress matching company header structure', () => {
      const invoice = {
        invoice_number: 'INV/26-27/001',
        customer: {
          name: 'ayan',
          address: '123 Business Street',
          city: 'Barabanki',
          state: 'Uttar Pradesh',
          pincode: '225001',
        },
      };
      const data = mapSalesInvoiceToUniversalData({ name: 'GyftKart' }, invoice);
      expect(data.customer.name).toBe('ayan');
      expect(data.customer.address).toBe('123 Business Street\nBarabanki, Uttar Pradesh - 225001');
    });
  });

  describe('mapPurchaseOrderToUniversalData', () => {
    it('maps supplier address to fullAddress matching company header structure', () => {
      const order = {
        order_number: 'PO/26-27/001',
        supplier: {
          name: 'Acme Supplies',
          address: '789 Industrial Area',
          city: 'Kanpur',
          state: 'Uttar Pradesh',
          pincode: '208001',
        },
      };
      const data = mapPurchaseOrderToUniversalData({ name: 'GyftKart' }, order);
      expect(data.customer.name).toBe('Acme Supplies');
      expect(data.customer.address).toBe('789 Industrial Area\nKanpur, Uttar Pradesh - 208001');
    });
  });

  describe('mapPurchaseBillToUniversalData', () => {
    it('maps supplier address to fullAddress matching company header structure', () => {
      const bill = {
        bill_number: 'BILL/26-27/001',
        supplier: {
          name: 'Acme Supplies',
          address: '789 Industrial Area',
          city: 'Kanpur',
          state: 'Uttar Pradesh',
          pincode: '208001',
        },
      };
      const data = mapPurchaseBillToUniversalData({ name: 'GyftKart' }, bill);
      expect(data.company?.name).toBe('Acme Supplies');
      expect(data.company?.address).toBe('789 Industrial Area\nKanpur, Uttar Pradesh - 208001');
    });

    it('maps buyer address and contact information to customer object', () => {
      const business = {
        name: 'Avadh Boring Company',
        address: 'AN-25, Lautabagh, Azadnagar, Nawabganj',
        city: 'Barabanki',
        state: 'Uttar Pradesh',
        pincode: '225001',
        phone: '+91 9450942418',
        email: 'abc.solar7575@gmail.com',
      };
      const bill = {
        bill_number: 'PB/001',
        supplier: { name: 'Acme' },
      };
      const data = mapPurchaseBillToUniversalData(business, bill);
      expect(data.customer?.name).toBe('Avadh Boring Company');
      expect(data.customer?.address).toBe('AN-25, Lautabagh, Azadnagar, Nawabganj\nBarabanki, Uttar Pradesh - 225001');
      expect(data.customer?.phone).toBe('+91 9450942418');
      expect(data.customer?.email).toBe('abc.solar7575@gmail.com');
    });
  });

  describe('tax, GST and Grand Total calculations', () => {
    const business = {
      name: 'GyftKart',
      state: 'Uttar Pradesh',
    };

    it('resolves item taxRate and sets tax string on line items', () => {
      const quote = {
        quotation_number: 'QT-001',
        customer: { name: 'Acme', state: 'Uttar Pradesh' },
      };
      const items = [
        { product_name: 'Item A', quantity: 2, rate: 500, tax_rate: 18 },
        { product_name: 'Item B', quantity: 1, rate: 1000, gst_rate: 12 },
        { product_name: 'Item C', quantity: 1, rate: 200, tax_percentage: 5 },
        { product_name: 'Item D', quantity: 1, rate: 100, tax_rate: 0 },
      ];

      const data = mapQuotationToUniversalData(business, quote, items);
      expect(data.items[0].taxRate).toBe(18);
      expect(data.items[0].tax).toBe('18%');
      expect(data.items[1].taxRate).toBe(12);
      expect(data.items[1].tax).toBe('12%');
      expect(data.items[2].taxRate).toBe(5);
      expect(data.items[2].tax).toBe('5%');
      expect(data.items[3].taxRate).toBe(0);
      expect(data.items[3].tax).toBe('0%');
    });

    it('calculates Intra-State CGST and SGST equally and computes grand total', () => {
      const order = {
        order_number: 'SO-101',
        customer: { name: 'Local Buyer', state: 'Uttar Pradesh' },
      };
      const items = [
        { product_name: 'Widget', quantity: 2, rate: 5000, tax_rate: 18 }, // taxable 10000, tax 1800 (CGST 900, SGST 900)
      ];

      const data = mapSalesOrderToUniversalData(business, order, items);
      expect(data.isIntraState).toBe(true);
      expect(data.subtotal).toBe(10000);
      expect(data.cgstAmount).toBe(900);
      expect(data.sgstAmount).toBe(900);
      expect(data.igstAmount).toBe(0);
      expect(data.totalAmount).toBe(11800);
      expect(data.grandTotal).toBe(11800);
      expect(data.amountInWords).toBe('Eleven Thousand Eight Hundred Rupees Only');
    });

    it('calculates Inter-State IGST when states differ', () => {
      const invoice = {
        invoice_number: 'INV-201',
        customer: { name: 'Outstation Buyer', state: 'Maharashtra' },
      };
      const items = [
        { product_name: 'Service', quantity: 1, rate: 20000, tax_rate: 18 },
      ];

      const data = mapSalesInvoiceToUniversalData(business, invoice, items);
      expect(data.isIntraState).toBe(false);
      expect(data.subtotal).toBe(20000);
      expect(data.cgstAmount).toBe(0);
      expect(data.sgstAmount).toBe(0);
      expect(data.igstAmount).toBe(3600);
      expect(data.totalAmount).toBe(23600);
      expect(data.grandTotal).toBe(23600);
      expect(data.amountInWords).toBe('Twenty Three Thousand Six Hundred Rupees Only');
    });

    it('falls back to calculated totals when grand_total or total_amount is 0 or missing in doc', () => {
      const quote = {
        quotation_number: 'QT-999',
        total_amount: 0,
        customer: { name: 'Customer', state: 'Uttar Pradesh' },
      };
      const items = [
        { product_name: 'Gadget', quantity: 1, rate: 1000, tax_rate: 18 },
      ];

      const data = mapQuotationToUniversalData(business, quote, items);
      expect(data.subtotal).toBe(1000);
      expect(data.totalAmount).toBe(1180);
      expect(data.grandTotal).toBe(1180);
      expect(data.amountInWords).toBe('One Thousand One Hundred Eighty Rupees Only');
    });

    it('maps bank and UPI details into data and company', () => {
      const bizWithBank = {
        name: 'GyftKart',
        bank_name: 'HDFC Bank',
        bank_account_number: '9876543210',
        account_name: 'GyftKart Solutions Pvt Ltd',
        bank_ifsc_code: 'HDFC0001234',
        upi_id: 'gyftkart@hdfcbank',
      };
      const order = {
        order_number: 'SO-BANK-1',
        customer: { name: 'Customer' },
      };
      const data = mapSalesOrderToUniversalData(bizWithBank, order, []);
      expect(data.bankDetails?.bankName).toBe('HDFC Bank');
      expect(data.bankDetails?.accountNumber).toBe('9876543210');
      expect(data.bankDetails?.accountHolderName).toBe('GyftKart Solutions Pvt Ltd');
      expect(data.bankDetails?.ifsc).toBe('HDFC0001234');
      expect(data.bankDetails?.upiId).toBe('gyftkart@hdfcbank');

      expect(data.company?.bankName).toBe('HDFC Bank');
      expect(data.company?.bank_account_no).toBe('9876543210');
      expect(data.company?.bank_ifsc).toBe('HDFC0001234');
      expect(data.company?.upi_id).toBe('gyftkart@hdfcbank');
    });
  });

  describe('resolveBusinessProfile', () => {
    it('resolves payment receipt terms from business settings', () => {
      const biz = {
        name: 'Test Business',
        terms_payment_receipt: 'All payments subject to clearing.',
      };
      const profile = resolveBusinessProfile(biz);
      expect(profile.terms_payment_receipt).toBe('All payments subject to clearing.');
      expect(profile.termsPaymentReceipt).toBe('All payments subject to clearing.');
    });

    it('falls back to null or cache when terms are empty', () => {
      const biz = {
        name: 'Test Business',
      };
      const profile = resolveBusinessProfile(biz);
      expect(profile.terms_payment_receipt).toBeNull();
      expect(profile.termsPaymentReceipt).toBeNull();
    });

    it('resolves logo_url and logoUrl from business', () => {
      const biz = {
        name: 'Avadh Boring Company',
        logo_url: 'data:image/png;base64,ABC123',
      };
      const profile = resolveBusinessProfile(biz);
      expect(profile.logo_url).toBe('data:image/png;base64,ABC123');
      expect(profile.logoUrl).toBe('data:image/png;base64,ABC123');

      const mapped = mapSalesOrderToUniversalData(biz, { order_number: 'SO-1' });
      expect(mapped.company?.logo_url).toBe('data:image/png;base64,ABC123');
      expect(mapped.company?.logoUrl).toBe('data:image/png;base64,ABC123');
    });
  });
});
