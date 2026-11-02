import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type PlatformAnnouncement = {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'maintenance';
  expires_at: string | null;
  is_active: boolean;
  target_tier: string;
  created_at: string;
};

const DISMISSED_KEY_PREFIX = 'accountx_dismissed_announcement_';

/**
 * Latest active platform broadcast for the current tenant.
 * - Queries public.platform_announcements where is_active = true
 *   (RLS additionally restricts tenants to unexpired rows).
 * - Dismissal is per-session via sessionStorage so it doesn't reappear
 *   repeatedly within the same user session.
 */
export function usePlatformAnnouncement() {
  const [announcement, setAnnouncement] = useState<PlatformAnnouncement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('platform_announcements')
          .select('id, title, message, severity, expires_at, is_active, target_tier, created_at')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!mounted) return;
        if (error || !data) {
          setAnnouncement(null);
          return;
        }
        const row = data as PlatformAnnouncement;
        // Skip expired rows client-side as well (belt & braces on top of RLS).
        if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
          setAnnouncement(null);
          return;
        }
        // Skip announcements dismissed earlier in this session.
        try {
          if (sessionStorage.getItem(DISMISSED_KEY_PREFIX + row.id)) {
            setAnnouncement(null);
            return;
          }
        } catch {
          /* sessionStorage may be unavailable — still show */
        }
        setAnnouncement(row);
      } catch {
        if (mounted) setAnnouncement(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const dismiss = () => {
    if (announcement) {
      try {
        sessionStorage.setItem(DISMISSED_KEY_PREFIX + announcement.id, '1');
      } catch {
        /* ignore */
      }
    }
    setAnnouncement(null);
  };

  return { announcement, loading, dismiss };
}
