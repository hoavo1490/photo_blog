import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../setup/pglite';
import type { PgliteDriver } from '../../../../src/lib/db/pglite-driver';
import * as sites from '../../../../src/lib/db/sites';
import * as pages from '../../../../src/lib/db/pages';

// Cover the `pages` repo: single-row-per-(site, slug) editable content for
// the about/contact/legal-style pages that aren't part of the date-stamped
// posts collection. The editor writes here; the public route reads from
// here. Multi-tenant: two sites can hold an "about" without colliding.

let driver: PgliteDriver;
let siteA: string;
let siteB: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  siteA = (await sites.create(driver, { slug: 'a', name: 'A' })).id;
  siteB = (await sites.create(driver, { slug: 'b', name: 'B' })).id;
});

describe('pages repo', () => {
  it('findPage returns null when the slug does not exist for the site', async () => {
    const out = await pages.findPage(driver, { siteId: siteA, slug: 'about' });
    expect(out).toBeNull();
  });

  it('upsertPage creates a fresh row when no page exists for the slug', async () => {
    const out = await pages.upsertPage(driver, {
      siteId: siteA, slug: 'about', body: 'hello world',
    });
    expect(out.siteId).toBe(siteA);
    expect(out.slug).toBe('about');
    expect(out.body).toBe('hello world');
    expect(out.updatedAt).toBeInstanceOf(Date);
  });

  it('upsertPage overwrites the existing row for the same (site, slug)', async () => {
    await pages.upsertPage(driver, { siteId: siteA, slug: 'about', body: 'v1' });
    const second = await pages.upsertPage(driver, {
      siteId: siteA, slug: 'about', body: 'v2',
    });
    expect(second.body).toBe('v2');
    // Only one row exists for (siteA, about) -- subsequent reads see v2.
    const out = await pages.findPage(driver, { siteId: siteA, slug: 'about' });
    expect(out?.body).toBe('v2');
  });

  it('upsertPage refreshes updated_at on every write', async () => {
    const first = await pages.upsertPage(driver, {
      siteId: siteA, slug: 'about', body: 'v1',
    });
    // Wait long enough that millisecond timestamps differ on any sane clock.
    await new Promise((r) => setTimeout(r, 10));
    const second = await pages.upsertPage(driver, {
      siteId: siteA, slug: 'about', body: 'v2',
    });
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it('is scoped by site -- two tenants can hold the same slug independently', async () => {
    await pages.upsertPage(driver, { siteId: siteA, slug: 'about', body: 'A about' });
    await pages.upsertPage(driver, { siteId: siteB, slug: 'about', body: 'B about' });
    const a = await pages.findPage(driver, { siteId: siteA, slug: 'about' });
    const b = await pages.findPage(driver, { siteId: siteB, slug: 'about' });
    expect(a?.body).toBe('A about');
    expect(b?.body).toBe('B about');
  });

  it('findPage does not leak across sites with the same slug', async () => {
    await pages.upsertPage(driver, { siteId: siteA, slug: 'about', body: 'A only' });
    const fromB = await pages.findPage(driver, { siteId: siteB, slug: 'about' });
    expect(fromB).toBeNull();
  });
});
