/**
 * User profile persistence (profile phone save).
 *
 * Supabase Auth phone changes go through GoTrue's phone-verification path and
 * fail with "Unable to get SMS provider" when no SMS gateway is enabled, so
 * the phone is never sent as a top-level auth update. It is persisted in
 * user_metadata (auth), mirrored locally, and written to public.profiles when
 * that table exists.
 */

export interface ProfileUpdateInput {
  name: string;
  phone: string;
  email?: string;
}

export interface StoredUserProfile {
  name: string;
  phone: string;
  updatedAt: string;
}

const mirrorKey = (userId: string) => `ax-user-profile:${userId}`;

export function buildProfileUpdatePayload(input: ProfileUpdateInput): {
  data: Record<string, string>;
} {
  return {
    data: {
      name: input.name.trim(),
      phone: input.phone.trim(),
    },
  };
}

export function readUserProfile(userId: string): StoredUserProfile | null {
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(mirrorKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredUserProfile>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      phone: typeof parsed.phone === 'string' ? parsed.phone : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveUserProfile(userId: string, input: ProfileUpdateInput): StoredUserProfile | null {
  if (!userId || typeof localStorage === 'undefined') return null;
  const record: StoredUserProfile = {
    name: input.name.trim(),
    phone: input.phone.trim(),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(mirrorKey(userId), JSON.stringify(record));
  } catch {
    return null;
  }
  return record;
}

export function resolveProfilePhone(
  authUser: { phone?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined,
  userId: string
): string {
  const fromAuth = typeof authUser?.phone === 'string' ? authUser.phone.trim() : '';
  if (fromAuth) return fromAuth;
  const meta = authUser?.user_metadata?.phone;
  const fromMeta = typeof meta === 'string' ? meta.trim() : '';
  if (fromMeta) return fromMeta;
  const mirrored = readUserProfile(userId);
  return mirrored?.phone ?? '';
}

export function resolveProfileName(
  authUser: { user_metadata?: Record<string, unknown> | null } | null | undefined,
  userId: string
): string {
  const meta = authUser?.user_metadata?.name;
  if (typeof meta === 'string' && meta.trim()) return meta.trim();
  const mirrored = readUserProfile(userId);
  return mirrored?.name ?? '';
}

export interface ProfilesTableProbe {
  available: boolean;
  checkedAt: number;
}

export interface ProfilesQueryOptions {
  head?: boolean;
  count?: 'exact' | 'planned' | 'estimated';
}

export interface ProfilesQueryError {
  code?: string;
  message?: string;
}

export interface ProfilesClient {
  from: (table: string) => {
    select: (
      cols: string,
      opts?: ProfilesQueryOptions
    ) => { limit: (n: number) => PromiseLike<{ error: ProfilesQueryError | null }> };
    upsert: (
      values: Record<string, unknown>,
      options?: { onConflict?: string }
    ) => PromiseLike<{ error: ProfilesQueryError | null }>;
  };
}

let profilesTableCache: ProfilesTableProbe | null = null;
const PROBE_TTL_MS = 5 * 60 * 1000;

export function resetProfilesTableCache(): void {
  profilesTableCache = null;
}

export async function profilesTableAvailable(client: ProfilesClient): Promise<boolean> {
  const now = Date.now();
  if (profilesTableCache && now - profilesTableCache.checkedAt < PROBE_TTL_MS) {
    return profilesTableCache.available;
  }
  let available = false;
  try {
    const { error } = await client.from('profiles').select('id', { count: 'exact' }).limit(1);
    available = !error;
  } catch {
    available = false;
  }
  profilesTableCache = { available, checkedAt: now };
  return available;
}

export interface ProfilesPersistResult {
  persisted: boolean;
  error: string | null;
}

export async function persistProfileToProfilesTable(
  client: ProfilesClient,
  userId: string,
  input: ProfileUpdateInput
): Promise<ProfilesPersistResult> {
  try {
    const available = await profilesTableAvailable(client);
    if (!available) return { persisted: false, error: null };
    const values: Record<string, unknown> = {
      id: userId,
      updated_at: new Date().toISOString(),
    };
    if (input.phone.trim()) values.phone = input.phone.trim();
    if (input.name.trim()) values.full_name = input.name.trim();
    if (input.email?.trim()) values.email = input.email.trim();
    const { error } = await client.from('profiles').upsert(values, { onConflict: 'id' });
    if (error) return { persisted: false, error: error.message || 'profiles upsert failed' };
    return { persisted: true, error: null };
  } catch (err) {
    return { persisted: false, error: err instanceof Error ? err.message : 'profiles upsert failed' };
  }
}

export function profileErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const msg = raw.toLowerCase();
  if (!msg) return 'Could not save your profile. Please try again.';
  if (msg.includes('sms provider')) {
    return 'Phone numbers are saved on your AccountX profile, so no SMS verification is needed.';
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'Network error while saving your profile. Check your connection and try again.';
  }
  if (msg.includes('jwt') || msg.includes('not authenticated') || msg.includes('session')) {
    return 'Your session expired. Please sign in again and retry.';
  }
  if (msg.includes('row-level security') || msg.includes('42501')) {
    return 'Your account is not allowed to update this profile. Ask an admin for access.';
  }
  return raw || 'Could not save your profile. Please try again.';
}
