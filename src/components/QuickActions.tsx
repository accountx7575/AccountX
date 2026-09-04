import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import {
  FileText, ShoppingCart, User, Truck, Package, Banknote,
  CreditCard, Receipt, ArrowLeftRight, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type QuickActionsProps = {
  open: boolean;
  onClose: () => void;
};

const actions = [
  { label: 'Sale Invoice', icon: FileText, to: '/app/sales-invoices/new', color: 'text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400' },
  { label: 'Purchase Bill', icon: ShoppingCart, to: '/app/purchase-bills/new', color: 'text-secondary-600 bg-secondary-100 dark:bg-secondary-800 dark:text-secondary-300' },
  { label: 'Customer', icon: User, to: '/app/customers/new', color: 'text-success-600 bg-success-50 dark:bg-success-900/30 dark:text-success-400' },
  { label: 'Supplier', icon: Truck, to: '/app/suppliers/new', color: 'text-warning-600 bg-warning-50 dark:bg-warning-900/30 dark:text-warning-400' },
  { label: 'Product', icon: Package, to: '/app/products/new', color: 'text-accent-600 bg-accent-50 dark:bg-accent-900/30 dark:text-accent-400' },
  { label: 'Receive Payment', icon: Banknote, to: '/app/payments-received/new', color: 'text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400' },
  { label: 'Make Payment', icon: CreditCard, to: '/app/payments-made/new', color: 'text-error-600 bg-error-50 dark:bg-error-900/30 dark:text-error-400' },
  { label: 'Expense', icon: Receipt, to: '/app/expenses/new', color: 'text-secondary-600 bg-secondary-100 dark:bg-secondary-800 dark:text-secondary-300' },
  { label: 'Stock Adjustment', icon: ArrowLeftRight, to: '/app/stock-adjustment/new', color: 'text-primary-600 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-400' },
];

export function QuickActions({ open, onClose }: QuickActionsProps) {
  const navigate = useNavigate();

  return (
    <Modal open={open} onClose={onClose} title="Quick Actions" size="lg">
      <div className="mb-4 flex items-center gap-2 text-sm text-secondary-500">
        <Zap className="h-4 w-4 text-accent-500" />
        <span>Choose an action to get started quickly</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={() => {
              navigate(action.to);
              onClose();
            }}
            className="flex flex-col items-center gap-3 p-4 rounded-xl border border-secondary-200 dark:border-secondary-700 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-card-hover transition-all group"
          >
            <div className={cn('rounded-xl p-3 group-hover:scale-110 transition-transform', action.color)}>
              <action.icon className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium text-secondary-700 dark:text-secondary-200 text-center">{action.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
