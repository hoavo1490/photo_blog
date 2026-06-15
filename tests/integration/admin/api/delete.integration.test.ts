import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../setup/pglite';
import type { PgliteDriver } from '../../../../src/lib/db/pglite-driver';
import * as posts from '../../../../src/lib/db/posts';
import * as sites from '../../../../src/lib/db/sites';
import * as users from '../../../../src/lib/db/users';
import * as imagesRepo from '../../../../src/lib/db/images';
import { POST as deletePOST } from '../../../../src/pages/admin/api/delete';

// In-memory R2 fake. We only need put/get/delete/list/head; the
// production code paths used during delete are delete() only, but
// we keep the others around for assertions.
function makeFakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    async put(key: string, body: Uint8Array) { store.set(key, body); },
    async get(key: string) { return store.has(key) ? { key } : null; },
    async delete(keys: string | string[]) {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) store.delete(k);
    },
    has(key: string) { return store.has(key); },
    keys() { return [...store.keys()]; },
  };
}

let driver: PgliteDriver;
let siteId: string;
let userId: string;
let fakeR2: ReturnType<typeof makeFakeR2>;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  const s = await sites.create(driver, { slug: 'a', name: 'A' });
  siteId = s.id;
  const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
  userId = u.id;
  await sites.addMember(driver, { siteId, userId, role: 'owner' });
  fakeR2 = makeFakeR2();
  (globalThis as unknown as { __RIOVV_TEST_R2__?: unknown }).__RIOVV_TEST_R2__ = fakeR2;
});

function makeCtx(body: unknown): Parameters<typeof deletePOST>[0] {
  const request = new Request('https://admin.test/admin/api/delete', {
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
  } as unknown as Parameters<typeof deletePOST>[0];
}

async function makeImage(opts: { r2Key: string; widths: number[]; hasAvif?: boolean }) {
  // Seed R2 with the primary + every variant key shape upload.ts produces:
  //   <key>.<W>w.jpg, <key>.<W>w.webp, <key>.<W>w.avif (when hasAvif).
  fakeR2.store.set(opts.r2Key, new Uint8Array([1]));
  for (const w of opts.widths) {
    const base = opts.r2Key.replace(/\.(jpe?g|png|webp|gif)$/i, '');
    fakeR2.store.set(`${base}.${w}w.jpg`, new Uint8Array([1]));
    fakeR2.store.set(`${base}.${w}w.webp`, new Uint8Array([1]));
    if (opts.hasAvif) {
      fakeR2.store.set(`${base}.${w}w.avif`, new Uint8Array([1]));
    }
  }
  const row = await imagesRepo.create(driver, {
    siteId, r2Key: opts.r2Key,
    originalName: 'photo.jpg', sizeBytes: 1,
    width: 1600, height: 1200, uploadedBy: userId,
    variantWidths: opts.widths,
  });
  if (opts.hasAvif) {
    await driver.exec(`UPDATE images SET has_avif = true WHERE id = $1`, [row.id]);
  }
  return row;
}

describe('admin/api/delete', () => {
  it('deletes the post row', async () => {
    const p = await posts.createDraft(driver, { siteId, slug: 's', title: 'T', body: '' });
    const res = await deletePOST(makeCtx({ siteId, postId: p.id }));
    expect(res.status).toBe(200);
    expect(await posts.findById(driver, { siteId, id: p.id })).toBeNull();
  });

  it('deletes orphaned images (R2 primary + every variant) and their images rows', async () => {
    const img = await makeImage({
      r2Key: `${siteId}/2026/06/14/abcd1234-photo.jpg`,
      widths: [400, 800, 1200],
      hasAvif: true,
    });
    // Body contains the image token; no other post references it.
    const body = `Here is a pic:\n\n![cat](image:${img.id})\n`;
    const p = await posts.createDraft(driver, {
      siteId, slug: 's', title: 'T', body,
      coverImageId: img.id,
    });

    const res = await deletePOST(makeCtx({ siteId, postId: p.id }));
    expect(res.status).toBe(200);

    // images row gone.
    expect(await imagesRepo.findById(driver, { siteId, id: img.id })).toBeNull();
    // R2 primary + every JPEG/WebP/AVIF variant gone.
    expect(fakeR2.keys().sort()).toEqual([]);
  });

  it('keeps images that are still referenced by another post', async () => {
    const img = await makeImage({
      r2Key: `${siteId}/2026/06/14/abcd1234-photo.jpg`,
      widths: [400, 800],
    });
    const a = await posts.createDraft(driver, {
      siteId, slug: 'a', title: 'A', body: `![](image:${img.id})`,
    });
    const b = await posts.createDraft(driver, {
      siteId, slug: 'b', title: 'B', body: `![](image:${img.id})`,
    });

    const res = await deletePOST(makeCtx({ siteId, postId: a.id }));
    expect(res.status).toBe(200);

    // images row preserved -- still referenced by `b`.
    expect((await imagesRepo.findById(driver, { siteId, id: img.id }))?.id).toBe(img.id);
    // R2 objects preserved too.
    expect(fakeR2.has(img.r2Key)).toBe(true);

    // Cleanup b -- now nobody references the image; it should go away.
    await deletePOST(makeCtx({ siteId, postId: b.id }));
    expect(await imagesRepo.findById(driver, { siteId, id: img.id })).toBeNull();
    expect(fakeR2.has(img.r2Key)).toBe(false);
  });

  it('cleans up the cover image when the post is the only thing referencing it', async () => {
    const img = await makeImage({
      r2Key: `${siteId}/2026/06/14/aaaaaaaa-cover.jpg`,
      widths: [400],
    });
    const p = await posts.createDraft(driver, {
      siteId, slug: 's', title: 'T', body: '',
      coverImageId: img.id,
    });

    const res = await deletePOST(makeCtx({ siteId, postId: p.id }));
    expect(res.status).toBe(200);
    expect(await imagesRepo.findById(driver, { siteId, id: img.id })).toBeNull();
    expect(fakeR2.has(img.r2Key)).toBe(false);
  });

  it('keeps images that are referenced by a different SITE (defense in depth)', async () => {
    const img = await makeImage({
      r2Key: `${siteId}/2026/06/14/abcd1234-photo.jpg`,
      widths: [400],
    });
    const p1 = await posts.createDraft(driver, {
      siteId, slug: 'a', title: 'A', body: `![](image:${img.id})`,
    });

    // Different site, same image id reference token in body -- should NOT
    // count, because the image belongs to siteId.
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    await posts.createDraft(driver, {
      siteId: s2.id, slug: 'a', title: 'A', body: `![](image:${img.id})`,
    });

    const res = await deletePOST(makeCtx({ siteId, postId: p1.id }));
    expect(res.status).toBe(200);
    // Only siteId's references count. p1 was the lone same-site referer.
    expect(await imagesRepo.findById(driver, { siteId, id: img.id })).toBeNull();
  });
});
