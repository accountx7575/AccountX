import { X } from 'lucide-react';
import { dismissBroadcast, type BroadcastType } from '@/lib/broadcastStore';
import { useBroadcastBanner } from '@/hooks/useBroadcastBanner';

const bannerStyles: Record<BroadcastType, string> = {
  info: 'bg-indigo-600 text-white',
  warn: 'bg-amber-400 text-amber-950',
};

export function BroadcastBanner() {
  const banner = useBroadcastBanner();
  if (!banner) return null;
  return (
    <div
      role="status"
      className={`w-full px-4 sm:px-6 py-2 flex items-center justify-center gap-3 text-sm font-medium ${bannerStyles[banner.type]}`}
    >
      <span className="text-center flex-1 min-w-0 break-words">{banner.message}</span>
      <button
        type="button"
        onClick={() => dismissBroadcast(banner.id)}
        aria-label="Dismiss broadcast banner"
        className="rounded-md p-1 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
