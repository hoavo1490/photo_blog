import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../tests/setup/pglite';
import type { PgliteDriver } from '../lib/db/pglite-driver';
import * as posts from '../lib/db/posts';
import * as sites from '../lib/db/sites';
import { GET } from './atom.xml';

let driver: PgliteDriver;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => { await clearAllTables(driver); });

function ctxFor(tenant: { id: string; customDomain?: string | null; name: string }) {
  return {
    locals: { tenant: { ...tenant, customDomain: tenant.customDomain ?? null }, db: driver },
    url: new URL('https://riovv.test/atom.xml'),
  } as unknown as Parameters<typeof GET>[0];
}

async function publishWith(siteId: string, args: { slug: string; title: string; body: string; description?: string | null }) {
  const draft = await posts.createDraft(driver, {
    siteId,
    slug: args.slug,
    title: args.title,
    body: args.body,
    description: args.description ?? null,
  });
  return await posts.publish(driver, { siteId, id: draft.id });
}

describe('atom.xml feed', () => {
  it('uses explicit description when present', async () => {
    const site = await sites.create(driver, { slug: 'a', name: 'riovv' });
    await publishWith(site.id, {
      slug: 'with-desc',
      title: 'With Desc',
      body: 'body',
      description: 'Explicit blurb.',
    });

    const res = await GET(ctxFor(site));
    const xml = await res.text();
    expect(xml).toContain('<description>Explicit blurb.</description>');
  });

  it('falls back to firstParagraph(body) when description is NULL', async () => {
    const site = await sites.create(driver, { slug: 'a', name: 'riovv' });
    await publishWith(site.id, {
      slug: 'no-desc',
      title: 'No Desc',
      body: '# Heading\n\nFirst real paragraph here.\n\nSecond.',
      description: null,
    });

    const res = await GET(ctxFor(site));
    const xml = await res.text();
    expect(xml).toContain('<description>First real paragraph here.</description>');
  });

  it('omits description when neither column nor body yields anything', async () => {
    const site = await sites.create(driver, { slug: 'a', name: 'riovv' });
    // Body that firstParagraph returns null for (only heading).
    await publishWith(site.id, {
      slug: 'empty',
      title: 'Empty',
      body: '# only heading',
      description: null,
    });

    const res = await GET(ctxFor(site));
    const xml = await res.text();
    // Channel-level <description> is always present (the site name);
    // only the item should lack one.
    const itemBlock = xml.slice(xml.indexOf('<item>'), xml.indexOf('</item>'));
    expect(itemBlock).not.toContain('<description>');
  });
});
