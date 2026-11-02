import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type PostLoginDestination = '/super-admin' | '/app' | '/setup-business';

const OWNER_EMAIL = 'acc.x7575@gmail.com';

function isSuperAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.email === OWNER_EMAIL) return true;
  return (
    Boolean(user.app_metadata?.is_super_admin) ||
    Boolean(user.user_metadata?.is_super_admin)
  );
}

export async function hasAnyBusiness(userId: string): Promise<boolean> {
  try {
    const { data: member } = await supabase
      .from('business_members')
      .select('business_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (member?.business_id) return true;
  } catch {
    /* membership lookup unavailable — fall through to ownership check */
  }

  try {
    const { data: owned } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', userId)
      .limit(1)
      .maybeSingle();
    if (owned?.id) return true;
  } catch {
    /* ownership lookup unavailable — treat as no record */
  }

  return false;
}

export async function resolvePostLoginDestination(
  user: User | null | undefined
): Promise<PostLoginDestination> {
  if (!user) return '/app';
  if (isSuperAdmin(user)) return '/super-admin';
  try {
    const configured = await hasAnyBusiness(user.id);
    return configured ? '/app' : '/setup-business';
  } catch {
    return '/app';
  }
}
