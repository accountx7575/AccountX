import React, { useState } from 'react';
import { Mail, Github, Linkedin, MessageSquare, Globe, Phone, FileText } from 'lucide-react';

interface KeyConfig {
  letter: string;
  name: string;
  link: string;
  icon: React.ReactNode;
}

const KEYS: KeyConfig[] = [
  { letter: 'C', name: 'Call Support', link: 'tel:+919450257575', icon: <Phone className="w-4 h-4 text-emerald-500" /> },
  { letter: 'O', name: 'Open Portal', link: '/app', icon: <Globe className="w-4 h-4 text-blue-500" /> },
  { letter: 'N', name: 'New Invoice', link: '/invoices/create', icon: <FileText className="w-4 h-4 text-purple-500" /> },
  { letter: 'T', name: 'Telegram / Chat', link: 'https://telegram.org', icon: <MessageSquare className="w-4 h-4 text-sky-500" /> },
  { letter: 'A', name: 'Admin Center', link: '/super-admin', icon: <Linkedin className="w-4 h-4 text-indigo-500" /> },
  { letter: 'C', name: 'Code / GitHub', link: 'https://github.com/accountx7575/AccountX', icon: <Github className="w-4 h-4 text-slate-800 dark:text-white" /> },
  { letter: 'T', name: 'Email Us', link: 'mailto:abc.solar7575@gmail.com', icon: <Mail className="w-4 h-4 text-rose-500" /> },
];

export function ContactDock() {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-100/60 dark:bg-zinc-900/40 rounded-2xl border border-slate-200 dark:border-zinc-800/80 my-8">
      <p className="text-xs uppercase tracking-[0.2em] font-semibold text-slate-400 mb-4">
        Interactive Help & Quick Access
      </p>

      {/* Floating tooltip label */}
      <div className="h-6 mb-2">
        {hoveredIdx !== null ? (
          <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 px-3 py-1 rounded-full shadow-sm border border-slate-200 dark:border-zinc-700 animate-fade-in">
            {KEYS[hoveredIdx].name}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Hover any key below</span>
        )}
      </div>

      {/* Dock Keys Container */}
      <div className="flex items-center gap-2 sm:gap-3 p-3 bg-white dark:bg-zinc-900 rounded-2xl shadow-lg border border-slate-200 dark:border-zinc-800">
        {KEYS.map((k, idx) => (
          <a
            key={idx}
            href={k.link}
            target={k.link.startsWith('http') ? '_blank' : '_self'}
            rel="noreferrer"
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            className="group relative w-10 h-12 sm:w-12 sm:h-14 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:border-primary-500 active:scale-95 overflow-hidden"
          >
            {/* Front Letter */}
            <span className="text-sm sm:text-base font-black text-slate-700 dark:text-zinc-300 group-hover:hidden font-mono">
              {k.letter}
            </span>

            {/* Back Icon on Hover */}
            <div className="hidden group-hover:flex items-center justify-center">
              {k.icon}
            </div>

            {/* Keycap bottom lip */}
            <div className="absolute bottom-1 w-5 h-1 rounded-full bg-slate-300 dark:bg-zinc-700 group-hover:bg-primary-400 transition-colors" />
          </a>
        ))}
      </div>
    </div>
  );
}
