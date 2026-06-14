import { describe, it, expect } from 'vitest';
import { buildCacheKey, hasSessionCookie, isCacheable } from './cache';

describe('buildCacheKey', () => {
  it('namespaces by tenantId', () => {
    const a = buildCacheKey({ tenantId: 't1', pathname: '/foo', search: '' });
    const b = buildCacheKey({ tenantId: 't2', pathname: '/foo', search: '' });
    expect(a).not.toBe(b);
  });

  it('preserves pathname and search', () => {
    expect(buildCacheKey({ tenantId: 't', pathname: '/post/x', search: '?ref=hn' }))
      .toBe('https://_riovv_cache_/t/post/x?ref=hn');
  });

  it('uses a host that cannot collide with a real outbound URL', () => {
    const key = buildCacheKey({ tenantId: 't', pathname: '/x', search: '' });
    expect(key.startsWith('https://_riovv_cache_/')).toBe(true);
  });
});

describe('hasSessionCookie', () => {
  function req(cookie: string | null) {
    const headers = new Headers();
    if (cookie !== null) headers.set('cookie', cookie);
    return new Request('https://x/y', { headers });
  }

  it('detects the riovv_sid cookie when alone', () => {
    expect(hasSessionCookie(req('riovv_sid=abc'))).toBe(true);
  });

  it('detects riovv_sid when followed by other cookies', () => {
    expect(hasSessionCookie(req('riovv_sid=abc; theme=dark'))).toBe(true);
  });

  it('detects riovv_sid when preceded by other cookies', () => {
    expect(hasSessionCookie(req('theme=dark; riovv_sid=abc'))).toBe(true);
  });

  it('does NOT false-positive on substrings', () => {
    expect(hasSessionCookie(req('other_riovv_sid_xx=abc'))).toBe(false);
    expect(hasSessionCookie(req('xriovv_sid=abc'))).toBe(false);
  });

  it('returns false when no cookie header present', () => {
    expect(hasSessionCookie(req(null))).toBe(false);
  });

  it('returns false when cookie header is empty', () => {
    expect(hasSessionCookie(req(''))).toBe(false);
  });
});

describe('isCacheable', () => {
  function req(method: string, cookie?: string, cacheControl?: string) {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    if (cacheControl) headers.set('cache-control', cacheControl);
    return new Request('https://x/y', { method, headers });
  }

  it('caches anonymous GETs', () => {
    expect(isCacheable({ request: req('GET'), tenantId: 't' })).toBe(true);
  });

  it('caches HEAD', () => {
    expect(isCacheable({ request: req('HEAD'), tenantId: 't' })).toBe(true);
  });

  it('does not cache POST / PUT / DELETE', () => {
    expect(isCacheable({ request: req('POST'), tenantId: 't' })).toBe(false);
    expect(isCacheable({ request: req('PUT'), tenantId: 't' })).toBe(false);
    expect(isCacheable({ request: req('DELETE'), tenantId: 't' })).toBe(false);
  });

  it('does not cache requests that carry a session cookie', () => {
    expect(isCacheable({ request: req('GET', 'riovv_sid=abc'), tenantId: 't' })).toBe(false);
  });

  it('respects Cache-Control: no-store', () => {
    expect(isCacheable({ request: req('GET', undefined, 'no-store'), tenantId: 't' })).toBe(false);
  });

  it('respects Cache-Control: no-cache', () => {
    expect(isCacheable({ request: req('GET', undefined, 'no-cache'), tenantId: 't' })).toBe(false);
  });
});
