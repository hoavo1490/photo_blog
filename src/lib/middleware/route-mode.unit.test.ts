import { describe, it, expect } from 'vitest';
import { classifyRoute, isCacheableMethod } from './route-mode';

describe('classifyRoute', () => {
  it('returns admin for /admin and its children', () => {
    expect(classifyRoute({ pathname: '/admin' })).toBe('admin');
    expect(classifyRoute({ pathname: '/admin/' })).toBe('admin');
    expect(classifyRoute({ pathname: '/admin/posts' })).toBe('admin');
    expect(classifyRoute({ pathname: '/admin/api/save' })).toBe('admin');
  });

  it('returns admin for auth-flow paths', () => {
    expect(classifyRoute({ pathname: '/login' })).toBe('admin');
    expect(classifyRoute({ pathname: '/logout' })).toBe('admin');
    expect(classifyRoute({ pathname: '/auth/callback' })).toBe('admin');
  });

  it('returns public-tenant for everything else under the tenant host', () => {
    expect(classifyRoute({ pathname: '/' })).toBe('public-tenant');
    expect(classifyRoute({ pathname: '/2026/06/14/hello.html' })).toBe('public-tenant');
    expect(classifyRoute({ pathname: '/archive.html' })).toBe('public-tenant');
    expect(classifyRoute({ pathname: '/tags.html' })).toBe('public-tenant');
    expect(classifyRoute({ pathname: '/about.html' })).toBe('public-tenant');
    expect(classifyRoute({ pathname: '/atom.xml' })).toBe('public-tenant');
  });

  it('does not false-positive on paths that merely START with admin-prefix substrings', () => {
    expect(classifyRoute({ pathname: '/administrator' })).toBe('public-tenant');
    expect(classifyRoute({ pathname: '/2026/01/01/login-tips.html' })).toBe('public-tenant');
  });

  it('returns asset for /_astro/ paths', () => {
    expect(classifyRoute({ pathname: '/_astro/foo.css' })).toBe('asset');
  });

  it('returns asset for favicon.ico', () => {
    expect(classifyRoute({ pathname: '/favicon.ico' })).toBe('asset');
  });

  it('routes /robots.txt as public-tenant (dynamic endpoint)', () => {
    expect(classifyRoute({ pathname: '/robots.txt' })).toBe('public-tenant');
  });

  it('does not classify nested paths that merely contain /_astro/ as assets', () => {
    expect(classifyRoute({ pathname: '/2026/_astro-tag.html' })).toBe('public-tenant');
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
