import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';

/**
 * InteractiveLogin — "Den" husky login companion.
 *
 * - Pupil tracking: a single rAF-smoothed pointer listener translates the
 *   pupil layer toward the cursor (transform-only, no re-renders → 60fps).
 * - Password state (`shy`): paws slide over the eyes and the gaze lowers.
 * - Submit state (`celebrating`): party hat pops in, Den bounces, CSS
 *   confetti bursts — wire to successful Supabase auth.
 *
 * All motion is transform/opacity-only and disabled under
 * `prefers-reduced-motion`.
 */

export type InteractiveLoginProps = {
  /** True while the password field is focused (and masked). */
  shy?: boolean;
  /** True briefly after successful auth, before navigation. */
  celebrating?: boolean;
  className?: string;
};

const MAX_GAZE = 7; // px of pupil travel

function useGaze(
  stageRef: RefObject<HTMLDivElement>,
  pupilsRef: RefObject<HTMLDivElement>,
  max: number = MAX_GAZE,
) {
  useEffect(() => {
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;

    const apply = () => {
      raf = 0;
      cx += (tx - cx) * 0.22;
      cy += (ty - cy) * 0.22;
      pupilsRef.current?.style.setProperty(
        'transform',
        `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`,
      );
      if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) {
        raf = requestAnimationFrame(apply);
      }
    };

    const onMove = (e: PointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const mag = Math.min(max, dist / 18);
      tx = (dx / dist) * mag;
      ty = (dy / dist) * mag;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [stageRef, pupilsRef, max]);
}

type ConfettiPiece = {
  left: string;
  dx: string;
  delay: string;
  color: string;
  round: boolean;
};

const CONFETTI_COLORS = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#38bdf8'];

export function InteractiveLogin({ shy = false, celebrating = false, className = '' }: InteractiveLoginProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pupilsRef = useRef<HTMLDivElement>(null);
  useGaze(stageRef, pupilsRef);

  const confetti = useMemo<ConfettiPiece[]>(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: `${8 + ((i * 67) % 84)}%`,
        dx: `${((i * 37) % 120) - 60}px`,
        delay: `${(i % 5) * 0.06}s`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    [],
  );

  const stateLabel = celebrating
    ? 'AccountX husky celebrating a successful sign in'
    : shy
      ? 'AccountX husky covering its eyes while you type your password'
      : 'AccountX husky watching your cursor';

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <style>{`
        .den-stage { will-change: transform; }
        .den-head-group { transform-origin: 50% 78%; }
        .den-eye { transform-origin: 50% 50%; animation: den-blink 4.8s infinite; }
        @keyframes den-blink {
          0%, 93.5%, 100% { transform: scaleY(1); }
          95.5% { transform: scaleY(0.08); }
        }
        .den-paw { transition: transform 0.38s cubic-bezier(0.34, 1.4, 0.64, 1); will-change: transform; }
        .den-paw-left { transform: translate(-34px, 52px) rotate(-24deg); }
        .den-paw-right { transform: translate(34px, 52px) rotate(24deg); }
        .den-shy .den-paw-left { transform: translate(6px, -2px) rotate(-6deg); }
        .den-shy .den-paw-right { transform: translate(-6px, -2px) rotate(6deg); }
        .den-shy .den-pupil-dot { transform: translateY(3px); }
        .den-pupil-dot { transition: transform 0.3s ease; will-change: transform; }
        .den-hat { opacity: 0; transform: translateY(8px) rotate(-14deg) scale(0.6); transform-origin: 50% 100%; transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .den-celebrating .den-hat { opacity: 1; transform: translateY(0) rotate(-8deg) scale(1); }
        .den-celebrating .den-head-group { animation: den-bounce 0.72s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes den-bounce {
          0% { transform: translateY(0) scale(1, 1); }
          30% { transform: translateY(-16px) scale(0.96, 1.05); }
          55% { transform: translateY(0) scale(1.04, 0.94); }
          75% { transform: translateY(-7px) scale(0.99, 1.02); }
          100% { transform: translateY(0) scale(1, 1); }
        }
        .den-confetti-piece { opacity: 0; }
        .den-celebrating .den-confetti-piece { animation: den-confetti 1.15s ease-out forwards; animation-delay: var(--den-delay, 0s); }
        @keyframes den-confetti {
          0% { opacity: 1; transform: translate(0, -6px) rotate(0deg) scale(1); }
          100% { opacity: 0; transform: translate(var(--den-dx, 0px), 74px) rotate(340deg) scale(0.7); }
        }
        @media (prefers-reduced-motion: reduce) {
          .den-eye, .den-celebrating .den-head-group, .den-celebrating .den-confetti-piece { animation: none !important; }
          .den-paw, .den-hat, .den-pupil-dot { transition: none !important; }
          .den-celebrating .den-hat { opacity: 1; transform: translateY(0) rotate(-8deg) scale(1); }
        }
      `}</style>

      <div
        ref={stageRef}
        role="img"
        aria-label={stateLabel}
        className={`den-stage relative h-44 w-48 select-none ${shy ? 'den-shy' : ''} ${
          celebrating ? 'den-celebrating' : ''
        }`}
      >
        {/* Confetti layer */}
        <div className="pointer-events-none absolute inset-x-2 top-0 h-24 overflow-visible" aria-hidden="true">
          {confetti.map((c, i) => (
            <span
              key={i}
              className={`den-confetti-piece absolute top-0 h-2 w-1.5 ${c.round ? 'rounded-full' : 'rounded-[1px]'}`}
              style={{ left: c.left, backgroundColor: c.color, ['--den-dx' as string]: c.dx, ['--den-delay' as string]: c.delay } as CSSProperties}
            />
          ))}
        </div>

        <div className="den-head-group absolute inset-x-0 bottom-0 top-6">
          {/* Party hat */}
          <div className="den-hat absolute left-1/2 top-0 z-20 -ml-5" aria-hidden="true">
            <div className="h-0 w-0 border-x-[20px] border-b-[34px] border-x-transparent border-b-violet-500" />
            <div className="mx-auto -mt-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-amber-200" />
          </div>

          {/* Ears */}
          <div className="absolute left-5 top-6 h-12 w-10 rounded-t-full rounded-b-lg bg-zinc-700 dark:bg-zinc-600 [transform:rotate(-16deg)]" aria-hidden="true" />
          <div className="absolute right-5 top-6 h-12 w-10 rounded-t-full rounded-b-lg bg-zinc-700 dark:bg-zinc-600 [transform:rotate(16deg)]" aria-hidden="true" />
          <div className="absolute left-8 top-9 h-6 w-4 rounded-t-full bg-zinc-500/60 [transform:rotate(-16deg)]" aria-hidden="true" />
          <div className="absolute right-8 top-9 h-6 w-4 rounded-t-full bg-zinc-500/60 [transform:rotate(16deg)]" aria-hidden="true" />

          {/* Head */}
          <div className="absolute inset-x-4 top-10 bottom-0 rounded-[44%_44%_46%_46%/58%_58%_42%_42%] bg-gradient-to-b from-zinc-100 to-zinc-300 dark:from-zinc-600 dark:to-zinc-700 ring-1 ring-zinc-300/60 dark:ring-zinc-500/40" aria-hidden="true" />

          {/* Eye patches */}
          <div className="absolute left-9 top-[64px] h-9 w-9 rounded-full bg-zinc-400/40 dark:bg-zinc-800/50" aria-hidden="true" />
          <div className="absolute right-9 top-[64px] h-9 w-9 rounded-full bg-zinc-400/40 dark:bg-zinc-800/50" aria-hidden="true" />

          {/* Eyes */}
          <div className="den-eye absolute left-[52px] top-[70px] h-[30px] w-[30px] rounded-full bg-white ring-1 ring-zinc-300/70" aria-hidden="true" />
          <div className="den-eye absolute right-[52px] top-[70px] h-[30px] w-[30px] rounded-full bg-white ring-1 ring-zinc-300/70" aria-hidden="true" />

          {/* Gaze layer: lives in head-group space so pupils align with eye
              centers (67/125px x, 85px y); translated toward the pointer via ref */}
          <div ref={pupilsRef} className="absolute inset-0 z-10 will-change-transform" aria-hidden="true">
            <div className="den-pupil-dot absolute left-[59px] top-[77px] h-[16px] w-[16px] rounded-full bg-zinc-900">
              <span className="absolute left-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-white" />
            </div>
            <div className="den-pupil-dot absolute right-[59px] top-[77px] h-[16px] w-[16px] rounded-full bg-zinc-900">
              <span className="absolute left-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-white" />
            </div>
          </div>

          {/* Blush */}
          <div className="absolute left-[38px] top-[104px] h-3 w-5 rounded-full bg-rose-300/70 blur-[1px]" aria-hidden="true" />
          <div className="absolute right-[38px] top-[104px] h-3 w-5 rounded-full bg-rose-300/70 blur-[1px]" aria-hidden="true" />

          {/* Muzzle */}
          <div className="absolute left-1/2 top-[98px] h-12 w-20 -translate-x-1/2 rounded-[50%] bg-white dark:bg-zinc-100 ring-1 ring-zinc-200" aria-hidden="true" />
          <div className="absolute left-1/2 top-[104px] h-4 w-6 -translate-x-1/2 rounded-[45%_45%_60%_60%] bg-zinc-900" aria-hidden="true" />
          <svg className="absolute left-1/2 top-[120px] h-4 w-10 -translate-x-1/2 text-zinc-500" viewBox="0 0 40 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M20 2v5M20 7c0 3-4 4-8 3M20 7c0 3 4 4 8 3" />
          </svg>

          {/* Paws (slide over eyes when shy) */}
          <div
            className="den-paw den-paw-left absolute left-[30px] top-[52px] z-20 h-16 w-11 rounded-full bg-gradient-to-b from-amber-100 to-amber-200 dark:from-amber-200/90 dark:to-amber-300/90 ring-1 ring-amber-300/60"
            aria-hidden="true"
          >
            <div className="mx-auto mt-2 h-8 w-px bg-amber-400/70" />
          </div>
          <div
            className="den-paw den-paw-right absolute right-[30px] top-[52px] z-20 h-16 w-11 rounded-full bg-gradient-to-b from-amber-100 to-amber-200 dark:from-amber-200/90 dark:to-amber-300/90 ring-1 ring-amber-300/60"
            aria-hidden="true"
          >
            <div className="mx-auto mt-2 h-8 w-px bg-amber-400/70" />
          </div>

          {/* Collar tag */}
          <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 py-1 pl-2 pr-2.5 shadow-glow-cash" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300 ring-1 ring-white/60" />
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white">Ax</span>
          </div>
        </div>
      </div>
    </div>
  );
}
