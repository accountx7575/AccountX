import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const panelTransition = { duration: 0.24, ease: EASE_OUT };
export const dropdownTransition = { duration: 0.16, ease: EASE_OUT };

export const backdropFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const drawerSlide = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
};

export const modalPop = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 4 },
};

export const dropdownPop = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0 },
};

export const pageFadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

export const pageFadeUpTransition = { duration: 0.22, ease: EASE_OUT };

export function PageMotion({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={pageFadeUp.initial}
      animate={pageFadeUp.animate}
      transition={pageFadeUpTransition}
    >
      {children}
    </motion.div>
  );
}

export function HoverLift({
  children,
  className,
  lift = 3,
}: {
  children: ReactNode;
  className?: string;
  lift?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      whileHover={{ y: -lift }}
      whileTap={{ y: -lift / 2 }}
      transition={{ duration: 0.15, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

export const listContainer = {
  animate: { transition: { staggerChildren: 0.04 } },
};

export const listItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
};

export function FadeWhen({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (!show) return null;
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={dropdownTransition}
    >
      {children}
    </motion.div>
  );
}
