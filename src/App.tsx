import { SuperAdminPage } from '@/pages/SuperAdminPage';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SuperAdminRoute } from '@/components/auth/SuperAdminRoute';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const BusinessSetupPage = lazy(() => import('@/pages/auth/BusinessSetupPage').then((m) => ({ default: m.BusinessSetupPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const CustomersPage = lazy(() => import('@/pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const SuppliersPage = lazy(() => import('@/pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })));
const ProductsPage = lazy(() => import('@/pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const SalesInvoicesPage = lazy(() => import('@/pages/SalesInvoicesPage').then((m) => ({ default: m.SalesInvoicesPage })));
const SalesInvoiceViewPage = lazy(() => import('@/pages/SalesInvoiceViewPage').then((m) => ({ default: m.SalesInvoiceViewPage })));
const SalesInvoiceCreatePage = lazy(() => import('@/pages/SalesInvoiceCreatePage').then((m) => ({ default: m.SalesInvoiceCreatePage })));
const PurchaseBillsPage = lazy(() => import('@/pages/PurchaseBillsPage').then((m) => ({ default: m.PurchaseBillsPage })));
const PurchaseBillCreatePage = lazy(() => import('@/pages/PurchaseBillCreatePage').then((m) => ({ default: m.PurchaseBillCreatePage })));
const CustomerCreatePage = lazy(() => import('@/pages/CustomerCreatePage').then((m) => ({ default: m.CustomerCreatePage })));
const SupplierCreatePage = lazy(() => import('@/pages/SupplierCreatePage').then((m) => ({ default: m.SupplierCreatePage })));
const ProductCreatePage = lazy(() => import('@/pages/ProductCreatePage').then((m) => ({ default: m.ProductCreatePage })));
const ExpenseCreatePage = lazy(() => import('@/pages/ExpenseCreatePage').then((m) => ({ default: m.ExpenseCreatePage })));
const PaymentReceiveCreatePage = lazy(() => import('@/pages/PaymentReceiveCreatePage').then((m) => ({ default: m.PaymentReceiveCreatePage })));
const PaymentMakeCreatePage = lazy(() => import('@/pages/PaymentMakeCreatePage').then((m) => ({ default: m.PaymentMakeCreatePage })));
const QuotationCreatePage = lazy(() => import('@/pages/QuotationCreatePage').then((m) => ({ default: m.QuotationCreatePage })));
const SalesOrderCreatePage = lazy(() => import('@/pages/SalesOrderCreatePage').then((m) => ({ default: m.SalesOrderCreatePage })));
const PurchaseOrderCreatePage = lazy(() => import('@/pages/PurchaseOrderCreatePage').then((m) => ({ default: m.PurchaseOrderCreatePage })));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const CreditNoteCreatePage = lazy(() => import('@/pages/CreditNoteCreatePage').then((m) => ({ default: m.CreditNoteCreatePage })));
const DebitNoteCreatePage = lazy(() => import('@/pages/DebitNoteCreatePage').then((m) => ({ default: m.DebitNoteCreatePage })));
const JournalEntryCreatePage = lazy(() => import('@/pages/JournalEntryCreatePage').then((m) => ({ default: m.JournalEntryCreatePage })));
const PaymentsReceivedPage = lazy(() => import('@/pages/PaymentsReceivedPage').then((m) => ({ default: m.PaymentsReceivedPage })));
const CreditNotesPage = lazy(() => import('@/pages/CreditNotesPage').then((m) => ({ default: m.CreditNotesPage })));
const DebitNotesPage = lazy(() => import('@/pages/DebitNotesPage').then((m) => ({ default: m.DebitNotesPage })));
const QuotationsPage = lazy(() => import('@/pages/QuotationsPage').then((m) => ({ default: m.QuotationsPage })));
const SalesOrdersPage = lazy(() => import('@/pages/SalesOrdersPage').then((m) => ({ default: m.SalesOrdersPage })));
const PurchaseOrdersPage = lazy(() => import('@/pages/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })));
const PaymentsMadePage = lazy(() => import('@/pages/PaymentsMadePage').then((m) => ({ default: m.PaymentsMadePage })));
const ExpensesPage = lazy(() => import('@/pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const StockPage = lazy(() => import('@/pages/StockPage').then((m) => ({ default: m.StockPage })));
const StockAdjustmentPage = lazy(() => import('@/pages/StockAdjustmentPage').then((m) => ({ default: m.StockAdjustmentPage })));
const LedgerPage = lazy(() => import('@/pages/LedgerPage').then((m) => ({ default: m.LedgerPage })));
const ChartOfAccountsPage = lazy(() => import('@/pages/ChartOfAccountsPage').then((m) => ({ default: m.ChartOfAccountsPage })));
const JournalEntriesPage = lazy(() => import('@/pages/JournalEntriesPage').then((m) => ({ default: m.JournalEntriesPage })));
const TrialBalancePage = lazy(() => import('@/pages/TrialBalancePage').then((m) => ({ default: m.TrialBalancePage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ReportDetailPage = lazy(() => import('@/pages/ReportDetailPage').then((m) => ({ default: m.ReportDetailPage })));
const ReceivablesPage = lazy(() => import('@/pages/ReceivablesPage').then((m) => ({ default: m.ReceivablesPage })));
const PayablesPage = lazy(() => import('@/pages/PayablesPage').then((m) => ({ default: m.PayablesPage })));
const CashBankPage = lazy(() => import('@/pages/CashBankPage').then((m) => ({ default: m.CashBankPage })));
const StockTransferPage = lazy(() => import('@/pages/StockTransferPage').then((m) => ({ default: m.StockTransferPage })));
const StockTransferCreatePage = lazy(() => import('@/pages/StockTransferCreatePage').then((m) => ({ default: m.StockTransferCreatePage })));
const WarehousesPage = lazy(() => import('@/pages/WarehousesPage').then((m) => ({ default: m.WarehousesPage })));
const AdminHubPage = lazy(() => import('@/pages/AdminHubPage').then((m) => ({ default: m.AdminHubPage })));
const AiAssistantPage = lazy(() => import('@/pages/AiAssistantPage').then((m) => ({ default: m.AiAssistantPage })));
const GstHubPage = lazy(() => import('@/pages/gst/GstHubPage').then((m) => ({ default: m.GstHubPage })));
const Gstr1Page = lazy(() => import('@/pages/gst/Gstr1Page').then((m) => ({ default: m.Gstr1Page })));
const Gstr3bPage = lazy(() => import('@/pages/gst/Gstr3bPage').then((m) => ({ default: m.Gstr3bPage })));
const GstValidationPage = lazy(() => import('@/pages/gst/GstValidationPage').then((m) => ({ default: m.GstValidationPage })));
const GstReconciliationPage = lazy(() => import('@/pages/gst/GstReconciliationPage').then((m) => ({ default: m.GstReconciliationPage })));
const TallyWizardPage = lazy(() => import('@/pages/tally/TallyWizardPage').then((m) => ({ default: m.TallyWizardPage })));
const TallyMappingPage = lazy(() => import('@/pages/tally/TallyMappingPage').then((m) => ({ default: m.TallyMappingPage })));
const TallyHistoryPage = lazy(() => import('@/pages/tally/TallyHistoryPage').then((m) => ({ default: m.TallyHistoryPage })));
const CommunicationsPage = lazy(() => import('@/pages/CommunicationsPage').then((m) => ({ default: m.CommunicationsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-950">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-primary-600 animate-bounce" />
        <p className="text-secondary-400 text-sm">Loading AccountX...</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, businesses } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-950">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary-600 animate-bounce" />
          <p className="text-secondary-400 text-sm">Loading AccountX...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (businesses.length === 0 && location.pathname !== '/setup-business' && !location.pathname.startsWith('/super-admin')) {
    return <Navigate to="/setup-business" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/setup-business" element={<ProtectedRoute><BusinessSetupPage /></ProtectedRoute>} />
      <Route path="/super-admin" element={<SuperAdminRoute><SuperAdminPage /></SuperAdminRoute>} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerCreatePage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="suppliers/new" element={<SupplierCreatePage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductCreatePage />} />
        <Route path="sales-invoices" element={<SalesInvoicesPage />} />
        <Route path="sales-invoices/new" element={<SalesInvoiceCreatePage />} />
        <Route path="sales-invoices/:id" element={<SalesInvoiceViewPage />} />
        <Route path="purchase-bills" element={<PurchaseBillsPage />} />
        <Route path="purchase-bills/new" element={<PurchaseBillCreatePage />} />
        <Route path="payments-received" element={<PaymentsReceivedPage />} />
        <Route path="credit-notes" element={<CreditNotesPage />} />
        <Route path="credit-notes/new" element={<CreditNoteCreatePage />} />
        <Route path="debit-notes" element={<DebitNotesPage />} />
        <Route path="debit-notes/new" element={<DebitNoteCreatePage />} />
        <Route path="journal-entries/new" element={<JournalEntryCreatePage />} />
        <Route path="payments-received/new" element={<PaymentReceiveCreatePage />} />
        <Route path="payments-made" element={<PaymentsMadePage />} />
        <Route path="payments-made/new" element={<PaymentMakeCreatePage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="expenses/new" element={<ExpenseCreatePage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="stock-adjustment" element={<StockAdjustmentPage />} />
        <Route path="stock-adjustment/new" element={<StockAdjustmentPage />} />
        <Route path="ledger" element={<LedgerPage />} />
        <Route path="chart-of-accounts" element={<ChartOfAccountsPage />} />
        <Route path="journal-entries" element={<JournalEntriesPage />} />
        <Route path="trial-balance" element={<TrialBalancePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:reportId" element={<ReportDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminHubPage />} />
            <Route path="communications" element={<CommunicationsPage />} />
        <Route path="ai" element={<AiAssistantPage />} />
        <Route path="gst" element={<GstHubPage />} />
        <Route path="gst/gstr-1" element={<Gstr1Page />} />
        <Route path="gst/gstr-3b" element={<Gstr3bPage />} />
        <Route path="gst/validation" element={<GstValidationPage />} />
        <Route path="gst/reconciliation" element={<GstReconciliationPage />} />
        <Route path="tally" element={<TallyWizardPage />} />
        <Route path="tally/mapping" element={<TallyMappingPage />} />
        <Route path="tally/history" element={<TallyHistoryPage />} />
        <Route path="quotations" element={<QuotationsPage />} />
        <Route path="quotations/new" element={<QuotationCreatePage />} />
        <Route path="sales-orders" element={<SalesOrdersPage />} />
        <Route path="sales-orders/new" element={<SalesOrderCreatePage />} />
        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="purchase-orders/new" element={<PurchaseOrderCreatePage />} />
<Route path="warehouses" element={<WarehousesPage />} />
            <Route path="stock-transfer" element={<StockTransferPage />} />
            <Route path="stock-transfer/new" element={<StockTransferCreatePage />} />
            <Route path="receivables" element={<ReceivablesPage />} />
            <Route path="payables" element={<PayablesPage />} />
            <Route path="cash-bank" element={<CashBankPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <BrowserRouter>
                <Suspense fallback={<RouteFallback />}>
                  <AppRoutes />
                </Suspense>
              </BrowserRouter>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}











