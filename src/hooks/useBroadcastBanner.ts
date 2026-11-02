import { useEffect, useState } from 'react';
import { getActiveBroadcastBanner, type BroadcastBanner, BROADCAST_CHANGE_EVENT } from '@/lib/broadcastStore';

/**
 * Site-wide active broadcast banner (PBS-141 shim). Re-renders on shim
 * changes and cross-tab storage writes so the composer takes effect for
 * every open window without a reload.
 */
export function useBroadcastBanner(): BroadcastBanner | null {
  const [banner, setBanner] = useState<BroadcastBanner | null>(() => getActiveBroadcastBanner());

  useEffect(() => {
    const sync = () => setBanner(getActiveBroadcastBanner());
    sync();
    if (typeof window === 'undefined') return;
    window.addEventListener(BROADCAST_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(BROADCAST_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return banner;
}
