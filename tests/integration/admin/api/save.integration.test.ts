import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../setup/pglite';
import type { PgliteDriver } from '../../../../src/lib/db/pglite-driver';
import * as posts from '../../../../src/lib/db/posts';
import * as sites from '../../../../src/lib/db/sites';
import * as users from '../../../../src/lib/db/users';
import * as tags from '../../../../src/lib/db/tags';
import { POST as savePOST } from '../../../../src/pages/admin/api/save';

// Direct invocation of the save.ts APIRoute against PGLite. We stub the
// `ctx.locals` shape rather than threading through the full middleware --
// the route is a thin function and integration coverage is what matters.

let driver: PgliteDriver;
let siteId: string;
let userId: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  const s = await sites.create(driver, { slug: 'a', name: 'A' });
  siteId = s.id;
  const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
  userId = u.id;
  await sites.addMember(driver, { siteId, userId, role: 'owner' });
});

function makeCtx(body: unknown): Parameters<typeof savePOST>[0] {
  const request = new Request('https://admin.test/admin/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    request,
    locals: {
      db: driver,
      session: { sessionId: 'sid', userId, githubLogin: 'rio' },
    },
    // The rest of APIContext fields we don't touch.
  } as unknown as Parameters<typeof savePOST>[0];
}

describe('admin/api/save', () => {
  it('creating a new post: stamps published_at from the form date', async () => {
    const res = await savePOST(makeCtx({
      mode: 'new', postId: null, siteId,
      title: 'Hello', body: 'world',
      date: '2024-03-04', tagNames: [],
    }));
    expect(res.status).toBe(200);
    const { id } = await (res as Response).json() as { id: string };
    const p = await posts.findById(driver, { siteId, id });
    expect(p?.status).toBe('published');
    expect(p?.publishedAt?.toISOString()).toBe('2024-03-04T12:00:00.000Z');
  });

  it('editing a published post WITHOUT changing the date leaves published_at unchanged', async () => {
    // Create + publish at a known back-date.
    const created = await posts.createDraft(driver, { siteId, slug: 'fixed', title: 'T', body: '' });
    const origPublishedAt = new Date('2024-03-04T12:00:00Z');
    await posts.publish(driver, { siteId, id: created.id, publishedAt: origPublishedAt });

    // Editor reopens the form -- the form's date input defaults to the post's
    // existing publishedAt (YYYY-MM-DD slice). Save round-trips that value.
    const res = await savePOST(makeCtx({
      mode: 'edit', postId: created.id, siteId,
      title: 'T (edited)', body: 'new body',
      date: origPublishedAt.toISOString().slice(0, 10),
      tagNames: [],
    }));
    expect(res.status).toBe(200);

    const reread = await posts.findById(driver, { siteId, id: created.id });
    expect(reread?.title).toBe('T (edited)');
    expect(reread?.body).toBe('new body');
    expect(reread?.publishedAt?.toISOString()).toBe(origPublishedAt.toISOString());
  });

  it('editing a published post when the form has today (the PostForm default) does not move published_at', async () => {
    // Repro for the actual bug: PostForm.astro line 10 defaults the date
    // input to `today` when initial.publishedAt is missing in the partial.
    // If a caller submits {date: today} for an already-published post, we
    // must NOT silently re-stamp published_at.
    const created = await posts.createDraft(driver, { siteId, slug: 'p', title: 'T', body: '' });
    const origPublishedAt = new Date('2023-11-22T12:00:00Z');
    await posts.publish(driver, { siteId, id: created.id, publishedAt: origPublishedAt });

    const today = new Date().toISOString().slice(0, 10);
    const res = await savePOST(makeCtx({
      mode: 'edit', postId: created.id, siteId,
      title: 'T', body: 'body', date: today, tagNames: [],
    }));
    expect(res.status).toBe(200);

    const reread = await posts.findById(driver, { siteId, id: created.id });
    expect(reread?.publishedAt?.toISOString()).toBe(origPublishedAt.toISOString());
  });

  it('editing a draft does not silently publish it', async () => {
    const created = await posts.createDraft(driver, { siteId, slug: 'd', title: 'D', body: '' });
    const res = await savePOST(makeCtx({
      mode: 'edit', postId: created.id, siteId,
      title: 'D2', body: 'b',
      date: new Date().toISOString().slice(0, 10),
      tagNames: [],
    }));
    expect(res.status).toBe(200);
    const reread = await posts.findById(driver, { siteId, id: created.id });
    expect(reread?.status).toBe('draft');
    expect(reread?.publishedAt).toBeNull();
  });

  it('writes tag set on save', async () => {
    const res = await savePOST(makeCtx({
      mode: 'new', postId: null, siteId,
      title: 'T', body: '',
      date: '2024-01-01', tagNames: ['leica', 'film'],
    }));
    const { id } = await (res as Response).json() as { id: string };
    const set = await tags.listForPost(driver, { siteId, postId: id });
    expect(set.map((t) => t.slug).sort()).toEqual(['film', 'leica']);
  });
});
