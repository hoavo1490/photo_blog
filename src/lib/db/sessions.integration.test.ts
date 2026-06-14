import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';
import * as sessions from './sessions';
import * as users from './users';

let driver: PgliteDriver;
let userId: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
  userId = u.id;
});

describe('sessions.create', () => {
  it('persists a session and returns it with the generated id', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const s = await sessions.create(driver, { userId, expiresAt: future, userAgent: 'unit-test/1' });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.userId).toBe(userId);
    expect(s.expiresAt.getTime()).toBe(future.getTime());
    expect(s.userAgent).toBe('unit-test/1');
    expect(s.revokedAt).toBeNull();
  });

  it('allows null userAgent', async () => {
    const s = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 1000) });
    expect(s.userAgent).toBeNull();
  });
});

describe('sessions.findActive', () => {
  it('returns the session for a live, unrevoked id', async () => {
    const created = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 60_000) });
    const found = await sessions.findActive(driver, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('returns null after expiry', async () => {
    const created = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() - 1000) });
    expect(await sessions.findActive(driver, created.id)).toBeNull();
  });

  it('returns null after revoke', async () => {
    const created = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 60_000) });
    await sessions.revoke(driver, created.id);
    expect(await sessions.findActive(driver, created.id)).toBeNull();
  });

  it('returns null for unknown id', async () => {
    expect(await sessions.findActive(driver, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('sessions.touch', () => {
  it('updates last_used_at', async () => {
    const created = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 60_000) });
    await new Promise((r) => setTimeout(r, 10));
    await sessions.touch(driver, created.id);
    const fresh = await sessions.findActive(driver, created.id);
    expect(fresh).not.toBeNull();
    expect(fresh!.lastUsedAt.getTime()).toBeGreaterThan(created.lastUsedAt.getTime());
  });

  it('is a no-op on revoked sessions', async () => {
    const created = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 60_000) });
    await sessions.revoke(driver, created.id);
    await sessions.touch(driver, created.id); // doesn't throw
    expect(await sessions.findActive(driver, created.id)).toBeNull();
  });
});

describe('sessions.revokeAllForUser', () => {
  it('revokes every active session for the user, leaves others alone', async () => {
    const u2 = await users.upsertByGithubId(driver, { githubId: 2, githubLogin: 'alice', email: null });
    const a = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 60_000) });
    const b = await sessions.create(driver, { userId, expiresAt: new Date(Date.now() + 60_000) });
    const c = await sessions.create(driver, { userId: u2.id, expiresAt: new Date(Date.now() + 60_000) });

    await sessions.revokeAllForUser(driver, userId);

    expect(await sessions.findActive(driver, a.id)).toBeNull();
    expect(await sessions.findActive(driver, b.id)).toBeNull();
    expect((await sessions.findActive(driver, c.id))?.id).toBe(c.id);
  });
});
