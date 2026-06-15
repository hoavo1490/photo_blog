import { describe, it, expect } from 'vitest';
import {
  safeNext,
  parseStateNonce,
  readOAuthStateCookie,
  buildOAuthStateCookie,
  buildClearOAuthStateCookie,
  OAUTH_STATE_COOKIE_NAME,
} from './callback-validators';

const ORIGIN = 'https://editor.riovv.com';

describe('safeNext', () => {
  it('allows simple same-origin relative paths', () => {
    expect(safeNext('/admin', ORIGIN)).toBe('/admin');
    expect(safeNext('/admin/posts/new', ORIGIN)).toBe('/admin/posts/new');
  });

  it('preserves querystring + hash on a relative path', () => {
    expect(safeNext('/admin?tab=drafts#x', ORIGIN)).toBe('/admin?tab=drafts#x');
  });

  it('rejects protocol-relative URLs (//evil.com)', () => {
    // `//evil.com` parses against origin as `https://evil.com/` -- different origin.
    expect(safeNext('//evil.com', ORIGIN)).toBe('/admin');
    expect(safeNext('//evil.com/path', ORIGIN)).toBe('/admin');
  });

  it('rejects backslash-prefixed redirects', () => {
    // Browsers normalize backslashes in the authority slot to forward
    // slashes, turning `/\evil.com` into `//evil.com`.
    expect(safeNext('/\\evil.com', ORIGIN)).toBe('/admin');
    expect(safeNext('\\\\evil.com', ORIGIN)).toBe('/admin');
  });

  it('rejects absolute external URLs', () => {
    expect(safeNext('https://evil.com/path', ORIGIN)).toBe('/admin');
    expect(safeNext('http://evil.com', ORIGIN)).toBe('/admin');
  });

  it('falls back on null / empty / non-string input', () => {
    expect(safeNext(null, ORIGIN)).toBe('/admin');
    expect(safeNext('', ORIGIN)).toBe('/admin');
    expect(safeNext(undefined, ORIGIN)).toBe('/admin');
  });

  it('falls back when input is not parseable', () => {
    // URL constructor should still resolve most inputs against a base
    // origin, but if for some reason it throws, the fallback wins.
    expect(safeNext('http://[invalid', ORIGIN)).toBe('/admin');
  });
});

describe('parseStateNonce', () => {
  it('returns the nonce from a valid base64-JSON state', () => {
    const state = btoa(JSON.stringify({ next: '/admin', n: 'abc123' }));
    expect(parseStateNonce(state)).toBe('abc123');
  });

  it('returns null when state is missing', () => {
    expect(parseStateNonce(null)).toBeNull();
    expect(parseStateNonce('')).toBeNull();
  });

  it('returns null when state is not valid base64 JSON', () => {
    expect(parseStateNonce('not-base64$')).toBeNull();
    expect(parseStateNonce(btoa('not json'))).toBeNull();
  });

  it('returns null when nonce field is missing', () => {
    expect(parseStateNonce(btoa(JSON.stringify({ next: '/admin' })))).toBeNull();
  });

  it('returns null when nonce field is not a non-empty string', () => {
    expect(parseStateNonce(btoa(JSON.stringify({ n: 123 })))).toBeNull();
    expect(parseStateNonce(btoa(JSON.stringify({ n: '' })))).toBeNull();
  });
});

describe('readOAuthStateCookie', () => {
  it('returns the cookie value when present', () => {
    expect(
      readOAuthStateCookie(`${OAUTH_STATE_COOKIE_NAME}=nonce123; other=foo`),
    ).toBe('nonce123');
  });

  it('returns null when missing or empty', () => {
    expect(readOAuthStateCookie(null)).toBeNull();
    expect(readOAuthStateCookie('other=foo')).toBeNull();
    expect(readOAuthStateCookie(`${OAUTH_STATE_COOKIE_NAME}=`)).toBeNull();
  });
});

describe('buildOAuthStateCookie', () => {
  it('emits HttpOnly + SameSite=Lax + Max-Age', () => {
    const cookie = buildOAuthStateCookie('xyz', { secure: true });
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE_NAME}=xyz`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it('omits Secure when in dev', () => {
    expect(buildOAuthStateCookie('x', { secure: false })).not.toContain('Secure');
  });

  it('includes Domain when set', () => {
    expect(buildOAuthStateCookie('x', { secure: true, domain: 'riovv.com' })).toContain(
      'Domain=riovv.com',
    );
  });
});

describe('buildClearOAuthStateCookie', () => {
  it('sets Max-Age=0', () => {
    expect(buildClearOAuthStateCookie({ secure: true })).toContain('Max-Age=0');
  });
});
