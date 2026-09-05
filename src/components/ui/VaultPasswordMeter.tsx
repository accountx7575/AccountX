import React, { useMemo } from 'react';
import { ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react';

interface VaultProps {
  entropyScore: number; // 0 to 4
}

export function VaultPasswordMeter({ entropyScore }: VaultProps) {
  const tier = useMemo(() => {
    switch (entropyScore) {
      case 1:
        return { name: 'A bent paperclip', time: 'Cracked instantly', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/40', icon: '📎', bits: '14 bits' };
      case 2:
        return { name: 'A padlock', time: 'Cracked in 4 hours', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', icon: '🔒', bits: '36 bits' };
      case 3:
        return { name: 'A deadbolt lock', time: 'Cracked in 3 years', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40', icon: '🗝️', bits: '58 bits' };
      case 4:
        return { name: 'Bank vault security', time: 'Cracked in 12,000 years', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', icon: '🏦', bits: '84 bits' };
      default:
        return { name: 'No lock at all', time: 'The door is wide open', color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-zinc-800', icon: '🚪', bits: '0 bits' };
    }
  }, [entropyScore]);

  return (
    <div className={`mt-3 p-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 transition-all duration-300 ${tier.bg}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white dark:bg-zinc-900 shadow-sm flex items-center justify-center text-xl shrink-0 border border-slate-200/60 dark:border-zinc-700">
          {tier.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className={`text-xs font-bold uppercase tracking-wider ${tier.color}`}>
              {tier.name}
            </h4>
            <span className="text-[10px] font-mono text-slate-400 font-semibold">{tier.bits}</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5 truncate">
            {tier.time}
          </p>
        </div>
      </div>

      {/* Progress Bars */}
      <div className="grid grid-cols-4 gap-1.5 mt-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i <= entropyScore
                ? entropyScore === 4
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                  : entropyScore === 3
                  ? 'bg-blue-500'
                  : entropyScore === 2
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
                : 'bg-slate-200 dark:bg-zinc-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
