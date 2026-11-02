import { describe, it, expect } from 'vitest';
import {
  formatCustomerAddress,
  mapQuotationToUniversalData,
  mapSalesOrderToUniversalData,
  mapSalesInvoiceToUniversalData,
  mapPurchaseOrderToUniversalData,
  mapPurchaseBillToUniversalData,
  mapCreditNoteToUniversalData,
  mapDebitNoteToUniversalData,
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

    it('maps invoice_time, time, and created_at to universal data', () => {
      const invoice = {
        invoice_number: 'ABC/SE/26-27/13',
        invoice_date: '2026-10-26',
        invoice_time: '04:32 pm',
        time: '04:32 pm',
        created_at: '2026-10-26T11:02:00.000Z',
        customer: { name: 'Acme Corp' },
      };
      const data = mapSalesInvoiceToUniversalData({ name: 'Avadh Boring' }, invoice);
      expect(data.date).toBe('2026-10-26');
      expect(data.invoice_time).toBe('04:32 pm');
      expect(data.time).toBe('04:32 pm');
      expect(data.created_at).toBe('2026-10-26T11:02:00.000Z');
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

    it('maps explicit and inferred round_off correctly across documents', () => {
      // 1. Explicit round_off
      const invoice = {
        invoice_number: 'ABC/SE/26-27/13',
        subtotal: 152381,
        taxable_amount: 152381,
        cgst_amount: 3809.53,
        sgst_amount: 3809.52,
        round_off: -0.05,
        grand_total: 160000,
      };
      const data = mapSalesInvoiceToUniversalData(business, invoice, []);
      expect(data.roundOff).toBe(-0.05);
      expect(data.round_off).toBe(-0.05);
      expect(data.totalAmount).toBe(160000);

      // 2. Quotation QT/ABC/SE/26-27/1 without round_off in DB (grand_total was 160000.05)
      const quote = {
        quotation_number: 'QT/ABC/SE/26-27/1',
        subtotal: 152381,
        cgst_amount: 3809.53,
        sgst_amount: 3809.52,
        round_off: 0,
        grand_total: 160000.05,
      };
      const quoteData = mapQuotationToUniversalData(business, quote, []);
      expect(quoteData.roundOff).toBe(-0.05);
      expect(quoteData.round_off).toBe(-0.05);
      expect(quoteData.grandTotal).toBe(160000);
      expect(quoteData.totalAmount).toBe(160000);

      // 3. Sales Order SO/ABC/SE/26-27/1 without round_off in DB
      const order = {
        order_number: 'SO/ABC/SE/26-27/1',
        subtotal: 152381,
        cgst_amount: 3809.53,
        sgst_amount: 3809.52,
        grand_total: 160000.05,
      };
      const orderData = mapSalesOrderToUniversalData(business, order, []);
      expect(orderData.roundOff).toBe(-0.05);
      expect(orderData.round_off).toBe(-0.05);
      expect(orderData.grandTotal).toBe(160000);
      expect(orderData.totalAmount).toBe(160000);

      // 4. Credit Note & Debit Note mappers
      const cn = {
        credit_note_number: 'CN/ABC/SE/26-27/1',
        subtotal: 152381,
        cgst_amount: 3809.53,
        sgst_amount: 3809.52,
      };
      const cnData = mapCreditNoteToUniversalData(business, cn, []);
      expect(cnData.roundOff).toBe(-0.05);
      expect(cnData.grandTotal).toBe(160000);

      const dn = {
        debit_note_number: 'DN/ABC/SE/26-27/1',
        subtotal: 152381,
        cgst_amount: 3809.53,
        sgst_amount: 3809.52,
      };
      const dnData = mapDebitNoteToUniversalData(business, dn, []);
      expect(dnData.roundOff).toBe(-0.05);
      expect(dnData.grandTotal).toBe(160000);
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

    it('maps project_details and discom_utility in mapQuotationToUniversalData', () => {
      const quote = {
        quotation_number: 'QT-2026-99',
        project_details: {
          project_name: '10 kW On-Grid Solar Plant',
          plant_type: 'Grid-Tie Rooftop with Net-Metering',
          roof_type: 'RCC Flat Roof / Metal Shed (Hot-Dip GI)',
          subsidy_scheme: 'Central PM Surya Ghar + UPNEDA State DBT',
        },
        discom_utility: 'PVVNL',
      };
      const mapped = mapQuotationToUniversalData({}, quote);
      expect(mapped.project_details?.project_name).toBe('10 kW On-Grid Solar Plant');
      expect(mapped.project_details?.plant_type).toBe('Grid-Tie Rooftop with Net-Metering');
      expect(mapped.discom_utility).toBe('PVVNL');
      expect(mapped.customer?.discom_utility).toBe('PVVNL');
    });
  });
});
