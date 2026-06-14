import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';
import * as sites from './sites';
import * as users from './users';

let driver: PgliteDriver;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => { await clearAllTables(driver); });

describe('sites.create + findById', () => {
  it('persists a site with all fields', async () => {
    const site = await sites.create(driver, {
      slug: 'rio',
      name: 'riovv',
      customDomain: 'riovv.com',
    });
    expect(site.slug).toBe('rio');
    expect(site.name).toBe('riovv');
    expect(site.customDomain).toBe('riovv.com');
    expect(site.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(site.createdAt).toBeInstanceOf(Date);

    const found = await sites.findById(driver, site.id);
    expect(found?.slug).toBe('rio');
  });

  it('allows null customDomain (site exists before DNS is set up)', async () => {
    const site = await sites.create(driver, { slug: 'pre-launch', name: 'pre' });
    expect(site.customDomain).toBeNull();
  });

  it('enforces unique slug', async () => {
    await sites.create(driver, { slug: 'dup', name: 'one' });
    await expect(
      sites.create(driver, { slug: 'dup', name: 'two' })
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('enforces unique customDomain', async () => {
    await sites.create(driver, { slug: 'a', name: 'a', customDomain: 'riovv.com' });
    await expect(
      sites.create(driver, { slug: 'b', name: 'b', customDomain: 'riovv.com' })
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe('sites.findByHost', () => {
  it('finds by current custom_domain (case-insensitive)', async () => {
    const site = await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'riovv.com' });
    const found = await sites.findByHost(driver, 'riovv.com');
    expect(found?.id).toBe(site.id);
    const upper = await sites.findByHost(driver, 'RIOVV.COM');
    expect(upper?.id).toBe(site.id);
  });

  it('returns null for unknown host', async () => {
    await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'riovv.com' });
    const found = await sites.findByHost(driver, 'someone-else.com');
    expect(found).toBeNull();
  });

  it('finds via site_domain_history when host was previously associated', async () => {
    const site = await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'newdomain.com' });
    await driver.exec(
      `INSERT INTO site_domain_history (site_id, old_domain) VALUES ($1, $2)`,
      [site.id, 'olddomain.com'],
    );
    const found = await sites.findByHost(driver, 'olddomain.com');
    expect(found?.id).toBe(site.id);
    // The lookup should still know whether this was the current or historic host.
    expect(found?.isCurrentHost).toBe(false);
  });

  it('marks a current-host hit as isCurrentHost=true', async () => {
    const site = await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'riovv.com' });
    const found = await sites.findByHost(driver, 'riovv.com');
    expect(found?.isCurrentHost).toBe(true);
  });
});

describe('sites.findBySlug', () => {
  it('finds by slug regardless of customDomain state', async () => {
    const site = await sites.create(driver, { slug: 'rio', name: 'riovv' });
    const found = await sites.findBySlug(driver, 'rio');
    expect(found?.id).toBe(site.id);
  });

  it('returns null for unknown slug', async () => {
    expect(await sites.findBySlug(driver, 'no-such-slug')).toBeNull();
  });
});

describe('sites.listForUser', () => {
  it('returns sites where the user is a member, ordered by added_at', async () => {
    const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
    const s1 = await sites.create(driver, { slug: 'a', name: 'A' });
    const s2 = await sites.create(driver, { slug: 'b', name: 'B' });
    await sites.addMember(driver, { siteId: s1.id, userId: u.id, role: 'owner' });
    await sites.addMember(driver, { siteId: s2.id, userId: u.id, role: 'editor' });

    const list = await sites.listForUser(driver, u.id);
    expect(list.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
    // Roles surfaced on the result.
    const a = list.find((s) => s.id === s1.id);
    const b = list.find((s) => s.id === s2.id);
    expect(a?.role).toBe('owner');
    expect(b?.role).toBe('editor');
  });

  it('returns [] when the user has no memberships', async () => {
    const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
    expect(await sites.listForUser(driver, u.id)).toEqual([]);
  });
});

describe('sites.addMember + findMembership', () => {
  it('records the role and timestamp', async () => {
    const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
    const s = await sites.create(driver, { slug: 'rio', name: 'riovv' });
    await sites.addMember(driver, { siteId: s.id, userId: u.id, role: 'owner' });

    const m = await sites.findMembership(driver, { siteId: s.id, userId: u.id });
    expect(m?.role).toBe('owner');
  });

  it('returns null for non-members', async () => {
    const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
    const s = await sites.create(driver, { slug: 'rio', name: 'riovv' });
    const m = await sites.findMembership(driver, { siteId: s.id, userId: u.id });
    expect(m).toBeNull();
  });

  it('rejects invalid role', async () => {
    const u = await users.upsertByGithubId(driver, { githubId: 1, githubLogin: 'rio', email: null });
    const s = await sites.create(driver, { slug: 'rio', name: 'riovv' });
    await expect(
      sites.addMember(driver, { siteId: s.id, userId: u.id, role: 'admin' as any })
    ).rejects.toThrow();
  });
});
