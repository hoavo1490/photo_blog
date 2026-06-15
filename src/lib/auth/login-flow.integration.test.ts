import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import { makeFakeGitHubOAuth } from '../../../tests/fakes/github-oauth';
import type { PgliteDriver } from '../db/pglite-driver';
import { completeLogin, loadSession } from './login-flow';
import * as sessions from '../db/sessions';

let driver: PgliteDriver;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => { await clearAllTables(driver); });

const baseInput = {
  code: 'good',
  redirectUri: 'https://admin.example.com/auth/callback',
  userAgent: 'integration-test/1',
};

describe('completeLogin', () => {
  it('upserts the user and creates a session with a future expiry (happy path)', async () => {
    const oauth = makeFakeGitHubOAuth();
    const before = Date.now();
    const result = await completeLogin(driver, oauth, [], baseInput);
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(before + 29 * 86_400_000);

    const userRows = await driver.query<{ count: string }>('SELECT count(*) FROM users');
    expect(Number(userRows[0].count)).toBe(1);
  });

  it('reuses the existing user row on a second login by the same github_id', async () => {
    const oauth = makeFakeGitHubOAuth();
    const a = await completeLogin(driver, oauth, [], baseInput);
    const b = await completeLogin(driver, oauth, [], baseInput);
    expect(b.userId).toBe(a.userId);
    expect(b.sessionId).not.toBe(a.sessionId); // each login => fresh session

    const userRows = await driver.query<{ count: string }>('SELECT count(*) FROM users');
    expect(Number(userRows[0].count)).toBe(1);
  });

  it('succeeds when the allowlist includes the github login', async () => {
    const oauth = makeFakeGitHubOAuth();
    const result = await completeLogin(driver, oauth, ['rio'], baseInput);
    expect(result.userId).toBeTruthy();
  });

  it('throws "not allowed" when the allowlist excludes the github login', async () => {
    const oauth = makeFakeGitHubOAuth();
    await expect(
      completeLogin(driver, oauth, ['someone-else'], baseInput),
    ).rejects.toThrow(/not allowed/);
  });

  it('with empty allowlist allows everyone', async () => {
    const oauth = makeFakeGitHubOAuth({
      users: { good: { id: 999, login: 'random-user', email: null } },
    });
    const result = await completeLogin(driver, oauth, [], baseInput);
    expect(result.userId).toBeTruthy();
  });

  it('normalizes case in allowlist check (allowlist [rio], login Rio -> allowed)', async () => {
    const oauth = makeFakeGitHubOAuth({
      users: { good: { id: 7, login: 'Rio', email: null } },
    });
    const result = await completeLogin(driver, oauth, ['rio'], baseInput);
    expect(result.userId).toBeTruthy();
  });
});

describe('loadSession', () => {
  it('returns sessionId/userId/githubLogin for a valid session', async () => {
    const oauth = makeFakeGitHubOAuth();
    const login = await completeLogin(driver, oauth, [], baseInput);
    const loaded = await loadSession(driver, login.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(login.sessionId);
    expect(loaded!.userId).toBe(login.userId);
    expect(loaded!.githubLogin).toBe('rio');
  });

  it('returns null for a revoked session', async () => {
    const oauth = makeFakeGitHubOAuth();
    const login = await completeLogin(driver, oauth, [], baseInput);
    await sessions.revoke(driver, login.sessionId);
    expect(await loadSession(driver, login.sessionId)).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const oauth = makeFakeGitHubOAuth();
    const login = await completeLogin(driver, oauth, [], baseInput);
    // Force expiry by direct UPDATE (the public API only creates future
    // expiries; this is the cleanest way to simulate elapsed time).
    await driver.exec(
      `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [login.sessionId],
    );
    expect(await loadSession(driver, login.sessionId)).toBeNull();
  });

  it('returns null for a nonexistent session id', async () => {
    expect(
      await loadSession(driver, '00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });

  it('wraps the touch update in waitUntil when a context is provided', async () => {
    const oauth = makeFakeGitHubOAuth();
    const login = await completeLogin(driver, oauth, [], baseInput);

    // Capture the work passed to waitUntil; on Workers this is how
    // post-response work survives the response being sent.
    const pending: Promise<unknown>[] = [];
    const waitUntil = (p: Promise<unknown>) => { pending.push(p); };

    const loaded = await loadSession(driver, login.sessionId, waitUntil);
    expect(loaded).not.toBeNull();
    expect(pending.length).toBe(1);

    // Await the deferred work and observe that last_used_at advanced.
    const beforeRow = await driver.query<{ last_used_at: string }>(
      `SELECT last_used_at FROM sessions WHERE id = $1`,
      [login.sessionId],
    );
    await Promise.all(pending);
    const afterRow = await driver.query<{ last_used_at: string }>(
      `SELECT last_used_at FROM sessions WHERE id = $1`,
      [login.sessionId],
    );
    expect(new Date(afterRow[0].last_used_at).getTime())
      .toBeGreaterThanOrEqual(new Date(beforeRow[0].last_used_at).getTime());
  });

  it('still touches (fire-and-forget) when no waitUntil is provided', async () => {
    // Back-compat: callers that omit the ctx parameter (tests, future
    // non-Worker callers) get the previous fire-and-forget behavior.
    const oauth = makeFakeGitHubOAuth();
    const login = await completeLogin(driver, oauth, [], baseInput);
    const loaded = await loadSession(driver, login.sessionId);
    expect(loaded).not.toBeNull();
  });
});
