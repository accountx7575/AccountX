import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildProfileUpdatePayload,
  persistProfileToProfilesTable,
  profileErrorMessage,
  readUserProfile,
  resetProfilesTableCache,
  resolveProfileName,
  resolveProfilePhone,
  saveUserProfile,
} from './userProfileStore';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  resetProfilesTableCache();
});

const successClient = {
  from: () => ({
    select: () => ({ limit: () => Promise.resolve({ error: null }) }),
    upsert: () => Promise.resolve({ error: null }),
  }),
};

const missingTableClient = {
  from: () => ({
    select: () => ({
      limit: () => Promise.resolve({ error: { code: 'PGR0403', message: 'relation "public.profiles" does not exist' } }),
    }),
    upsert: () => Promise.resolve({ error: null }),
  }),
};

describe('buildProfileUpdatePayload', () => {
  it('puts name and phone in user_metadata, never as a top-level phone', () => {
    const result = buildProfileUpdatePayload({ name: 'Ada Lovelace', phone: '+1 555 000 0000' });
    expect(result).toEqual({ data: { name: 'Ada Lovelace', phone: '+1 555 000 0000' } });
    expect('phone' in result).toBe(false);
  });

  it('trims whitespace and keeps explicit empties so a phone can be cleared', () => {
    const result = buildProfileUpdatePayload({ name: '  B  ', phone: '  ' });
    expect(result).toEqual({ data: { name: 'B', phone: '' } });
  });
});

describe('localStorage mirror', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('roundtrips name and phone', () => {
    const record = saveUserProfile('u1', { name: ' Ada ', phone: '+44 20 7946 0000' });
    expect(record?.name).toBe('Ada');
    expect(record?.phone).toBe('+44 20 7946 0000');
    expect(readUserProfile('u1')?.phone).toBe('+44 20 7946 0000');
  });

  it('returns null without a user id', () => {
    expect(readUserProfile('')).toBeNull();
  });
});

describe('profile resolution', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefers auth phone, then metadata phone, then the mirror', () => {
    saveUserProfile('u1', { name: 'Mirror Name', phone: '+mirror' });
    expect(resolveProfilePhone({ phone: '+auth' }, 'u1')).toBe('+auth');
    expect(resolveProfilePhone({ user_metadata: { phone: '+meta' } }, 'u1')).toBe('+meta');
    expect(resolveProfilePhone(null, 'u1')).toBe('+mirror');
  });

  it('resolves the name from metadata then the mirror', () => {
    saveUserProfile('u1', { name: 'Mirror Name', phone: '+mirror' });
    expect(resolveProfileName({ user_metadata: { name: 'Meta Name' } }, 'u1')).toBe('Meta Name');
    expect(resolveProfileName({}, 'u1')).toBe('Mirror Name');
  });
});

describe('persistProfileToProfilesTable', () => {
  beforeEach(() => {
    resetProfilesTableCache();
  });

  it('persists when the profiles table exists', async () => {
    const result = await persistProfileToProfilesTable(successClient, 'u1', {
      name: 'Silent Bob',
      phone: '+1 555 000 0000',
      email: 'bob@example.com',
    });
    expect(result).toEqual({ persisted: true, error: null });
  });

  it('upserts the row payload keyed by the user id', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        select: () => ({ limit: () => Promise.resolve({ error: null }) }),
        upsert: (values: Record<string, unknown>) => {
          seen.push(values);
          return Promise.resolve({ error: null });
        },
      }),
    };
    await persistProfileToProfilesTable(client, 'u9', {
      name: 'Silent Bob',
      phone: '+1 555 000 0000',
      email: 'bob@example.com',
    });
    expect(seen[0].id).toBe('u9');
    expect(seen[0].phone).toBe('+1 555 000 0000');
    expect(seen[0].full_name).toBe('Silent Bob');
    expect(seen[0].email).toBe('bob@example.com');
  });

  it('skips silently when the profiles table is absent', async () => {
    const result = await persistProfileToProfilesTable(missingTableClient, 'u1', {
      name: 'Idle Parrot',
      phone: '+1 555 000 001',
    });
    expect(result).toEqual({ persisted: false, error: null });
  });
});

describe('profileErrorMessage', () => {
  it('explains the SMS provider failure', () => {
    expect(profileErrorMessage(new Error('Unable to get SMS provider'))).toContain(
      'saved on your AccountX profile'
    );
  });

  it('handles network failures', () => {
    expect(profileErrorMessage(new Error('Failed to fetch'))).toContain('Network error');
  });

  it('handles expired sessions', () => {
    expect(profileErrorMessage(new Error('Session expired'))).toContain('sign in again');
  });

  it('falls back to a generic message', () => {
    expect(profileErrorMessage(undefined)).toContain('try again');
  });
});
