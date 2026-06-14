import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';
import * as images from './images';
import * as sites from './sites';
import * as users from './users';

let driver: PgliteDriver;
let siteId: string;
let uploaderId: string;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => {
  await clearAllTables(driver);
  const s = await sites.create(driver, { slug: 'a', name: 'A' });
  siteId = s.id;
  const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
  uploaderId = u.id;
});

describe('images.create', () => {
  it('persists all metadata fields', async () => {
    const img = await images.create(driver, {
      siteId,
      r2Key: 'site-uuid/2026/06/14/abc-cat.jpg',
      originalName: 'IMG_4521.HEIC',
      sizeBytes: 380_000,
      width: 1600,
      height: 1200,
      uploadedBy: uploaderId,
    });
    expect(img.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(img.siteId).toBe(siteId);
    expect(img.r2Key).toBe('site-uuid/2026/06/14/abc-cat.jpg');
    expect(img.originalName).toBe('IMG_4521.HEIC');
    expect(img.sizeBytes).toBe(380_000);
    expect(img.width).toBe(1600);
    expect(img.height).toBe(1200);
    expect(img.uploadedBy).toBe(uploaderId);
    expect(img.uploadedAt).toBeInstanceOf(Date);
  });

  it('allows null uploadedBy (uploader account removed later)', async () => {
    const img = await images.create(driver, {
      siteId,
      r2Key: 'k1',
      originalName: 'a.jpg',
      sizeBytes: 1,
      width: 1, height: 1,
      uploadedBy: null,
    });
    expect(img.uploadedBy).toBeNull();
  });

  it('enforces unique r2_key across all sites (R2 keys are globally unique)', async () => {
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    await images.create(driver, {
      siteId, r2Key: 'global-key',
      originalName: 'a.jpg', sizeBytes: 1, width: 1, height: 1, uploadedBy: uploaderId,
    });
    await expect(
      images.create(driver, {
        siteId: s2.id, r2Key: 'global-key',
        originalName: 'b.jpg', sizeBytes: 1, width: 1, height: 1, uploadedBy: uploaderId,
      }),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe('images.findById', () => {
  it('returns the image when site_id matches', async () => {
    const created = await images.create(driver, {
      siteId, r2Key: 'k', originalName: 'a.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    const found = await images.findById(driver, { siteId, id: created.id });
    expect(found?.id).toBe(created.id);
  });

  it('returns null when site_id is different (tenant isolation)', async () => {
    const created = await images.create(driver, {
      siteId, r2Key: 'k', originalName: 'a.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    const found = await images.findById(driver, { siteId: s2.id, id: created.id });
    expect(found).toBeNull();
  });

  it('returns null for unknown id', async () => {
    expect(
      await images.findById(driver, { siteId, id: '00000000-0000-0000-0000-000000000000' }),
    ).toBeNull();
  });
});

describe('images.listForSite', () => {
  it('returns images for the site, newest first', async () => {
    const a = await images.create(driver, {
      siteId, r2Key: 'a', originalName: 'a.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await images.create(driver, {
      siteId, r2Key: 'b', originalName: 'b.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    const list = await images.listForSite(driver, { siteId });
    expect(list.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it('does not leak across sites', async () => {
    await images.create(driver, {
      siteId, r2Key: 'a', originalName: 'a.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    expect(await images.listForSite(driver, { siteId: s2.id })).toEqual([]);
  });
});

describe('images.del', () => {
  it('removes the image when site_id matches', async () => {
    const img = await images.create(driver, {
      siteId, r2Key: 'k', originalName: 'a.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    await images.del(driver, { siteId, id: img.id });
    expect(await images.findById(driver, { siteId, id: img.id })).toBeNull();
  });

  it('does not delete an image belonging to a different site', async () => {
    const img = await images.create(driver, {
      siteId, r2Key: 'k', originalName: 'a.jpg', sizeBytes: 1,
      width: 1, height: 1, uploadedBy: uploaderId,
    });
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    await images.del(driver, { siteId: s2.id, id: img.id });
    expect((await images.findById(driver, { siteId, id: img.id }))?.id).toBe(img.id);
  });
});
