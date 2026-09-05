import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, CheckCircle2 } from 'lucide-react';
import { AtlasTeamCarousel, type AtlasItem } from '@/components/landing/AtlasTeamCarousel';
import { ContactDock } from '@/components/common/ContactDock';

type AuthLayoutProps = {
  headline: ReactNode;
  description: string;
  features?: string[];
  /** When provided, renders the Atlas 3D showcase instead of the static checklist. */
  featureShowcase?: AtlasItem[];
  children: ReactNode;
};

export function AuthLayout({ headline, description, features = [], featureShowcase, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="relative hidden lg:flex lg:w-[46%] xl:w-1/2 overflow-hidden bg-gradient-to-br from-primary-700 via-primary-800 to-primary-950">
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '26px 26px' }} aria-hidden="true" />
        <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-accent-400/20 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-violet-500/20 blur-3xl" aria-hidden="true" />

        <div className="relative z-10 flex flex-col justify-between gap-8 p-12 xl:p-16 w-full overflow-y-auto">
          <Link to="/login" className="flex items-center gap-3 w-fit group">
            <div className="rounded-xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20 p-2.5 transition-transform duration-200 group-hover:scale-105">
              <Calculator className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">AccountX</span>
          </Link>

          <div className="max-w-lg">
            <h1 className="text-4xl xl:text-[2.75rem] font-bold leading-[1.15] tracking-tight text-white">{headline}</h1>
            <p className="mt-4 text-base text-primary-100/90 leading-relaxed">{description}</p>
          </div>

          {featureShowcase && featureShowcase.length > 0 ? (
            <AtlasTeamCarousel items={featureShowcase} compact ariaLabel="AccountX highlights" />
          ) : (
            <ul className="space-y-2.5">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-primary-100/90">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-300/70">Talk to us</p>
            <ContactDock />
            <p className="mt-4 text-xs text-primary-300/60">GST-ready invoicing · Double-entry engine · Tally-compatible export</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 sm:px-8 bg-secondary-50 dark:bg-secondary-950">
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 p-2 shadow-glow-cash">
            <Calculator className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">AccountX</span>
        </div>
        <div className="w-full max-w-md card-solid rounded-2xl p-6 sm:p-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {children}
        </div>
      </div>
    </div>
  );
}
