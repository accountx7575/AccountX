import { Github, Linkedin, Mail, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * ContactDock — mechanical keycap social dock.
 *
 * Each key is a 3D cube: the front face is a keycap (legend + label), the
 * back face carries the social icon. Hover or keyboard focus flips the cube
 * `rotateX(180deg)` to reveal the icon; pressing gives key-travel feedback.
 *
 * Motion is transform-only and disabled under `prefers-reduced-motion`.
 */

export type DockLink = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Single-character keycap legend, e.g. "G". */
  keycap: string;
  /** Back-face tile gradient, e.g. "from-zinc-700 to-zinc-900". */
  accent: string;
};

export const DEFAULT_DOCK_LINKS: DockLink[] = [
  { id: 'github', label: 'GitHub', href: 'https://github.com/accountx', icon: Github, keycap: 'G', accent: 'from-zinc-700 to-zinc-900' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/company/accountx', icon: Linkedin, keycap: 'L', accent: 'from-sky-600 to-blue-800' },
  { id: 'discord', label: 'Discord', href: 'https://discord.gg/accountx', icon: MessageCircle, keycap: 'D', accent: 'from-indigo-500 to-violet-700' },
  { id: 'mail', label: 'Email', href: 'mailto:hello@accountx.in', icon: Mail, keycap: '@', accent: 'from-emerald-500 to-teal-700' },
];

export type ContactDockProps = {
  links?: DockLink[];
  className?: string;
  ariaLabel?: string;
};

export function ContactDock({
  links = DEFAULT_DOCK_LINKS,
  className = '',
  ariaLabel = 'Contact and social links',
}: ContactDockProps) {
  return (
    <div className={className}>
      <style>{`
        .dock-cube { transform-style: preserve-3d; }
        .dock-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
        @media (prefers-reduced-motion: no-preference) {
          .dock-cube { transition: transform 0.45s cubic-bezier(0.34, 1.3, 0.64, 1); }
          .dock-key { transition: translate 0.12s ease; }
        }
      `}</style>

      <div role="group" aria-label={ariaLabel} className="flex items-start justify-center gap-3">
        {links.map((link) => {
          const Icon = link.icon;
          const external = link.href.startsWith('http');
          return (
            <a
              key={link.id}
              href={link.href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noreferrer noopener' : undefined}
              aria-label={`${link.label} (opens ${external ? 'in a new tab' : 'email client'})`}
              title={link.label}
              className="dock-key group block w-14 pb-2 outline-none [perspective:500px] active:translate-y-[3px] focus-visible:translate-y-0"
            >
              <span className="relative block h-14 w-14">
                <span
                  className="dock-cube absolute inset-0 block will-change-transform group-hover:[transform:rotateX(180deg)] group-focus-visible:[transform:rotateX(180deg)]"
                >
                  {/* Front face: keycap */}
                  <span className="dock-face absolute inset-0 flex flex-col items-center justify-center rounded-[10px] bg-gradient-to-b from-white to-zinc-200 ring-1 ring-zinc-900/15 [box-shadow:inset_0_2px_0_rgba(255,255,255,0.9),inset_0_-3px_0_rgba(0,0,0,0.12)] dark:from-zinc-600 dark:to-zinc-800 dark:ring-black/50 dark:[box-shadow:inset_0_2px_0_rgba(255,255,255,0.18),inset_0_-3px_0_rgba(0,0,0,0.4)]">
                    <span className="text-lg font-black leading-none tracking-tight text-zinc-700 dark:text-zinc-100">
                      {link.keycap}
                    </span>
                    <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-400">
                      {link.label}
                    </span>
                  </span>
                  {/* Back face: social icon */}
                  <span
                    className={`dock-face absolute inset-0 flex flex-col items-center justify-center rounded-[10px] bg-gradient-to-b ${link.accent} ring-1 ring-black/20 [box-shadow:inset_0_2px_0_rgba(255,255,255,0.25),inset_0_-3px_0_rgba(0,0,0,0.25)] [transform:rotateX(180deg)]`}
                  >
                    <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                    <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-white/85">
                      {link.label}
                    </span>
                  </span>
                </span>
                {/* Key switch base */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1.5 -bottom-1.5 -z-10 h-3 rounded-md bg-zinc-300 ring-1 ring-zinc-900/10 dark:bg-zinc-950 dark:ring-black/60"
                />
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
