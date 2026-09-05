import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type GlassNavItem<K extends string = string> = {
  key: K;
  label: string;
  icon?: ReactNode;
};

type LiquidGlassNavProps<K extends string> = {
  items: GlassNavItem<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
  className?: string;
};

/**
 * Shared "Opal" liquid-glass shell. ArcRadioNav reuses this so both docks
 * speak the same design language across the app navigation.
 */
export const opalGlassShellStyle: CSSProperties = {
  backdropFilter: 'blur(16px) saturate(180%)',
  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
  background: 'linear-gradient(135deg, rgba(255,255,255,0.72), rgba(255,255,255,0.38))',
  border: '1px solid rgba(255,255,255,0.55)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(255,255,255,0.25), 0 8px 32px rgba(15,23,42,0.12)',
};

const SPRING_STIFFNESS = 340;
const SPRING_DAMPING = 30;

/**
 * "Opal" Liquid Glass Navigation Dock.
 * A spring-physics tab indicator glides beneath the active tab with a
 * stretch-elastic feel (scales along the travel axis proportional to
 * velocity), rendered over a backdrop-blurred glass shell.
 */
export function LiquidGlassNav<K extends string>({
  items,
  activeKey,
  onChange,
  ariaLabel = 'Section navigation',
  className,
}: LiquidGlassNavProps<K>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<K, HTMLButtonElement>());
  const pillRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef({ x: 0, w: 0, vx: 0, vw: 0, tx: 0, tw: 0 });

  const setButtonRef = useCallback(
    (key: K) => (el: HTMLButtonElement | null) => {
      if (el) buttonRefs.current.set(key, el);
      else buttonRefs.current.delete(key);
    },
    []
  );

  // Retarget the spring whenever the active tab or layout changes.
  useEffect(() => {
    const track = trackRef.current;
    const btn = buttonRefs.current.get(activeKey);
    const pill = pillRef.current;
    if (!track || !btn || !pill) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = stateRef.current;
    s.tx = btn.offsetLeft;
    s.tw = btn.offsetWidth;

    // First paint: snap so the pill never flies in from the corner.
    if (s.w === 0) {
      s.x = s.tx;
      s.w = s.tw;
      pill.style.transform = `translateX(${s.x}px) scaleX(1)`;
      pill.style.width = `${s.w}px`;
    }
    if (reduced) {
      cancelAnimationFrame(animRef.current);
      s.x = s.tx;
      s.w = s.tw;
      s.vx = 0;
      s.vw = 0;
      pill.style.transform = `translateX(${s.x}px) scaleX(1)`;
      pill.style.width = `${s.w}px`;
      return;
    }

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.032);
      last = now;
      const st = stateRef.current;
      // Independent damped springs for position and width.
      const ax = SPRING_STIFFNESS * (st.tx - st.x) - SPRING_DAMPING * st.vx;
      const aw = SPRING_STIFFNESS * (st.tw - st.w) - SPRING_DAMPING * st.vw;
      st.vx += ax * dt;
      st.vw += aw * dt;
      st.x += st.vx * dt;
      st.w += st.vw * dt;
      // Elastic stretch: elongate along travel proportional to velocity.
      const stretch = Math.min(Math.abs(st.vx) / 4200, 0.38);
      if (pillRef.current) {
        pillRef.current.style.transform = `translateX(${st.x}px) scaleX(${1 + stretch})`;
        pillRef.current.style.width = `${Math.max(st.w, 1)}px`;
      }
      const settled =
        Math.abs(st.tx - st.x) < 0.4 &&
        Math.abs(st.tw - st.w) < 0.4 &&
        Math.abs(st.vx) < 4 &&
        Math.abs(st.vw) < 4;
      if (!settled) {
        animRef.current = requestAnimationFrame(tick);
      } else if (pillRef.current) {
        pillRef.current.style.transform = `translateX(${st.tx}px) scaleX(1)`;
        pillRef.current.style.width = `${st.tw}px`;
      }
    };
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [activeKey, items]);

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      ref={trackRef}
      style={opalGlassShellStyle}
      className={cn(
        'relative rounded-2xl p-1.5 flex gap-1 flex-wrap overflow-hidden',
        'dark:[background:linear-gradient(135deg,rgba(24,24,27,0.72),rgba(24,24,27,0.45))] dark:[border-color:rgba(255,255,255,0.14)]',
        className
      )}
    >
      {/* Spring pill: glass highlight gliding under the active tab */}
      <div
        ref={pillRef}
        aria-hidden="true"
        className="absolute top-1.5 bottom-1.5 left-0 rounded-xl pointer-events-none"
        style={{
          width: 0,
          background: 'linear-gradient(135deg, rgba(99,102,241,0.28), rgba(168,85,247,0.28))',
          border: '1px solid rgba(255,255,255,0.6)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 16px rgba(99,102,241,0.25)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          transformOrigin: 'center',
        }}
      />
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            ref={setButtonRef(item.key)}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              'relative z-10 px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-150',
              'inline-flex items-center gap-2 whitespace-nowrap',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
              active
                ? 'text-indigo-950 dark:text-white'
                : 'text-secondary-500 dark:text-secondary-400 hover:text-secondary-900 dark:hover:text-secondary-100'
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
