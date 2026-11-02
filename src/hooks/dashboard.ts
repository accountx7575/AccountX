import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { roundTo2, toDateString } from '@/lib/utils';

const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid'];
const OPEN_BILL_STATUSES = ['confirmed', 'partially_paid'];
const BOOKED_INVOICE_STATUSES = ['issued', 'partially_paid', 'paid'];
const BOOKED_BILL_STATUSES = ['confirmed', 'partially_paid', 'paid'];
const CASH_ACCOUNT_NAMES = ['Cash', 'Bank'];

export type TrendSummary = {
  total: number;
  currentPeriodNew: number;
  previousPeriodNew: number;
  deltaPct: number | null;
};

export type CashflowPoint = {
  date: string;
  received: number;
  made: number;
  net: number;
};

export type SalesPurchasesPoint = {
  date: string;
  sales: number;
  purchases: number;
};

export type DashboardData = {
  receivables: TrendSummary | null;
  payables: TrendSummary | null;
  liquidCash: number | null;
  stockValue: number | null;
  cashflowSeries: CashflowPoint[] | null;
  salesPurchasesSeries: SalesPurchasesPoint[] | null;
};

export type DashboardResult = {
  data: DashboardData;
  isLoading: boolean;
  isError: boolean;
  refetchAll: () => void;
};

function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return toDateString(d);
}

function dayBuckets(days: number): string[] {
  return Array.from({ length: days }, (_, i) => isoDaysAgo(days - 1 - i));
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return roundTo2(((current - previous) / Math.abs(previous)) * 100);
}

function sumBy<T>(rows: T[] | null, pick: (row: T) => number): number {
  return roundTo2((rows || []).reduce((s, r) => s + pick(r), 0));
}

async function requireData<T>(res: { data: T | null; error: { message: string } | null }): Promise<T> {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function useReceivables(businessId: string | undefined) {
  return useQuery({
    queryKey: ['receivables', businessId],
    queryFn: async (): Promise<TrendSummary> => {
      const [open, currentWindow, previousWindow] = await Promise.all([
        requireData(
          await supabase
            .from('sales_invoices')
            .select('balance_amount')
            .eq('business_id', businessId!)
            .in('status', OPEN_INVOICE_STATUSES)
            .gt('balance_amount', 0)
        ),
        requireData(
          await supabase
            .from('sales_invoices')
            .select('grand_total')
            .eq('business_id', businessId!)
            .in('status', BOOKED_INVOICE_STATUSES)
            .gte('invoice_date', isoDaysAgo(29))
            .lte('invoice_date', isoDaysAgo(0))
        ),
        requireData(
          await supabase
            .from('sales_invoices')
            .select('grand_total')
            .eq('business_id', businessId!)
            .in('status', BOOKED_INVOICE_STATUSES)
            .gte('invoice_date', isoDaysAgo(59))
            .lte('invoice_date', isoDaysAgo(30))
        ),
      ]);
      const currentPeriodNew = sumBy(currentWindow, (r) => Number(r.grand_total));
      const previousPeriodNew = sumBy(previousWindow, (r) => Number(r.grand_total));
      return {
        total: sumBy(open, (r) => Number(r.balance_amount)),
        currentPeriodNew,
        previousPeriodNew,
        deltaPct: deltaPct(currentPeriodNew, previousPeriodNew),
      };
    },
    enabled: !!businessId,
  });
}

export function usePayables(businessId: string | undefined) {
  return useQuery({
    queryKey: ['payables', businessId],
    queryFn: async (): Promise<TrendSummary> => {
      const [open, currentWindow, previousWindow] = await Promise.all([
        requireData(
          await supabase
            .from('purchase_bills')
            .select('balance_amount')
            .eq('business_id', businessId!)
            .in('status', OPEN_BILL_STATUSES)
            .gt('balance_amount', 0)
        ),
        requireData(
          await supabase
            .from('purchase_bills')
            .select('grand_total')
            .eq('business_id', businessId!)
            .in('status', BOOKED_BILL_STATUSES)
            .gte('bill_date', isoDaysAgo(29))
            .lte('bill_date', isoDaysAgo(0))
        ),
        requireData(
          await supabase
            .from('purchase_bills')
            .select('grand_total')
            .eq('business_id', businessId!)
            .in('status', BOOKED_BILL_STATUSES)
            .gte('bill_date', isoDaysAgo(59))
            .lte('bill_date', isoDaysAgo(30))
        ),
      ]);
      const currentPeriodNew = sumBy(currentWindow, (r) => Number(r.grand_total));
      const previousPeriodNew = sumBy(previousWindow, (r) => Number(r.grand_total));
      return {
        total: sumBy(open, (r) => Number(r.balance_amount)),
        currentPeriodNew,
        previousPeriodNew,
        deltaPct: deltaPct(currentPeriodNew, previousPeriodNew),
      };
    },
    enabled: !!businessId,
  });
}

export function useLiquidCash(businessId: string | undefined) {
  return useQuery({
    queryKey: ['liquid-cash', businessId],
    queryFn: async (): Promise<number> => {
      const rows = await requireData(
        await supabase
          .from('accounts')
          .select('current_balance')
          .eq('business_id', businessId!)
          .in('name', CASH_ACCOUNT_NAMES)
      );
      return sumBy(rows as { current_balance: number }[], (r) => Number(r.current_balance));
    },
    enabled: !!businessId,
  });
}

export function useStockValueRetail(businessId: string | undefined) {
  return useQuery({
    queryKey: ['stock-value-retail', businessId],
    queryFn: async (): Promise<number> => {
      const rows = await requireData(
        await supabase
          .from('products')
          .select('current_stock, selling_price')
          .eq('business_id', businessId!)
      );
      return sumBy(rows as { current_stock: number; selling_price: number }[], (r) =>
        Number(r.current_stock) * Number(r.selling_price)
      );
    },
    enabled: !!businessId,
  });
}

export function useCashflowSeries(businessId: string | undefined, days = 30) {
  return useQuery({
    queryKey: ['cashflow-series', businessId, days],
    queryFn: async (): Promise<CashflowPoint[]> => {
      const rows = (await requireData(
        await supabase
          .from('payments')
          .select('date, type, amount')
          .eq('business_id', businessId!)
          .gte('date', isoDaysAgo(days - 1))
      )) as { date: string; type: 'received' | 'made'; amount: number }[];
      const byDay = new Map<string, { received: number; made: number }>();
      rows.forEach((p) => {
        const entry = byDay.get(p.date) || { received: 0, made: 0 };
        if (p.type === 'received') entry.received += Number(p.amount);
        else entry.made += Number(p.amount);
        byDay.set(p.date, entry);
      });
      return dayBuckets(days).map((date) => {
        const entry = byDay.get(date) || { received: 0, made: 0 };
        const received = roundTo2(entry.received);
        const made = roundTo2(entry.made);
        return { date, received, made, net: roundTo2(received - made) };
      });
    },
    enabled: !!businessId,
  });
}

export function useSalesPurchasesSeries(businessId: string | undefined, days = 14) {
  return useQuery({
    queryKey: ['sales-purchases-series', businessId, days],
    queryFn: async (): Promise<SalesPurchasesPoint[]> => {
      const [invoices, bills] = await Promise.all([
        requireData(
          await supabase
            .from('sales_invoices')
            .select('grand_total, invoice_date')
            .eq('business_id', businessId!)
            .in('status', BOOKED_INVOICE_STATUSES)
            .gte('invoice_date', isoDaysAgo(days - 1))
        ),
        requireData(
          await supabase
            .from('purchase_bills')
            .select('grand_total, bill_date')
            .eq('business_id', businessId!)
            .in('status', BOOKED_BILL_STATUSES)
            .gte('bill_date', isoDaysAgo(days - 1))
        ),
      ]);
      const salesByDay = new Map<string, number>();
      (invoices as { grand_total: number; invoice_date: string }[]).forEach((r) => {
        salesByDay.set(r.invoice_date, (salesByDay.get(r.invoice_date) || 0) + Number(r.grand_total));
      });
      const purchasesByDay = new Map<string, number>();
      (bills as { grand_total: number; bill_date: string }[]).forEach((r) => {
        purchasesByDay.set(r.bill_date, (purchasesByDay.get(r.bill_date) || 0) + Number(r.grand_total));
      });
      return dayBuckets(days).map((date) => ({
        date,
        sales: roundTo2(salesByDay.get(date) || 0),
        purchases: roundTo2(purchasesByDay.get(date) || 0),
      }));
    },
    enabled: !!businessId,
  });
}

export function useDashboardData(businessId: string | undefined): DashboardResult {
  const receivables = useReceivables(businessId);
  const payables = usePayables(businessId);
  const liquidCash = useLiquidCash(businessId);
  const stockValue = useStockValueRetail(businessId);
  const cashflowSeries = useCashflowSeries(businessId);
  const salesPurchasesSeries = useSalesPurchasesSeries(businessId);

  const queries = [receivables, payables, liquidCash, stockValue, cashflowSeries, salesPurchasesSeries];

  return {
    data: {
      receivables: receivables.data ?? null,
      payables: payables.data ?? null,
      liquidCash: liquidCash.data ?? null,
      stockValue: stockValue.data ?? null,
      cashflowSeries: cashflowSeries.data ?? null,
      salesPurchasesSeries: salesPurchasesSeries.data ?? null,
    },
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
    refetchAll: () => queries.forEach((q) => void q.refetch()),
  };
}
