import { describe, it, expect } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  readSessionId,
  buildSessionCookie,
  buildClearCookie,
  looksLikeSessionId,
} from './session-cookie';

const h = (cookie?: string) => {
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', cookie);
  return headers;
};

describe('readSessionId', () => {
  it('parses a single-cookie header', () => {
    expect(readSessionId(h(`${SESSION_COOKIE_NAME}=abc123`))).toBe('abc123');
  });

  it('parses a multi-cookie header (cookie among others)', () => {
    expect(
      readSessionId(h(`theme=dark; ${SESSION_COOKIE_NAME}=xyz-9; lang=en`)),
    ).toBe('xyz-9');
  });

  it('returns null when the session cookie is absent', () => {
    expect(readSessionId(h('theme=dark; lang=en'))).toBeNull();
  });

  it('returns null when there is no Cookie header at all', () => {
    expect(readSessionId(h())).toBeNull();
  });

  it('returns null when the cookie value is empty', () => {
    expect(readSessionId(h(`${SESSION_COOKIE_NAME}=`))).toBeNull();
  });

  it('returns the raw value without validating it (validation is a separate step)', () => {
    expect(readSessionId(h(`${SESSION_COOKIE_NAME}=not-a-uuid`))).toBe('not-a-uuid');
  });
});

describe('buildSessionCookie', () => {
  it('includes HttpOnly, SameSite=Lax, Path=/', () => {
    const c = buildSessionCookie('sid', { secure: true });
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Path=\//);
  });

  it('includes Secure when opts.secure=true', () => {
    expect(buildSessionCookie('sid', { secure: true })).toMatch(/Secure/);
  });

  it('omits Secure when opts.secure=false', () => {
    expect(buildSessionCookie('sid', { secure: false })).not.toMatch(/Secure/);
  });

  it('omits Domain when opts.domain undefined', () => {
    expect(buildSessionCookie('sid', { secure: true })).not.toMatch(/Domain=/);
  });

  it('includes Domain when opts.domain is set', () => {
    expect(
      buildSessionCookie('sid', { secure: true, domain: 'admin.riovv.com' }),
    ).toMatch(/Domain=admin\.riovv\.com/);
  });

  it('uses default Max-Age of 30 days when maxAgeDays not specified', () => {
    const c = buildSessionCookie('sid', { secure: true });
    expect(c).toMatch(/Max-Age=2592000/); // 30 * 86400
  });

  it('reflects maxAgeDays in Max-Age', () => {
    const c = buildSessionCookie('sid', { secure: true, maxAgeDays: 7 });
    expect(c).toMatch(/Max-Age=604800/); // 7 * 86400
  });
});

describe('buildClearCookie', () => {
  it('includes Max-Age=0', () => {
    expect(buildClearCookie({ secure: true })).toMatch(/Max-Age=0\b/);
  });

  it('matches Domain so the right cookie gets cleared', () => {
    const c = buildClearCookie({ secure: true, domain: 'admin.riovv.com' });
    expect(c).toMatch(/Domain=admin\.riovv\.com/);
    expect(c).toMatch(/Max-Age=0\b/);
  });
});

describe('looksLikeSessionId', () => {
  it('accepts a valid UUID v4', () => {
    expect(looksLikeSessionId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejects strings that are too short', () => {
    expect(looksLikeSessionId('abc')).toBe(false);
    expect(looksLikeSessionId('')).toBe(false);
  });

  it('rejects strings with non-hex characters', () => {
    expect(looksLikeSessionId('zzze4567-e89b-12d3-a456-426614174000')).toBe(false);
  });

  it('rejects strings missing the dashes', () => {
    expect(looksLikeSessionId('123e4567e89b12d3a456426614174000')).toBe(false);
  });
});
