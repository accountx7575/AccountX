import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, ArrowLeft, X as XIcon, RotateCcw, Bell } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import {
  deleteBroadcastBanner,
  listBroadcastBanners,
  setBroadcastActive,
  setBroadcastBanner,
  type BroadcastBanner,
  type BroadcastType,
} from '@/lib/broadcastStore';

const typeMeta: Record<BroadcastType, { label: string; cls: string }> = {
  info: { label: 'Info', cls: 'bg-indigo-600 text-white text-xs font-medium px-2 py-0.5 rounded-md' },
  warn: { label: 'Warning', cls: 'bg-amber-400 text-amber-950 text-xs font-medium px-2 py-0.5 rounded-md' },
};

export function BroadcastPage() {
  const [draft, setDraft] = useState<{ message: string; type: BroadcastType }>({ message: '', type: 'info' });
  const [saved, setSaved] = useState(false);

  const publish = () => {
    if (!draft.message.trim()) return;
    setBroadcastBanner(draft);
    setSaved(true);
    setDraft({ message: '', type: 'info' });
  };

  return (
    <div>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-6 border-b border-secondary-200 dark:border-secondary-800">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary-100 dark:bg-primary-950/50 rounded-lg text-primary-600 dark:text-primary-400">
              <Megaphone className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-page-title sm:text-2xl">Global Broadcasts</h1>
              <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">
                Banner composer (type: info/warn + active flag). Renders site-wide through the
                existing AppLayout banner strip via the broadcast shim — no double banner with
                the platform announcements channel.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/super-admin" className="inline-flex">
              <Button variant="secondary" size="sm" className="flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Control Center
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card-solid p-5 space-y-4">
            <h3 className="text-sm font-semibold text-secondary-900 dark:text-white">Publish banner</h3>
            <div>
              <label className="text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1 block">Message</label>
              <Textarea
                value={draft.message}
                onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                rows={4}
                placeholder="e.g. Scheduled maintenance Sunday 02:00–03:00 IST"
                className="mt-1 w-full input text-sm text-secondary-800 dark:text-zinc-100"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1 block">Type</label>
                <div className="flex gap-2">
                  {(['info', 'warn'] as BroadcastType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={draft.type === t}
                      onClick={() => setDraft({ ...draft, type: t })}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        draft.type === t
                          ? `bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900`
                          : 'bg-secondary-50 text-secondary-500 border-secondary-200 dark:bg-secondary-800/60 dark:text-secondary-400 dark:border-secondary-700'
                      }`}
                    >
                      {typeMeta[t].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <Button size="sm" disabled={!draft.message.trim()} onClick={publish} className="w-full inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
              <Megaphone className="w-4 h-4" /> Publish banner
            </Button>
            {saved && (
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Banner active — visible site-wide.</p>
            )}
          </div>

          <div className="lg:col-span-2 card-solid overflow-hidden">
            <div className="px-5 py-4 border-b border-secondary-200 dark:border-secondary-800">
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-white flex items-center gap-2">
                <Bell className="w-4 h-4" /> Active &amp; past banners
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[520px]">
                <thead className="bg-secondary-50 dark:bg-secondary-800/50 border-b border-secondary-200 dark:border-secondary-800 text-xs font-semibold text-secondary-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Message</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Active</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
                  {listBroadcastBanners().length === 0 ? (
                    <tr><td colSpan={5} className="px-5 py-10 text-center text-secondary-400">No banners yet — publish the first one.</td></tr>
                  ) : listBroadcastBanners().map((banner) => (
                    <tr key={banner.id} className="bg-secondary-100/60 dark:bg-secondary-800/50 table-row-hover transition-colors">
                      <td className="px-5 py-3 text-sm text-secondary-900 dark:text-white">{banner.message}</td>
                      <td className="px-5 py-3"><span className={typeMeta[banner.type].cls}>{typeMeta[banner.type].label}</span></td>
                      <td className="px-5 py-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          className={`px-2 py-1 text-xs ${banner.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}
                          onClick={() => setBroadcastActive(banner.id, !banner.active)}
                        >
                          {banner.active ? 'Active' : 'Inactive'}
                        </Button>
                      </td>
                      <td className="px-5 py-3 text-secondary-500 text-xs whitespace-nowrap">{banner.createdAt}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="secondary" size="sm" className="text-xs text-rose-600 border-rose-200" onClick={() => deleteBroadcastBanner(banner.id)}>
                            <XIcon className="w-3.5 h-3.5" /> Delete
                          </Button>
                          <Button variant="secondary" size="sm" className="text-xs" onClick={() => setDraft({ message: banner.message, type: banner.type })}>
                            <RotateCcw className="w-3.5 h-3.5" /> Edit draft
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card-solid p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-xs text-secondary-400">
            Banner state lives in the broadcast shim (ax-broadcast-banner-v1) and is dismissed per-session; every open window reflects edits live.
          </span>
        </div>
      </div>
    </div>
  );
}
