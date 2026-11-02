import type { ReactNode } from 'react';
import { LogIn, UserPlus } from 'lucide-react';

/**
 * VersoAuthCard — "Verso" 3D sign in / sign up card flip.
 *
 * A skewed ribbon switcher toggles `mode`; the card body flips in 3D
 * (`rotateY`, `preserve-3d`) between the `signIn` and `signUp` faces with
 * no page reload. Faces share a grid cell so the card auto-sizes to the
 * taller face. The hidden face is removed from the tab order via `inert`.
 *
 * Motion is transform-only and the flip transition is gated behind
 * `prefers-reduced-motion: no-preference`.
 */

export type VersoMode = 'signin' | 'signup';

export type VersoAuthCardProps = {
  mode: VersoMode;
  onModeChange: (mode: VersoMode) => void;
  /** Front face — the sign-in form. */
  signIn: ReactNode;
  /** Back face — the create-account panel. */
  signUp: ReactNode;
  className?: string;
};

function setFaceInert(el: HTMLDivElement | null, inert: boolean) {
  if (el) el.inert = inert;
}

export function VersoAuthCard({ mode, onModeChange, signIn, signUp, className = '' }: VersoAuthCardProps) {
  const signup = mode === 'signup';

  return (
    <div className={className}>
      <style>{`
        .verso-inner { transform-style: preserve-3d; }
        .verso-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
        @media (prefers-reduced-motion: no-preference) {
          .verso-inner { transition: transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1); }
          .verso-ribbon-pill { transition: transform 0.35s cubic-bezier(0.34, 1.3, 0.64, 1); }
        }
      `}</style>

      {/* Skewed ribbon switcher */}
      <div
        role="tablist"
        aria-label="Choose sign in or create account"
        className="relative mx-auto mb-5 grid w-fit grid-cols-2 rounded-xl bg-secondary-100 p-1 dark:bg-secondary-800"
      >
        <span
          aria-hidden="true"
          className={`verso-ribbon-pill absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-glow-cash [transform:skewX(-12deg)] ${
            signup ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        <button
          type="button"
          role="tab"
          aria-selected={!signup}
          onClick={() => onModeChange('signin')}
          className={`relative z-10 flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold [transform:skewX(-12deg)] transition-colors duration-200 ${
            signup
              ? 'text-secondary-500 hover:text-secondary-700 dark:text-secondary-400 dark:hover:text-secondary-200'
              : 'text-white'
          }`}
        >
          <span className="flex items-center gap-1.5 [transform:skewX(12deg)]">
            <LogIn className="h-4 w-4" aria-hidden="true" /> Sign In
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={signup}
          onClick={() => onModeChange('signup')}
          className={`relative z-10 flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-semibold [transform:skewX(-12deg)] transition-colors duration-200 ${
            signup
              ? 'text-white'
              : 'text-secondary-500 hover:text-secondary-700 dark:text-secondary-400 dark:hover:text-secondary-200'
          }`}
        >
          <span className="flex items-center gap-1.5 [transform:skewX(12deg)]">
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Sign Up
          </span>
        </button>
      </div>

      {/* 3D flip scene */}
      <div className="[perspective:1600px]">
        <div
          className="verso-inner grid will-change-transform"
          style={{ transform: signup ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
        >
          <div
            ref={(el) => setFaceInert(el, signup)}
            role="tabpanel"
            aria-hidden={signup}
            className="verso-face [grid-area:1/1]"
          >
            {signIn}
          </div>
          <div
            ref={(el) => setFaceInert(el, !signup)}
            role="tabpanel"
            aria-hidden={!signup}
            className="verso-face [grid-area:1/1] [transform:rotateY(180deg)]"
          >
            {signUp}
          </div>
        </div>
      </div>
    </div>
  );
}
