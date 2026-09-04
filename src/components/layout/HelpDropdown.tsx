import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Keyboard, BookOpen, LifeBuoy, ChevronDown } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';
import { dropdownPop, dropdownTransition } from '@/lib/motion';

const APP_VERSION = 'v1.0.0';

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl / ⌘ + K', action: 'Focus search' },
  { keys: 'Esc', action: 'Close menus and dialogs' },
];

type HelpDropdownProps = {
  onClose: () => void;
};

export function HelpDropdown({ onClose }: HelpDropdownProps) {
  const { toast } = useToast();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="absolute top-full right-0 mt-1 w-72 card p-2 z-50 origin-top-right"
      {...(reduce ? {} : dropdownPop)}
      transition={dropdownTransition}
    >
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 mb-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Help &amp; Support</h3>
        <p className="text-xs text-zinc-400 mt-0.5">Guides, shortcuts and ways to reach us.</p>
      </div>

      <button
        onClick={() => setShortcutsOpen(!shortcutsOpen)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <Keyboard className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 text-left font-medium">Keyboard Shortcuts</span>
        <ChevronDown className={cn('h-4 w-4 text-zinc-400 transition-transform', shortcutsOpen && 'rotate-180')} />
      </button>

      {shortcutsOpen && (
        <div className="mx-1 mb-1 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{s.action}</span>
              <kbd className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 shadow-sm">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => {
          onClose();
          toast('GST & Accounting documentation portal is coming soon', 'info');
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <BookOpen className="h-4 w-4 text-zinc-400" />
        <span className="font-medium">GST &amp; Accounting Docs</span>
      </button>

      <a
        href="mailto:support@accountx.app?subject=AccountX%20Support%20Ticket"
        onClick={onClose}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <LifeBuoy className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 font-medium">Contact Support / Raise Ticket</span>
      </a>

      <div className="border-t border-zinc-200 dark:border-zinc-800 mt-1 pt-2 px-3 pb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">AccountX</span>
        <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
          {APP_VERSION}
        </span>
      </div>
    </motion.div>
  );
}
