import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';
import * as tags from './tags';
import * as posts from './posts';
import * as sites from './sites';

let driver: PgliteDriver;
let siteId: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  const s = await sites.create(driver, { slug: 'a', name: 'A' });
  siteId = s.id;
});

describe('tags.findOrCreate', () => {
  it('creates a new tag, lowercases slug, preserves display name', async () => {
    const t = await tags.findOrCreate(driver, { siteId, name: 'Photography' });
    expect(t.name).toBe('Photography');
    expect(t.slug).toBe('photography');
  });

  it('returns the existing tag on case-insensitive name collision', async () => {
    const a = await tags.findOrCreate(driver, { siteId, name: 'Photography' });
    const b = await tags.findOrCreate(driver, { siteId, name: 'PHOTOGRAPHY' });
    const c = await tags.findOrCreate(driver, { siteId, name: 'photography' });
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    // Display name from the first call wins -- not overwritten.
    expect(c.name).toBe('Photography');
  });

  it('isolates tags per site', async () => {
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    const t1 = await tags.findOrCreate(driver, { siteId, name: 'rio' });
    const t2 = await tags.findOrCreate(driver, { siteId: s2.id, name: 'rio' });
    expect(t1.id).not.toBe(t2.id);
  });

  it('produces stable slugs for diacritics (uses slugify)', async () => {
    const t = await tags.findOrCreate(driver, { siteId, name: 'Hà Nội' });
    expect(t.slug).toBe('ha-noi');
  });
});

describe('tags.setPostTags', () => {
  it('replaces the post tag set on each call', async () => {
    const p = await posts.createDraft(driver, { siteId, slug: 'p', title: 'P', body: '' });

    await tags.setPostTags(driver, { siteId, postId: p.id, tagNames: ['leica', 'film'] });
    let current = await tags.listForPost(driver, { siteId, postId: p.id });
    expect(current.map((t) => t.slug).sort()).toEqual(['film', 'leica']);

    await tags.setPostTags(driver, { siteId, postId: p.id, tagNames: ['leica', 'photography'] });
    current = await tags.listForPost(driver, { siteId, postId: p.id });
    expect(current.map((t) => t.slug).sort()).toEqual(['leica', 'photography']);
  });

  it('clears all tags when the input is empty', async () => {
    const p = await posts.createDraft(driver, { siteId, slug: 'p', title: 'P', body: '' });
    await tags.setPostTags(driver, { siteId, postId: p.id, tagNames: ['a', 'b'] });
    await tags.setPostTags(driver, { siteId, postId: p.id, tagNames: [] });
    expect(await tags.listForPost(driver, { siteId, postId: p.id })).toEqual([]);
  });

  it('refuses to set tags on a post that does not belong to the site', async () => {
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    const p = await posts.createDraft(driver, { siteId: s2.id, slug: 'p', title: 'P', body: '' });
    await expect(
      tags.setPostTags(driver, { siteId, postId: p.id, tagNames: ['leica'] })
    ).rejects.toThrow();
  });

  it('is atomic: a mid-flight failure must not leave tags partially deleted', async () => {
    // Seed the post with tags A + B.
    const p = await posts.createDraft(driver, { siteId, slug: 'p', title: 'P', body: '' });
    await tags.setPostTags(driver, { siteId, postId: p.id, tagNames: ['a', 'b'] });
    expect(
      (await tags.listForPost(driver, { siteId, postId: p.id })).map((t) => t.slug).sort(),
    ).toEqual(['a', 'b']);

    // Wrap the driver so the rewrite path fails partway. Each Neon HTTP
    // request is its own transaction, so a failure between DELETE and
    // the subsequent INSERTs corrupts state. We simulate that: let the
    // DELETE succeed, then make the next INSERT into post_tags throw.
    const fragile = {
      query: driver.query.bind(driver),
      exec: async (text: string, params?: unknown[]) => {
        if (/INSERT\s+INTO\s+post_tags/i.test(text)) {
          throw new Error('induced failure');
        }
        return driver.exec(text, params);
      },
    };
    await expect(
      tags.setPostTags(fragile, { siteId, postId: p.id, tagNames: ['c', 'd'] }),
    ).rejects.toThrow(/induced failure/);

    // The original set must still be present; we must not have left the
    // post tagless (partial DELETE + no INSERTs).
    const after = await tags.listForPost(driver, { siteId, postId: p.id });
    expect(after.map((t) => t.slug).sort()).toEqual(['a', 'b']);
  });
});

describe('tags.listForSite', () => {
  it('returns tags with usage counts, only published posts counted', async () => {
    const p1 = await posts.createDraft(driver, { siteId, slug: 'a', title: 'A', body: '' });
    const p2 = await posts.createDraft(driver, { siteId, slug: 'b', title: 'B', body: '' });
    const p3 = await posts.createDraft(driver, { siteId, slug: 'c', title: 'C', body: '' });
    await posts.publish(driver, { siteId, id: p1.id });
    await posts.publish(driver, { siteId, id: p2.id });
    // p3 stays draft

    await tags.setPostTags(driver, { siteId, postId: p1.id, tagNames: ['leica', 'film'] });
    await tags.setPostTags(driver, { siteId, postId: p2.id, tagNames: ['leica'] });
    await tags.setPostTags(driver, { siteId, postId: p3.id, tagNames: ['leica'] });

    const list = await tags.listForSite(driver, { siteId });
    const byTag = Object.fromEntries(list.map((t) => [t.slug, t.publishedCount]));
    expect(byTag.leica).toBe(2);
    expect(byTag.film).toBe(1);
  });

  it('does not leak across sites', async () => {
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    const p = await posts.createDraft(driver, { siteId: s2.id, slug: 'x', title: 'X', body: '' });
    await posts.publish(driver, { siteId: s2.id, id: p.id });
    await tags.setPostTags(driver, { siteId: s2.id, postId: p.id, tagNames: ['leica'] });
    expect(await tags.listForSite(driver, { siteId })).toEqual([]);
  });
});

describe('tags.findBySlug', () => {
  it('returns the tag when present', async () => {
    await tags.findOrCreate(driver, { siteId, name: 'Photography' });
    const found = await tags.findBySlug(driver, { siteId, slug: 'photography' });
    expect(found?.name).toBe('Photography');
  });

  it('returns null when not present', async () => {
    expect(await tags.findBySlug(driver, { siteId, slug: 'nope' })).toBeNull();
  });
});
