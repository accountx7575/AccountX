import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ArrowLeft, RotateCcw, Infinity as InfinityIcon, Users, Star, Check, Power } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  billsLimitLabel,
  DEFAULT_PLANS_CONFIG,
  getPlansConfig,
  resetPlansConfig,
  savePlansConfig,
  setDefaultTier,
  updateTier,
  type PlansConfigState,
  type TierConfig,
  type TierId,
} from '@/lib/plansConfig';

const tierColor: Record<TierId, string> = {
  'early-adopter-beta': 'from-indigo-500 to-violet-600',
  'starter': 'from-emerald-500 to-teal-600',
  'pro-business': 'from-amber-500 to-orange-600',
};

function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '' || t === '∞' || t.toLowerCase() === 'unlimited') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function PlansPage() {
  const [config, setConfig] = useState<PlansConfigState>(() => getPlansConfig());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => setConfig(getPlansConfig());
    window.addEventListener('ax-plans-config-changed', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('ax-plans-config-changed', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const patchTier = (id: TierId, patch: Partial<TierConfig>) => {
    setConfig(updateTier(id, patch));
    setSaved(true);
  };

  const makeDefault = (id: TierId) => {
    setConfig(setDefaultTier(id));
    setSaved(true);
  };

  const resetAll = () => {
    resetPlansConfig();
    setConfig(getPlansConfig());
    setSaved(false);
  };

  return (
    <div>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-6 border-b border-secondary-200 dark:border-secondary-800">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary-100 dark:bg-primary-950/50 rounded-lg text-primary-600 dark:text-primary-400">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-page-title sm:text-2xl">Plans &amp; Tier Configuration</h1>
              <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">
                Config-object driven tiers — switching the default tier later is data-only, no code change.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={resetAll} className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4" /> Reset to defaults
            </Button>
            <Link to="/super-admin" className="inline-flex">
              <Button variant="secondary" size="sm" className="flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Control Center
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {config.tiers.map((tier) => {
            const isDefault = config.defaultTier === tier.id;
            return (
              <div key={tier.id} className={`card-solid p-5 space-y-4 ${isDefault ? 'ring-2 ring-indigo-500/40' : ''}`}>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className={`p-2 rounded-lg bg-gradient-to-br text-white ${tierColor[tier.id]}`}>
                      {tier.id === 'pro-business' ? <Star className="w-4 h-4" /> : tier.id === 'starter' ? <Users className="w-4 h-4" /> : <InfinityIcon className="w-4 h-4" />}
                    </div>
                    {isDefault && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900">
                        <Check className="w-3 h-3" /> Current default
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-secondary-900 dark:text-white mt-3">{tier.label}</h3>
                  <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">{tier.tagline}</p>
                </div>

                <div className="rounded-xl bg-secondary-50 dark:bg-secondary-800/60 border border-secondary-200 dark:border-secondary-700 px-3 py-2.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-secondary-500 dark:text-secondary-400">Bills / month</span>
                  <span className="text-sm font-semibold text-secondary-900 dark:text-white">{billsLimitLabel(tier)}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-secondary-500 dark:text-secondary-400">Bill cap (blank = unlimited)</label>
                    <input
                      type="number"
                      min={0}
                      className="input text-sm mt-1"
                      value={tier.monthlyBillsLimit ?? ''}
                      onChange={(e) => patchTier(tier.id, { monthlyBillsLimit: numOrNull(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-secondary-500 dark:text-secondary-400">Price / mo (blank = free)</label>
                    <input
                      type="number"
                      min={0}
                      className="input text-sm mt-1"
                      value={tier.priceMonthly ?? ''}
                      onChange={(e) => patchTier(tier.id, { priceMonthly: numOrNull(e.target.value) })}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-secondary-500 dark:text-secondary-400">Users included (blank = unlimited)</label>
                  <input
                    type="number"
                    min={1}
                    className="input text-sm mt-1"
                    value={tier.usersIncluded ?? ''}
                    onChange={(e) => patchTier(tier.id, { usersIncluded: numOrNull(e.target.value) })}
                  />
                </div>

                <div className="space-y-2">
                  {([
                    ['multiUser', 'Multi-user seats'],
                    ['prioritySupport', 'Priority support'],
                    ['acceptingSignups', 'Accepting signups'],
                  ] as const).map(([flag, label]) => (
                    <button
                      key={flag}
                      type="button"
                      aria-pressed={tier[flag]}
                      onClick={() => patchTier(tier.id, { [flag]: !tier[flag] })}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        tier[flag]
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900'
                          : 'bg-secondary-50 text-secondary-500 border-secondary-200 dark:bg-secondary-800/60 dark:text-secondary-400 dark:border-secondary-700'
                      }`}
                    >
                      {label}
                      <Power className={`w-3.5 h-3.5 ${tier[flag] ? 'text-emerald-500' : 'text-secondary-400'}`} />
                    </button>
                  ))}
                </div>

                {!isDefault && (
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => makeDefault(tier.id)}>
                    Make default tier
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="card-solid p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className={`inline-flex items-center gap-2 text-xs font-medium ${saved ? 'text-emerald-600 dark:text-emerald-400' : 'text-secondary-400'}`}>
            <Power className="w-3.5 h-3.5" />
            {saved ? 'Config saved to shim storage (ax-plans-config-v1).' : 'Editing persists instantly to the config shim.'}
          </span>
          <span className="text-xs text-secondary-400 sm:ml-auto">
            Defaults: {DEFAULT_PLANS_CONFIG.tiers.map((t) => t.label).join(' · ')} — humanQA: limit enforcement + payments wiring deferred to the billing turn.
          </span>
        </div>
      </div>
    </div>
  );
}
