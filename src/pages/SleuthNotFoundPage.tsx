import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bug, Footprints, Home, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const LENS_RADIUS = 150;

type Clue = {
  id: string;
  x: number; // percent coords inside the canvas
  y: number;
  kind: 'prints' | 'bug' | 'note';
  rotate?: number;
  message: string;
};

const CLUES: Clue[] = [
  { id: 'c1', x: 12, y: 68, kind: 'prints', rotate: -24, message: 'Tiny footprints… leading nowhere.' },
  { id: 'c2', x: 26, y: 30, kind: 'note', message: '“Not a crumb.”' },
  { id: 'c3', x: 44, y: 74, kind: 'bug', message: 'A detective bug, mid-investigation.' },
  { id: 'c4', x: 58, y: 24, kind: 'prints', rotate: 31, message: 'The trail doubles back on itself.' },
  { id: 'c5', x: 71, y: 66, kind: 'note', message: '“The ledger ends here.”' },
  { id: 'c6', x: 84, y: 34, kind: 'bug', message: 'Witness #2 refuses to talk.' },
  { id: 'c7', x: 90, y: 72, kind: 'note', message: '“Dust. Only dust.”' },
];

/**
 * "Sleuth" Interactive Detective 404 Page.
 * A magnifying-glass lens tracks the cursor across giant 404 numerals;
 * moving it reveals hidden footprints, detective bugs, and clue messages.
 */
export function SleuthNotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState({ x: 50, y: 42, px: 0, py: 0, active: false });
  const [found, setFound] = useState<Set<string>>(new Set());

  const updateFromClient = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < 0 || py < 0 || px > rect.width || py > rect.height) return;
    const x = (px / rect.width) * 100;
    const y = (py / rect.height) * 100;
    setLens({ x, y, px, py, active: true });
    // A clue counts as found once the lens centre passes near it.
    setFound((prev) => {
      const next = new Set(prev);
      for (const c of CLUES) {
        const dx = x - c.x;
        const dy = ((y - c.y) * rect.width) / Math.max(rect.height, 1);
        if (Math.hypot(dx, dy) < 9) next.add(c.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/app');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Default lens parked over the middle for touch devices (no cursor yet).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || lens.active) return;
    const rect = el.getBoundingClientRect();
    setLens((l) => ({ ...l, px: rect.width / 2, py: rect.height * 0.42 }));
  }, [lens.active]);

  const mask = lens.active
    ? `radial-gradient(circle ${LENS_RADIUS}px at ${lens.px}px ${lens.py}px, black 0, black ${LENS_RADIUS - 30}px, transparent ${LENS_RADIUS}px)`
    : 'none';

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-950 flex flex-col">
      <div
        ref={canvasRef}
        onMouseMove={(e) => updateFromClient(e.clientX, e.clientY)}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) updateFromClient(t.clientX, t.clientY);
        }}
        className="relative flex-1 overflow-hidden cursor-none motion-reduce:cursor-auto select-none"
        aria-label="Lost-page detective canvas. Move your cursor to search for clues with the magnifying glass."
      >
        {/* Base layer: giant numerals + case file */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-secondary-400">
            <Search className="h-3.5 w-3.5" />
            Case file · {location.pathname}
          </div>
          <h1
            aria-label="404 page not found"
            className="mt-2 font-black leading-none tracking-tighter text-secondary-900 dark:text-white tabular-nums"
            style={{ fontSize: 'clamp(7rem, 24vw, 19rem)' }}
          >
            4<span className="text-indigo-500 dark:text-indigo-400">0</span>4
          </h1>
          <p className="mt-2 max-w-md text-sm sm:text-base text-secondary-500 dark:text-secondary-400">
            This page vanished without a trace. Grab the magnifying glass and sweep the scene —
            <span className="font-semibold text-secondary-700 dark:text-secondary-200"> {found.size} / {CLUES.length} clues uncovered</span>.
          </p>
          <button
            type="button"
            onClick={() => navigate('/app')}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-transform hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 cursor-pointer"
          >
            <Home className="h-4 w-4" />
            Back to Home
          </button>
          <p className="mt-3 text-xs text-secondary-400">Tip: press Esc for a quick return</p>
        </div>

        {/* Hidden clue layer: visible ONLY inside the lens */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ WebkitMaskImage: mask, maskImage: mask }}
        >
          <div className="absolute inset-0 bg-indigo-950/[0.04] dark:bg-indigo-300/[0.05]" />
          {CLUES.map((c) => (
            <div
              key={c.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${c.x}%`, top: `${c.y}%` }}
            >
              {c.kind === 'prints' && (
                <Footprints
                  className={cn('h-7 w-7 text-amber-700 dark:text-amber-400', found.has(c.id) && 'scale-110')}
                  style={{ transform: `rotate(${c.rotate ?? 0}deg)` }}
                />
              )}
              {c.kind === 'bug' && (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600/90 shadow-lg shadow-emerald-900/30">
                  <Bug className="h-5 w-5 text-white" />
                </span>
              )}
              {c.kind === 'note' && (
                <span className="block max-w-[180px] -rotate-3 rounded-md bg-amber-100 px-3 py-2 text-xs font-medium italic text-amber-900 shadow-md">
                  {c.message}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Magnifying glass chrome following the cursor */}
        {lens.active && (
          <div
            aria-hidden="true"
            className="absolute z-10 pointer-events-none motion-reduce:hidden"
            style={{ left: lens.px, top: lens.py, width: 0, height: 0 }}
          >
            <div
              className="absolute rounded-full"
              style={{
                width: LENS_RADIUS * 2,
                height: LENS_RADIUS * 2,
                transform: 'translate(-50%, -50%)',
                border: '6px solid rgba(30,27,75,0.85)',
                boxShadow:
                  'inset 0 0 24px rgba(129,140,248,0.25), 0 12px 40px rgba(15,23,42,0.35)',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.02) 55%)',
              }}
            >
              {/* Handle */}
              <div
                className="absolute rounded-full"
                style={{
                  width: 14,
                  height: 84,
                  right: -34,
                  bottom: -58,
                  transform: 'rotate(-45deg)',
                  background: 'linear-gradient(180deg, #312e81, #1e1b4b)',
                }}
              />
              {/* Glare + zoom badge */}
              <div
                className="absolute left-6 top-4 h-10 w-16 rounded-full bg-white/30 blur-[6px]"
                style={{ transform: 'rotate(-24deg)' }}
              />
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-950/85 px-2 py-0.5 text-[10px] font-bold text-white">
                ×2
              </span>
            </div>
          </div>
        )}

        {/* Live clue toast: latest discovery */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none px-4 w-full max-w-lg text-center">
          {found.size > 0 && (
            <p key={found.size} className="inline-block rounded-full bg-secondary-900/85 dark:bg-white/10 px-4 py-1.5 text-xs font-medium text-white backdrop-blur">
              {CLUES.find((c) => c.id === [...found].pop())?.message ?? ''} · {found.size}/{CLUES.length} found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
