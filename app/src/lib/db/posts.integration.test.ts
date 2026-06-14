import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';
import * as posts from './posts';
import * as sites from './sites';

let driver: PgliteDriver;
let siteA: string;
let siteB: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  const a = await sites.create(driver, { slug: 'a', name: 'A', customDomain: 'a.test' });
  const b = await sites.create(driver, { slug: 'b', name: 'B', customDomain: 'b.test' });
  siteA = a.id;
  siteB = b.id;
});

describe('posts.createDraft', () => {
  it('persists a draft with defaults', async () => {
    const p = await posts.createDraft(driver, {
      siteId: siteA, slug: 'hi', title: 'Hi', body: 'hello',
    });
    expect(p.siteId).toBe(siteA);
    expect(p.slug).toBe('hi');
    expect(p.title).toBe('Hi');
    expect(p.body).toBe('hello');
    expect(p.status).toBe('draft');
    expect(p.publishedAt).toBeNull();
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects duplicate (site_id, slug)', async () => {
    await posts.createDraft(driver, { siteId: siteA, slug: 'x', title: 'A', body: '' });
    await expect(
      posts.createDraft(driver, { siteId: siteA, slug: 'x', title: 'B', body: '' })
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('allows the same slug across different sites', async () => {
    const a = await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'A', body: '' });
    const b = await posts.createDraft(driver, { siteId: siteB, slug: 'hi', title: 'B', body: '' });
    expect(a.slug).toBe('hi');
    expect(b.slug).toBe('hi');
    expect(a.id).not.toBe(b.id);
  });
});

describe('posts.publish', () => {
  it('flips status to published and stamps publishedAt to now by default', async () => {
    const draft = await posts.createDraft(driver, { siteId: siteA, slug: 'p', title: 'P', body: '' });
    const before = Date.now();
    const published = await posts.publish(driver, { siteId: siteA, id: draft.id });
    expect(published).not.toBeNull();
    expect(published!.status).toBe('published');
    expect(published!.publishedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('honors an explicit publishedAt (back-dating)', async () => {
    const draft = await posts.createDraft(driver, { siteId: siteA, slug: 'bd', title: 'BD', body: '' });
    const when = new Date('2024-01-15T00:00:00Z');
    const published = await posts.publish(driver, { siteId: siteA, id: draft.id, publishedAt: when });
    expect(published).not.toBeNull();
    expect(published!.publishedAt?.toISOString()).toBe(when.toISOString());
  });

  it('refuses to publish a post belonging to a different site', async () => {
    const draft = await posts.createDraft(driver, { siteId: siteA, slug: 'p', title: 'P', body: '' });
    const result = await posts.publish(driver, { siteId: siteB, id: draft.id });
    expect(result).toBeNull();
    const reread = await posts.findById(driver, { siteId: siteA, id: draft.id });
    expect(reread?.status).toBe('draft');
  });
});

describe('posts.findBySlug + tenant scoping', () => {
  it('finds the right post within a site', async () => {
    const a = await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'A', body: '' });
    const found = await posts.findBySlug(driver, { siteId: siteA, slug: 'hi' });
    expect(found?.id).toBe(a.id);
  });

  it('returns null when slug exists in a different site', async () => {
    await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'A', body: '' });
    const found = await posts.findBySlug(driver, { siteId: siteB, slug: 'hi' });
    expect(found).toBeNull();
  });
});

describe('posts.findByPath', () => {
  it('locates a published post by /YYYY/MM/DD/slug', async () => {
    const draft = await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'Hi', body: '' });
    await posts.publish(driver, {
      siteId: siteA, id: draft.id,
      publishedAt: new Date('2026-06-14T12:00:00Z'),
    });
    const found = await posts.findByPath(driver, {
      siteId: siteA, year: '2026', month: '06', day: '14', slug: 'hi',
    });
    expect(found?.id).toBe(draft.id);
  });

  it('returns null for a draft (only published posts have URL-resolvable paths)', async () => {
    const draft = await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'Hi', body: '' });
    // Even though slug matches today's date, draft must not resolve via URL.
    const today = new Date();
    const found = await posts.findByPath(driver, {
      siteId: siteA,
      year: String(today.getUTCFullYear()),
      month: String(today.getUTCMonth() + 1).padStart(2, '0'),
      day: String(today.getUTCDate()).padStart(2, '0'),
      slug: 'hi',
    });
    expect(found).toBeNull();
  });

  it('returns null when the date components do not match', async () => {
    const draft = await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'Hi', body: '' });
    await posts.publish(driver, {
      siteId: siteA, id: draft.id,
      publishedAt: new Date('2026-06-14T12:00:00Z'),
    });
    const found = await posts.findByPath(driver, {
      siteId: siteA, year: '2026', month: '06', day: '15', slug: 'hi',
    });
    expect(found).toBeNull();
  });
});

describe('posts.listPublished', () => {
  it('returns only published posts for the site, newest first', async () => {
    const d1 = await posts.createDraft(driver, { siteId: siteA, slug: 'old', title: 'Old', body: '' });
    const d2 = await posts.createDraft(driver, { siteId: siteA, slug: 'new', title: 'New', body: '' });
    const d3 = await posts.createDraft(driver, { siteId: siteA, slug: 'draft', title: 'Draft', body: '' });
    await posts.publish(driver, { siteId: siteA, id: d1.id, publishedAt: new Date('2024-01-01T00:00:00Z') });
    await posts.publish(driver, { siteId: siteA, id: d2.id, publishedAt: new Date('2026-06-01T00:00:00Z') });
    // d3 stays draft.

    const list = await posts.listPublished(driver, { siteId: siteA });
    expect(list.map((p) => p.slug)).toEqual(['new', 'old']);
  });

  it('respects limit + offset', async () => {
    for (let i = 0; i < 5; i++) {
      const d = await posts.createDraft(driver, { siteId: siteA, slug: `p${i}`, title: `P${i}`, body: '' });
      await posts.publish(driver, {
        siteId: siteA, id: d.id,
        publishedAt: new Date(2026, 0, 1 + i),
      });
    }
    const page1 = await posts.listPublished(driver, { siteId: siteA, limit: 2, offset: 0 });
    const page2 = await posts.listPublished(driver, { siteId: siteA, limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0].id).not.toBe(page2[0].id);
  });

  it('does not leak posts across sites', async () => {
    const d = await posts.createDraft(driver, { siteId: siteA, slug: 'hi', title: 'Hi', body: '' });
    await posts.publish(driver, { siteId: siteA, id: d.id });
    const list = await posts.listPublished(driver, { siteId: siteB });
    expect(list).toEqual([]);
  });
});

describe('posts.update', () => {
  it('updates given fields and bumps updated_at', async () => {
    const p = await posts.createDraft(driver, { siteId: siteA, slug: 's', title: 'Old', body: 'old body' });
    await new Promise((r) => setTimeout(r, 10));
    const updated = await posts.update(driver, {
      siteId: siteA, id: p.id,
      title: 'New', body: 'new body', description: 'desc',
    });
    expect(updated?.title).toBe('New');
    expect(updated?.body).toBe('new body');
    expect(updated?.description).toBe('desc');
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(p.updatedAt.getTime());
  });

  it('refuses to update a post belonging to a different site', async () => {
    const p = await posts.createDraft(driver, { siteId: siteA, slug: 's', title: 'A', body: '' });
    const result = await posts.update(driver, { siteId: siteB, id: p.id, title: 'B' });
    expect(result).toBeNull();
    const fresh = await posts.findById(driver, { siteId: siteA, id: p.id });
    expect(fresh?.title).toBe('A');
  });

  it('leaves untouched fields alone', async () => {
    const p = await posts.createDraft(driver, { siteId: siteA, slug: 's', title: 'T', body: 'b', description: 'd' });
    const updated = await posts.update(driver, { siteId: siteA, id: p.id, title: 'T2' });
    expect(updated?.body).toBe('b');
    expect(updated?.description).toBe('d');
  });
});

describe('posts.delete', () => {
  it('removes the post', async () => {
    const p = await posts.createDraft(driver, { siteId: siteA, slug: 's', title: 'X', body: '' });
    await posts.del(driver, { siteId: siteA, id: p.id });
    expect(await posts.findById(driver, { siteId: siteA, id: p.id })).toBeNull();
  });

  it('does not delete a post in a different site', async () => {
    const p = await posts.createDraft(driver, { siteId: siteA, slug: 's', title: 'X', body: '' });
    await posts.del(driver, { siteId: siteB, id: p.id });
    expect((await posts.findById(driver, { siteId: siteA, id: p.id }))?.id).toBe(p.id);
  });
});
