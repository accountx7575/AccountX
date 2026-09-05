import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * AtlasTeamCarousel — "Atlas" 3D team / feature showcase.
 *
 * Cards fan out in 3D (`perspective` + `rotateY`/`translateZ`) around the
 * active card. Inactive cards rest in grayscale monochrome; the active card
 * lifts, gains full color and elevation. Hovering, clicking, arrows, dots,
 * or keyboard arrows select a card; autoplay pauses on hover/focus.
 *
 * All motion is transform/filter/opacity-only. Filter animation is limited
 * to these small cards to hold 60fps, and everything is disabled under
 * `prefers-reduced-motion`.
 */

export type AtlasItem = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Gradient classes for the icon tile, e.g. "from-indigo-500 to-violet-600". */
  accent: string;
};

export type AtlasTeamCarouselProps = {
  items: AtlasItem[];
  /** ms between auto-advances; 0 disables autoplay. */
  autoPlayMs?: number;
  /** Compact sizing for embedding in side panels. */
  compact?: boolean;
  /** Surface tone the cards sit on. Defaults to dark showcase panels. */
  tone?: 'dark' | 'light';
  className?: string;
  ariaLabel?: string;
};

const SPREAD = 132; // px of lateral travel per offset step
const PUSHBACK = 150; // px of translateZ per offset step

export function AtlasTeamCarousel({
  items,
  autoPlayMs = 6000,
  compact = false,
  tone = 'dark',
  className = '',
  ariaLabel = 'Feature showcase',
}: AtlasTeamCarouselProps) {
  const dark = tone === 'dark';
  const count = items.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const hoverRef = useRef(false);

  const go = useCallback(
    (dir: 1 | -1) => setActive((a) => (a + dir + count) % count),
    [count],
  );

  useEffect(() => {
    if (autoPlayMs <= 0 || count < 2 || paused) return;
    const t = window.setInterval(() => {
      if (!hoverRef.current) setActive((a) => (a + 1) % count);
    }, autoPlayMs);
    return () => window.clearInterval(t);
  }, [autoPlayMs, count, paused]);

  if (count === 0) return null;

  const cardW = compact ? 'w-44' : 'w-56';
  const stageH = compact ? 'h-60' : 'h-72';

  return (
    <div className={className}>
      <style>{`
        .atlas-card { transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.45s ease, filter 0.5s ease, box-shadow 0.45s ease; will-change: transform; }
        @media (prefers-reduced-motion: reduce) {
          .atlas-card { transition: none !important; }
        }
      `}</style>

      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        className="relative"
        onMouseEnter={() => { hoverRef.current = true; }}
        onMouseLeave={() => { hoverRef.current = false; }}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(1);
          else if (e.key === 'ArrowLeft') go(-1);
        }}
      >
        <div className={`relative ${stageH} [perspective:1400px]`} aria-live="off">
          {items.map((item, i) => {
            // Shortest signed distance around the ring.
            let offset = (i - active) % count;
            if (offset > count / 2) offset -= count;
            if (offset < -count / 2) offset += count;
            const abs = Math.min(Math.abs(offset), 2);
            const Icon = item.icon;
            const isActive = offset === 0;
            const style: CSSProperties = {
              transform: `translate(-50%, -50%) translateX(${offset * SPREAD}px) translateZ(${-abs * PUSHBACK}px) rotateY(${offset * -16}deg) scale(${1 - abs * 0.09})`,
              zIndex: 10 - abs,
              opacity: abs > 1 ? 0 : 1 - abs * 0.25,
              pointerEvents: abs > 1 ? 'none' : 'auto',
            };
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show ${item.title}`}
                aria-current={isActive}
                tabIndex={isActive ? 0 : -1}
                style={style}
                className={`atlas-card absolute left-1/2 top-1/2 ${cardW} cursor-pointer rounded-2xl border p-4 text-left backdrop-blur-sm ${
                  isActive
                    ? dark
                      ? 'border-white/30 bg-white/95 shadow-2xl shadow-indigo-950/40 ring-2 ring-indigo-400/60 [filter:grayscale(0)]'
                      : 'border-indigo-200 bg-white shadow-2xl shadow-indigo-500/20 ring-2 ring-indigo-500/50 [filter:grayscale(0)]'
                    : dark
                      ? 'border-white/15 bg-white/60 shadow-lg shadow-indigo-950/20 [filter:grayscale(1)] hover:[filter:grayscale(0.35)]'
                      : 'border-secondary-200 bg-white/80 shadow-lg [filter:grayscale(1)] hover:[filter:grayscale(0.35)]'
                }`}
              >
                <span
                  className={`inline-flex rounded-xl bg-gradient-to-br ${item.accent} p-2.5 text-white shadow-lg`}
                >
                  <Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} aria-hidden="true" />
                </span>
                <span className={`mt-3 block font-bold tracking-tight ${dark ? 'text-white' : 'text-secondary-900'} ${compact ? 'text-sm' : 'text-base'}`}>
                  {item.title}
                </span>
                <span className={`mt-1 block leading-snug ${dark ? 'text-indigo-100/85' : 'text-secondary-500'} ${compact ? 'text-[11px]' : 'text-xs'}`}>
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        {count > 1 && (
          <div className="mt-1 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous card"
              className={`rounded-full border p-1.5 backdrop-blur-sm transition-all duration-150 hover:scale-105 active:scale-95 ${
                dark
                  ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                  : 'border-secondary-200 bg-white text-secondary-600 shadow-sm hover:bg-secondary-50'
              }`}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose card">
              {items.map((item, i) => (
                <button
                  key={item.title}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Go to ${item.title}`}
                  onClick={() => setActive(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === active
                      ? dark
                        ? 'w-6 bg-white'
                        : 'w-6 bg-indigo-600'
                      : dark
                        ? 'w-1.5 bg-white/40 hover:bg-white/70'
                        : 'w-1.5 bg-secondary-300 hover:bg-secondary-400'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next card"
              className={`rounded-full border p-1.5 backdrop-blur-sm transition-all duration-150 hover:scale-105 active:scale-95 ${
                dark
                  ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                  : 'border-secondary-200 bg-white text-secondary-600 shadow-sm hover:bg-secondary-50'
              }`}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          Card {active + 1} of {count}: {items[active]?.title}
        </p>
      </div>
    </div>
  );
}
