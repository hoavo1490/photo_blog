import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { freshDb, clearAllTables } from '../../../tests/setup/pglite';
import type { PgliteDriver } from '../db/pglite-driver';
import * as sites from '../db/sites';
import { resolveTenant, historicRedirectUrl } from './tenant';

let driver: PgliteDriver;

beforeAll(async () => { driver = await freshDb(); });
afterAll(async () => { await driver.close(); });
beforeEach(async () => { await clearAllTables(driver); });

describe('resolveTenant', () => {
  it('returns kind=current when host is the live custom_domain', async () => {
    const s = await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'riovv.com' });
    const r = await resolveTenant(driver, 'riovv.com');
    expect(r.kind).toBe('current');
    expect(r.site?.id).toBe(s.id);
  });

  it('returns kind=historic when host is in site_domain_history', async () => {
    const s = await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'newdomain.com' });
    await driver.exec(
      `INSERT INTO site_domain_history (site_id, old_domain) VALUES ($1, $2)`,
      [s.id, 'olddomain.com'],
    );
    const r = await resolveTenant(driver, 'olddomain.com');
    expect(r.kind).toBe('historic');
    expect(r.site?.customDomain).toBe('newdomain.com');
  });

  it('returns kind=unknown when host is not associated with any site', async () => {
    await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'riovv.com' });
    const r = await resolveTenant(driver, 'totally-unknown.example');
    expect(r.kind).toBe('unknown');
    expect(r.site).toBeNull();
  });

  it('lowercases host comparison', async () => {
    const s = await sites.create(driver, { slug: 'rio', name: 'riovv', customDomain: 'riovv.com' });
    const r = await resolveTenant(driver, 'RIOVV.COM');
    expect(r.kind).toBe('current');
    expect(r.site?.id).toBe(s.id);
  });
});

describe('historicRedirectUrl', () => {
  it('preserves pathname and search', () => {
    expect(historicRedirectUrl({
      currentHost: 'riovv.com',
      pathname: '/2026/06/14/hi.html',
      search: '?ref=hn',
    })).toBe('https://riovv.com/2026/06/14/hi.html?ref=hn');
  });

  it('handles empty search', () => {
    expect(historicRedirectUrl({
      currentHost: 'riovv.com',
      pathname: '/',
      search: '',
    })).toBe('https://riovv.com/');
  });
});
