import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../setup/pglite';
import type { PgliteDriver } from '../../../src/lib/db/pglite-driver';
import * as posts from '../../../src/lib/db/posts';
import * as sites from '../../../src/lib/db/sites';
import * as tagsRepo from '../../../src/lib/db/tags';
import { GET } from '../../../src/pages/sitemap.xml';

let driver: PgliteDriver;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => { await clearAllTables(driver); });

function ctxFor(tenant: { id: string; customDomain?: string | null; name: string }) {
  return {
    locals: { tenant: { ...tenant, customDomain: tenant.customDomain ?? null }, db: driver },
    url: new URL('https://riovv.test/sitemap.xml'),
  } as unknown as Parameters<typeof GET>[0];
}

describe('sitemap.xml', () => {
  it('lists extensionless static routes (no .html — those 404)', async () => {
    const site = await sites.create(driver, { slug: 'a', name: 'riovv' });
    const res = await GET(ctxFor(site));
    const xml = await res.text();

    expect(xml).toContain('<loc>https://riovv.test/archive</loc>');
    expect(xml).toContain('<loc>https://riovv.test/tags</loc>');
    expect(xml).toContain('<loc>https://riovv.test/about</loc>');
    expect(xml).not.toContain('/archive.html');
    expect(xml).not.toContain('/tags.html');
    expect(xml).not.toContain('/about.html');
  });

  it('includes per-tag URLs for tags with published posts', async () => {
    const site = await sites.create(driver, { slug: 'a', name: 'riovv' });
    const draft = await posts.createDraft(driver, {
      siteId: site.id,
      slug: 'hello',
      title: 'Hello',
      body: 'body',
    });
    await tagsRepo.setPostTags(driver, {
      siteId: site.id,
      postId: draft.id,
      tagNames: ['Photography', 'Hà Nội'],
    });
    await posts.publish(driver, { siteId: site.id, id: draft.id });

    const res = await GET(ctxFor(site));
    const xml = await res.text();

    expect(xml).toContain('<loc>https://riovv.test/tags/photography</loc>');
    expect(xml).toContain('<loc>https://riovv.test/tags/ha-noi</loc>');
  });

  it('skips tags that have no published posts', async () => {
    const site = await sites.create(driver, { slug: 'a', name: 'riovv' });
    const draft = await posts.createDraft(driver, {
      siteId: site.id,
      slug: 'hello',
      title: 'Hello',
      body: 'body',
    });
    // Tag attached, but never published.
    await tagsRepo.setPostTags(driver, {
      siteId: site.id,
      postId: draft.id,
      tagNames: ['Orphan'],
    });

    const res = await GET(ctxFor(site));
    const xml = await res.text();

    expect(xml).not.toContain('/tags/orphan');
  });
});
