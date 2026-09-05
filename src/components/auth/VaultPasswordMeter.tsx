import { useEffect, useMemo, useRef } from 'react';
import { DoorClosed, Lock, LockKeyhole, Vault } from 'lucide-react';
import { analyzePassword, type VaultTier } from '@/lib/passwordEntropy';
import { signalTierUp } from '@/lib/audioHaptic';
import { cn } from '@/lib/utils';

interface TierMeta {
  name: string;
  crackTime: string;
  text: string;
  bg: string;
  bar: string;
}

const TIERS: Record<VaultTier, TierMeta> = {
  0: {
    name: 'No lock at all',
    crackTime: 'The door is wide open',
    text: 'text-slate-400',
    bg: 'bg-slate-100 dark:bg-zinc-800',
    bar: 'bg-slate-300 dark:bg-zinc-700',
  },
  1: {
    name: 'A bent paperclip',
    crackTime: 'Cracked instantly',
    text: 'text-rose-500',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    bar: 'bg-rose-500',
  },
  2: {
    name: 'A padlock',
    crackTime: 'Cracked in seconds',
    text: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    bar: 'bg-amber-500',
  },
  3: {
    name: 'A deadbolt',
    crackTime: 'Cracked in years',
    text: 'text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    bar: 'bg-blue-500',
  },
  4: {
    name: 'A bank vault',
    crackTime: 'Cracked in millennia',
    text: 'text-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    bar: 'bg-emerald-500 shadow-sm shadow-emerald-500/50',
  },
};

function TierIcon({ tier }: { tier: VaultTier }) {
  const cls = 'h-5 w-5';
  switch (tier) {
    case 1:
      return <Lock className={cn(cls, 'text-rose-500')} aria-hidden="true" />;
    case 2:
      return <LockKeyhole className={cn(cls, 'text-amber-500')} aria-hidden="true" />;
    case 3:
      return <DoorClosed className={cn(cls, 'text-blue-500')} aria-hidden="true" />;
    case 4:
      return (
        <Vault
          className={cn(cls, 'text-emerald-500 vault-dial-settle')}
          aria-hidden="true"
        />
      );
    default:
      return <Lock className={cn(cls, 'text-slate-400')} aria-hidden="true" />;
  }
}

interface VaultPasswordMeterProps {
  password: string;
  enableFeedback?: boolean;
}

export function VaultPasswordMeter({ password, enableFeedback = true }: VaultPasswordMeterProps) {
  const report = useMemo(() => analyzePassword(password), [password]);
  const meta = TIERS[report.tier];
  const prevTier = useRef<VaultTier>(report.tier);

  useEffect(() => {
    if (!enableFeedback) {
      prevTier.current = report.tier;
      return;
    }
    if (report.tier > prevTier.current) signalTierUp(report.tier);
    prevTier.current = report.tier;
  }, [report.tier, enableFeedback]);

  const bitsLabel = `${Math.floor(report.bits)} bits`;

  return (
    <div
      className={cn(
        'mt-3 p-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 transition-all duration-300',
        meta.bg
      )}
      role="status"
      aria-live="polite"
      aria-label={`Password strength: ${meta.name}, ${bitsLabel}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center shrink-0 border border-slate-200/60 dark:border-zinc-700">
          <TierIcon tier={report.tier} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={cn('text-xs font-bold uppercase tracking-wider', meta.text)}>
              {meta.name}
            </h4>
            <span className="text-[10px] font-mono text-slate-400 font-semibold shrink-0">
              {bitsLabel}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5 truncate">
            {meta.crackTime}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 mt-2.5" aria-hidden="true">
        {([1, 2, 3, 4] as const).map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              i <= report.tier ? meta.bar : 'bg-slate-200 dark:bg-zinc-700'
            )}
          />
        ))}
      </div>
    </div>
  );
}
