// PBS-140: single read-path data service for the Super Admin workspace.
// Client-side reads only (no migrations, no writes) — tables already exist.
import { supabase } from '@/lib/supabase';
import { listEWayBills, type EWayBill } from '@/lib/ewayBill';
import { normalizePlanType } from '@/lib/planTypes';
import type { Business, BusinessMember, Quotation, SalesInvoice } from '@/types/db';

export type SuperAdminDocType = 'Invoice' | 'Quotation' | 'E-Way Bill';

/** The businesses table carries more columns than the shared Business type
 *  models (is_active, plan_type, monthly_invoice_quota). Keep the extra
 *  fields local instead of widening the shared type (other lanes own it).
 *  plan_type is normalised to the canonical tier id on read (PBS-153); a value
 *  the canonical set does not know is passed through unchanged so nothing is
 *  hidden from the console. */
export type SuperAdminBusiness = Business & {
  is_active?: boolean | null;
  plan_type?: string | null;
  monthly_invoice_quota?: number | null;
};

export interface SuperAdminDocRow {
  id: string;
  type: SuperAdminDocType;
  businessId: string;
  number: string;
  date: string;
  total: number;
  status: string;
  customerId: string | null;
}

export interface SuperAdminItemRow {
  name: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
}

export interface SuperAdminOverview {
  businesses: SuperAdminBusiness[];
  members: BusinessMember[];
  invoices: SalesInvoice[];
  quotations: Quotation[];
}

const DOC_LIMIT = 5000;

export async function fetchOverview(): Promise<SuperAdminOverview> {
  const [bizRes, memberRes, invoiceRes, quoteRes] = await Promise.all([
    supabase.from('businesses').select('*').order('created_at', { ascending: false }).limit(DOC_LIMIT),
    supabase.from('business_members').select('*').order('joined_at', { ascending: false }).limit(DOC_LIMIT),
    supabase
      .from('sales_invoices')
      .select('id,business_id,invoice_number,invoice_date,grand_total,status,customer_id,created_at')
      .order('created_at', { ascending: false })
      .limit(DOC_LIMIT),
    supabase
      .from('quotations')
      .select('id,business_id,quotation_number,quote_date,grand_total,status,customer_id,created_at')
      .order('created_at', { ascending: false })
      .limit(DOC_LIMIT),
  ]);

  return {
    businesses: ((bizRes.data || []) as SuperAdminBusiness[]).map((b) => ({
      ...b,
      plan_type: normalizePlanType(b.plan_type) ?? b.plan_type ?? null,
    })),
    members: (memberRes.data || []) as BusinessMember[],
    invoices: (invoiceRes.data || []) as unknown as SalesInvoice[],
    quotations: (quoteRes.data || []) as unknown as Quotation[],
  };
}

export function assembleDocs(overview: SuperAdminOverview): SuperAdminDocRow[] {
  const rows: SuperAdminDocRow[] = [];
  for (const inv of overview.invoices) {
    rows.push({
      id: inv.id,
      type: 'Invoice',
      businessId: String(inv.business_id),
      number: inv.invoice_number,
      date: inv.invoice_date,
      total: Number(inv.grand_total ?? 0),
      status: inv.status,
      customerId: inv.customer_id ?? null,
    });
  }
  for (const q of overview.quotations) {
    rows.push({
      id: q.id,
      type: 'Quotation',
      businessId: String(q.business_id),
      number: q.quotation_number,
      date: q.quote_date,
      total: Number(q.grand_total ?? 0),
      status: q.status,
      customerId: q.customer_id ?? null,
    });
  }
  for (const biz of overview.businesses) {
    for (const ew of listEWayBills(String(biz.id))) {
      if (ew.demo) continue;
      rows.push({
        id: ew.id,
        type: 'E-Way Bill',
        businessId: String(ew.businessId),
        number: ew.ewayBillNo,
        date: ew.docDate,
        total: Number(ew.totalValue ?? 0),
        status: ew.status,
        customerId: null,
      });
    }
  }
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export interface SuperAdminMetric {
  totalUsers: number;
  activeBusinesses: number;
  totalBusinesses: number;
  totalDocs: number;
  gmv: number;
}

export function computeMetrics(overview: SuperAdminOverview): SuperAdminMetric {
  const users = new Set(overview.members.map((m) => m.user_id));
  const gmv =
    overview.invoices.reduce((s, i) => s + Number(i.grand_total ?? 0), 0) +
    overview.quotations.reduce((s, q) => s + Number(q.grand_total ?? 0), 0);
  return {
    totalUsers: users.size,
    activeBusinesses: overview.businesses.filter((b) => b.is_active !== false).length,
    totalBusinesses: overview.businesses.length,
    totalDocs:
      overview.invoices.length + overview.quotations.length + ewayCount(overview),
    gmv,
  };
}

function ewayCount(overview: SuperAdminOverview): number {
  let n = 0;
  for (const biz of overview.businesses) {
    n += listEWayBills(String(biz.id)).filter((e) => !e.demo).length;
  }
  return n;
}

export function ewayRowsFor(overview: SuperAdminOverview): EWayBill[] {
  return overview.businesses.flatMap((b) => listEWayBills(String(b.id)).filter((e) => !e.demo));
}

export interface SignupBucket {
  label: string;
  count: number;
}

/** 7-day signup histogram from member joined_at (falls back to newest bucket). */
export function computeSignups(members: BusinessMember[]): SignupBucket[] {
  const buckets: SignupBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    const count = members.filter((m) => String(m.joined_at || '').slice(0, 10) === key).length;
    buckets.push({ label: key.slice(5), count });
  }
  return buckets;
}

/** Users/tenants rows: member joined to business record. Personal owner
 * email/phone are NOT client-readable (auth.users); we surface the business's
 * own contact columns and flag the gap in a humanQA note. */
export interface SuperAdminUserRow {
  memberId: string;
  userId: string;
  businessId: string;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  gstin: string;
  regDate: string;
  isActive: boolean;
  docCount: number;
  role: string;
}

export function assembleUsers(overview: SuperAdminOverview): SuperAdminUserRow[] {
  const docCounts = new Map<string, number>();
  for (const inv of overview.invoices) {
    docCounts.set(String(inv.business_id), (docCounts.get(String(inv.business_id)) ?? 0) + 1);
  }
  for (const q of overview.quotations) {
    docCounts.set(String(q.business_id), (docCounts.get(String(q.business_id)) ?? 0) + 1);
  }
  for (const biz of overview.businesses) {
    const ew = listEWayBills(String(biz.id)).filter((e) => !e.demo).length;
    docCounts.set(String(biz.id), (docCounts.get(String(biz.id)) ?? 0) + ew);
  }

  const bizMap = new Map(overview.businesses.map((b) => [String(b.id), b]));
  return overview.members.map((m) => {
    const biz = bizMap.get(String(m.business_id));
    const url = String(biz?.email || '').trim();
    return {
      memberId: m.id,
      userId: m.user_id,
      businessId: String(m.business_id),
      name: biz?.legal_name || biz?.name || 'Unnamed Business',
      email: url || '—',
      phone: biz?.phone || '—',
      businessName: biz?.name || biz?.legal_name || '—',
      gstin: biz?.gstin || '—',
      regDate: String(m.joined_at || biz?.created_at || '').slice(0, 10),
      isActive: m.is_active !== false && biz?.is_active !== false,
      docCount: docCounts.get(String(m.business_id)) ?? 0,
      role: m.role,
    };
  }).sort((a, b) => b.regDate.localeCompare(a.regDate));
}

export async function fetchDocItems(type: SuperAdminDocType, docId: string): Promise<SuperAdminItemRow[]> {
  if (type === 'E-Way Bill') return [];
  const table = type === 'Invoice' ? 'sales_invoice_items' : 'quotation_items';
  const res = await supabase
    .from(table)
    .select('product_name,quantity,unit,rate,discount_amount,taxable_amount,total_amount')
    .eq(type === 'Invoice' ? 'invoice_id' : 'quotation_id', docId)
    .limit(200);
  return ((res.data || []) as any[]).map((it) => ({
    name: it.product_name || 'Item',
    quantity: Number(it.quantity ?? 0),
    unit: it.unit || '',
    rate: Number(it.rate ?? 0),
    total: Number(it.total_amount ?? it.taxable_amount ?? 0),
  }));
}
