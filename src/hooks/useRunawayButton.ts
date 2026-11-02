import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { signalLocked } from '@/lib/audioHaptic';

export interface RunawayOffset {
  x: number;
  y: number;
}

interface UseRunawayButtonOptions {
  active: boolean;
  radius?: number;
  maxOffset?: number;
}

interface UseRunawayButtonResult {
  buttonRef: RefObject<HTMLButtonElement>;
  style: CSSProperties;
  locked: boolean;
  dodges: number;
}

const DEFAULT_RADIUS = 70;
const DEFAULT_MAX_OFFSET = 96;

export function useRunawayButton({
  active,
  radius = DEFAULT_RADIUS,
  maxOffset = DEFAULT_MAX_OFFSET,
}: UseRunawayButtonOptions): UseRunawayButtonResult {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState<RunawayOffset>({ x: 0, y: 0 });
  const [dodges, setDodges] = useState(0);
  const rafId = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const configRef = useRef({ radius, maxOffset });
  configRef.current = { radius, maxOffset };

  const cancelScheduled = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  useEffect(() => {
    if (!activeRef.current) {
      cancelScheduled();
      setOffset({ x: 0, y: 0 });
    }
  }, [active, cancelScheduled]);

  useEffect(() => {
    const onPointerMove = (ev: PointerEvent) => {
      if (!activeRef.current) return;
      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const el = buttonRef.current;
        if (!el || !activeRef.current) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = cx - ev.clientX;
        const dy = cy - ev.clientY;
        const distance = Math.hypot(dx, dy);
        const { radius: liveRadius, maxOffset: liveMax } = configRef.current;
        if (distance >= liveRadius || distance === 0) return;
        const strength = 1 - distance / liveRadius;
        const nx = dx / distance;
        const ny = dy / distance;
        const magnitude = Math.min(liveMax, 24 + strength * (liveMax - 24));
        setOffset({ x: nx * magnitude, y: ny * magnitude });
        setDodges((n) => n + 1);
      });
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelScheduled();
    };
  }, [cancelScheduled]);

  const locked = !active;
  const prevLocked = useRef(locked);

  useEffect(() => {
    if (locked && !prevLocked.current) signalLocked();
    prevLocked.current = locked;
  }, [locked]);

  const style: CSSProperties = locked
    ? {
        transform: 'translate(0px, 0px)',
        transition: 'transform 180ms ease-out, box-shadow 180ms ease-out',
        boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.55), 0 0 18px rgba(16, 185, 129, 0.45)',
      }
    : {
        transform: `translate(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px)`,
        transition: 'transform 120ms ease-out',
      };

  return { buttonRef, style, locked, dodges };
}
