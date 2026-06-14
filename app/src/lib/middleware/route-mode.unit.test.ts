import { describe, it, expect } from 'vitest';
import { classifyRoute, isCacheableMethod } from './route-mode';

describe('classifyRoute', () => {
  const ADMIN = 'admin.riovv.com';

  it('returns admin when host matches the admin host', () => {
    expect(classifyRoute({ host: 'admin.riovv.com', pathname: '/', adminHost: ADMIN })).toBe('admin');
  });

  it('returns admin regardless of admin path (the route handles auth, not the classifier)', () => {
    expect(classifyRoute({ host: 'admin.riovv.com', pathname: '/posts/new', adminHost: ADMIN })).toBe('admin');
  });

  it('treats admin host comparison case-insensitively (host is already lowercased by middleware)', () => {
    // adminHost may come from env in arbitrary casing; classifier normalizes it.
    expect(classifyRoute({ host: 'admin.riovv.com', pathname: '/', adminHost: 'ADMIN.RIOVV.COM' })).toBe('admin');
  });

  it('returns public-tenant for tenant public hosts', () => {
    expect(classifyRoute({ host: 'riovv.com', pathname: '/', adminHost: ADMIN })).toBe('public-tenant');
    expect(classifyRoute({ host: 'friend.example', pathname: '/2026/06/14/hi.html', adminHost: ADMIN })).toBe('public-tenant');
  });

  it('returns asset for /_astro/ paths regardless of host', () => {
    expect(classifyRoute({ host: 'riovv.com', pathname: '/_astro/foo.css', adminHost: ADMIN })).toBe('asset');
    expect(classifyRoute({ host: 'admin.riovv.com', pathname: '/_astro/foo.js', adminHost: ADMIN })).toBe('asset');
  });

  it('returns asset for favicon.ico and robots.txt', () => {
    expect(classifyRoute({ host: 'riovv.com', pathname: '/favicon.ico', adminHost: ADMIN })).toBe('asset');
    expect(classifyRoute({ host: 'riovv.com', pathname: '/robots.txt', adminHost: ADMIN })).toBe('asset');
  });

  it('does not match asset prefix as a sub-path of a tenant pathname', () => {
    // '/2026/_astro-tag.html' should NOT match /_astro/ prefix.
    expect(classifyRoute({ host: 'riovv.com', pathname: '/2026/_astro-tag.html', adminHost: ADMIN })).toBe('public-tenant');
  });
});

describe('isCacheableMethod', () => {
  it('caches GET and HEAD', () => {
    expect(isCacheableMethod('GET')).toBe(true);
    expect(isCacheableMethod('HEAD')).toBe(true);
  });

  it('does not cache mutating methods', () => {
    expect(isCacheableMethod('POST')).toBe(false);
    expect(isCacheableMethod('PUT')).toBe(false);
    expect(isCacheableMethod('DELETE')).toBe(false);
    expect(isCacheableMethod('PATCH')).toBe(false);
  });
});
