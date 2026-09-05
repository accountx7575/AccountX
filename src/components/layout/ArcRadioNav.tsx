import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { opalGlassShellStyle } from './LiquidGlassNav';

export type ArcNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

type ArcRadioNavProps = {
  items: ArcNavItem[];
  ariaLabel?: string;
  className?: string;
};

const RING_SIZE = 48;

/**
 * "Arc" Radio Navigation Ring.
 * Route-aware icon dock: a circular light ring travels across the active
 * route icon (spring-eased transform) with a soft glow reflection beneath it.
 * Shares the Opal glass shell with LiquidGlassNav.
 */
export function ArcRadioNav({ items, ariaLabel = 'Primary', className }: ArcRadioNavProps) {
  const location = useLocation();
  const railRef = useRef<HTMLDivElement>(null);
  const anchorRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [ring, setRing] = useState({ x: 0, visible: false });

  // Longest-prefix match so nested routes (e.g. /app/customers/new) still
  // light the owning section icon.
  const activeTo =
    items
      .filter((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0]?.to ?? null;

  useLayoutEffect(() => {
    const measure = () => {
      const rail = railRef.current;
      const anchor = activeTo ? anchorRefs.current.get(activeTo) : undefined;
      if (!rail || !anchor) {
        setRing((r) => ({ ...r, visible: false }));
        return;
      }
      const railBox = rail.getBoundingClientRect();
      const box = anchor.getBoundingClientRect();
      setRing({
        x: box.left - railBox.left + box.width / 2 - RING_SIZE / 2,
        visible: true,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTo, items]);

  // Re-measure after fonts/layout settle so the ring never parks off-target.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const rail = railRef.current;
      const anchor = activeTo ? anchorRefs.current.get(activeTo) : undefined;
      if (!rail || !anchor) return;
      const railBox = rail.getBoundingClientRect();
      const box = anchor.getBoundingClientRect();
      setRing({
        x: box.left - railBox.left + box.width / 2 - RING_SIZE / 2,
        visible: true,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [activeTo]);

  return (
    <nav aria-label={ariaLabel} className={cn('pointer-events-auto', className)}>
      <div
        ref={railRef}
        style={opalGlassShellStyle}
        className={cn(
          'relative flex items-center gap-1 rounded-full px-2 py-1.5',
          'dark:[background:linear-gradient(135deg,rgba(24,24,27,0.78),rgba(24,24,27,0.5))] dark:[border-color:rgba(255,255,255,0.14)]'
        )}
      >
        {/* Traveling light ring */}
        <div
          aria-hidden="true"
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none motion-reduce:transition-none"
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            transform: `translateX(${ring.x}px)`,
            transition: 'transform 0.45s cubic-bezier(0.34, 1.4, 0.44, 1)',
            opacity: ring.visible ? 1 : 0,
          }}
        >
          <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="h-full w-full">
            <defs>
              <linearGradient id="arc-ring-glow" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="55%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_SIZE / 2 - 3}
              fill="rgba(129,140,248,0.12)"
              stroke="url(#arc-ring-glow)"
              strokeWidth={2.5}
              style={{ filter: 'drop-shadow(0 0 6px rgba(129,140,248,0.8))' }}
            />
            <circle cx={RING_SIZE / 2} cy={5.5} r={2.4} fill="#e0e7ff">
              <animate attributeName="opacity" values="1;0.4;1" dur="2.2s" repeatCount="indefinite" />
            </circle>
          </svg>
          {/* Glow reflection beneath the ring */}
          <div
            className="absolute left-1/2 -translate-x-1/2 -bottom-2 h-2 w-8 rounded-full"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(129,140,248,0.55), transparent 70%)',
              filter: 'blur(3px)',
            }}
          />
        </div>

        {items.map((item) => (
          <NavLink
            key={item.to}
            ref={(el) => {
              if (el) anchorRefs.current.set(item.to, el);
              else anchorRefs.current.delete(item.to);
            }}
            to={item.to}
            end={item.to === '/app'}
            title={item.label}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                'relative z-10 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
                isActive || item.to === activeTo
                  ? 'text-indigo-700 dark:text-indigo-200'
                  : 'text-secondary-500 dark:text-secondary-400 hover:text-secondary-900 dark:hover:text-secondary-100 hover:bg-white/40 dark:hover:bg-white/10'
              )
            }
          >
            <item.icon className="h-[18px] w-[18px]" />
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
