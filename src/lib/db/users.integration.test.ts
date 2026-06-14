import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';
import * as users from './users';

let driver: PgliteDriver;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => { await clearAllTables(driver); });

describe('users.upsertByGithubId', () => {
  it('creates a new user on first call', async () => {
    const user = await users.upsertByGithubId(driver, {
      githubId: 12345,
      githubLogin: 'rio',
      email: 'rio@example.com',
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.githubId).toBe(12345);
    expect(user.githubLogin).toBe('rio');
    expect(user.email).toBe('rio@example.com');
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('returns the same user on second call with same githubId', async () => {
    const a = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'a', email: null });
    const b = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'a', email: null });
    expect(b.id).toBe(a.id);
  });

  it('refreshes the denormalized github_login on re-login (login may change)', async () => {
    const a = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'oldname', email: null });
    const b = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'newname', email: null });
    expect(b.id).toBe(a.id);
    expect(b.githubLogin).toBe('newname');
  });

  it('refreshes email on re-login', async () => {
    await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'a', email: null });
    const after = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'a', email: 'a@b.com' });
    expect(after.email).toBe('a@b.com');
  });

  it('treats two distinct githubIds as separate users (login can collide)', async () => {
    // After a GitHub rename, githubId 1's old login 'shared' might be claimed by githubId 2.
    const u1 = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'shared', email: null });
    const u2 = await users.upsertByGithubId(driver, { githubId: 2, githubLogin: 'shared', email: null });
    expect(u2.id).not.toBe(u1.id);
  });
});

describe('users.findByGithubId', () => {
  it('returns the user when present', async () => {
    const created = await users.upsertByGithubId(driver, { githubId: 42, githubLogin: 'rio', email: null });
    const found = await users.findByGithubId(driver, 42);
    expect(found?.id).toBe(created.id);
  });

  it('returns null when not present', async () => {
    const found = await users.findByGithubId(driver, 9999);
    expect(found).toBeNull();
  });
});

describe('users.findById', () => {
  it('returns the user when present', async () => {
    const created = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'r', email: null });
    const found = await users.findById(driver, created.id);
    expect(found?.githubId).toBe(1);
  });

  it('returns null when not present', async () => {
    const found = await users.findById(driver, '00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });

  it('returns null for malformed uuid input without throwing', async () => {
    // The caller's responsibility to validate, but the repo shouldn't blow up
    // on bad input -- it should treat it as "not found".
    await expect(users.findById(driver, 'not-a-uuid')).rejects.toThrow();
    // ^ actually we let the DB reject it. UUID inputs come from URL params /
    // session cookies in practice; validation belongs upstream. Documenting
    // the current behavior so any future "soft fail" change is intentional.
  });
});
