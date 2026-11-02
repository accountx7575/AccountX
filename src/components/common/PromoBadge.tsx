import { Sparkles } from 'lucide-react';
import { EARLY_ADOPTER_PROMO_TEXT } from '@/lib/plansConfig';

export function PromoBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`hidden xl:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm whitespace-nowrap ${className}`}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" />
      {EARLY_ADOPTER_PROMO_TEXT}
    </span>
  );
}
