import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../setup/pglite';
import type { PgliteDriver } from '../../../../src/lib/db/pglite-driver';
import * as sites from '../../../../src/lib/db/sites';
import * as users from '../../../../src/lib/db/users';
import * as pages from '../../../../src/lib/db/pages';
import { POST as savePagePOST } from '../../../../src/pages/admin/api/save-page';

let driver: PgliteDriver;
let siteId: string;
let userId: string;
let outsiderUserId: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  siteId = (await sites.create(driver, { slug: 'a', name: 'A' })).id;
  userId = (await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null })).id;
  outsiderUserId = (await users.upsertByGithubId(driver, { githubId: 2, githubLogin: 'outsider', email: null })).id;
  await sites.addMember(driver, { siteId, userId, role: 'owner' });
});

function makeCtx(body: unknown, opts: { userId?: string; session?: boolean } = {}) {
  const request = new Request('https://admin.test/admin/api/save-page', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    request,
    locals: {
      db: driver,
      session: opts.session === false
        ? null
        : { sessionId: 'sid', userId: opts.userId ?? userId, githubLogin: 'rio' },
    },
  } as unknown as Parameters<typeof savePagePOST>[0];
}

describe('admin/api/save-page', () => {
  it('creates a page when none exists for the slug', async () => {
    const res = await savePagePOST(makeCtx({
      siteId, slug: 'about', body: 'hello world',
    }));
    expect(res.status).toBe(200);
    const reread = await pages.findPage(driver, { siteId, slug: 'about' });
    expect(reread?.body).toBe('hello world');
  });

  it('overwrites the existing page on subsequent saves', async () => {
    await pages.upsertPage(driver, { siteId, slug: 'about', body: 'v1' });
    const res = await savePagePOST(makeCtx({
      siteId, slug: 'about', body: 'v2',
    }));
    expect(res.status).toBe(200);
    const reread = await pages.findPage(driver, { siteId, slug: 'about' });
    expect(reread?.body).toBe('v2');
  });

  it('returns 401 when no session is attached', async () => {
    const res = await savePagePOST(makeCtx(
      { siteId, slug: 'about', body: 'x' },
      { session: false },
    ));
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is not a member of the site', async () => {
    const res = await savePagePOST(makeCtx(
      { siteId, slug: 'about', body: 'x' },
      { userId: outsiderUserId },
    ));
    expect(res.status).toBe(403);
  });

  it('rejects slugs outside the safe character set', async () => {
    const res = await savePagePOST(makeCtx({
      siteId, slug: '../etc/passwd', body: 'x',
    }));
    expect(res.status).toBe(400);
  });

  it('rejects missing slug', async () => {
    const res = await savePagePOST(makeCtx({ siteId, body: 'x' }));
    expect(res.status).toBe(400);
  });
});
