import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../setup/pglite';
import type { PgliteDriver } from '../../../../src/lib/db/pglite-driver';
import * as sites from '../../../../src/lib/db/sites';
import * as posts from '../../../../src/lib/db/posts';

// findAdjacent powers the prev / next chevrons at the bottom of every
// post detail page. Ordering is by published_at over the same site's
// published posts: previous = the newest post older than this one,
// next = the oldest post newer than this one. Drafts and other sites'
// posts must never appear.

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

async function createPublished(siteId: string, slug: string, dateISO: string) {
  const created = await posts.createDraft(driver, { siteId, slug, title: slug, body: '' });
  await posts.publish(driver, { siteId, id: created.id, publishedAt: new Date(dateISO) });
  return (await posts.findById(driver, { siteId, id: created.id }))!;
}

describe('posts.findAdjacent', () => {
  it('returns the immediately-older post as `previous` and the immediately-newer as `next`', async () => {
    const older = await createPublished(siteA, 'older', '2024-01-01T12:00:00Z');
    const current = await createPublished(siteA, 'current', '2024-02-01T12:00:00Z');
    const newer = await createPublished(siteA, 'newer', '2024-03-01T12:00:00Z');

    const adj = await posts.findAdjacent(driver, { siteId: siteA, post: current });
    expect(adj.previous?.id).toBe(older.id);
    expect(adj.next?.id).toBe(newer.id);
  });

  it('returns null for previous when the post is the oldest', async () => {
    const oldest = await createPublished(siteA, 'oldest', '2024-01-01T12:00:00Z');
    await createPublished(siteA, 'newer', '2024-03-01T12:00:00Z');
    const adj = await posts.findAdjacent(driver, { siteId: siteA, post: oldest });
    expect(adj.previous).toBeNull();
    expect(adj.next).not.toBeNull();
  });

  it('returns null for next when the post is the newest', async () => {
    await createPublished(siteA, 'older', '2024-01-01T12:00:00Z');
    const newest = await createPublished(siteA, 'newest', '2024-03-01T12:00:00Z');
    const adj = await posts.findAdjacent(driver, { siteId: siteA, post: newest });
    expect(adj.previous).not.toBeNull();
    expect(adj.next).toBeNull();
  });

  it('returns both null when the post is alone on its site', async () => {
    const only = await createPublished(siteA, 'only', '2024-01-01T12:00:00Z');
    const adj = await posts.findAdjacent(driver, { siteId: siteA, post: only });
    expect(adj.previous).toBeNull();
    expect(adj.next).toBeNull();
  });

  it('skips drafts and scheduled posts -- only walks through published siblings', async () => {
    await createPublished(siteA, 'older', '2024-01-01T12:00:00Z');
    const current = await createPublished(siteA, 'current', '2024-02-01T12:00:00Z');
    // A draft that sits chronologically between current and the older
    // published one must not be returned as adjacent -- it's not public.
    await posts.createDraft(driver, { siteId: siteA, slug: 'unpublished', title: 'd', body: '' });

    const adj = await posts.findAdjacent(driver, { siteId: siteA, post: current });
    expect(adj.previous?.slug).toBe('older');
    expect(adj.next).toBeNull();
  });

  it('is scoped by site -- another tenant\'s posts never leak in', async () => {
    const current = await createPublished(siteA, 'current', '2024-02-01T12:00:00Z');
    // Two posts on siteB that bracket `current` chronologically.
    await createPublished(siteB, 'b-old', '2024-01-15T12:00:00Z');
    await createPublished(siteB, 'b-new', '2024-02-15T12:00:00Z');

    const adj = await posts.findAdjacent(driver, { siteId: siteA, post: current });
    expect(adj.previous).toBeNull();
    expect(adj.next).toBeNull();
  });
});
