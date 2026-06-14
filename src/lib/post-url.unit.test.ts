import { describe, it, expect } from 'vitest';
import { postUrl, postParams, parsePostPath } from './post-url';

describe('postUrl', () => {
  it('forms /YYYY/MM/DD/slug.html for a UTC date', () => {
    const post = {
      publishedAt: new Date('2026-06-14T12:00:00Z'),
      slug: 'hello-world',
    };
    expect(postUrl(post)).toBe('/2026/06/14/hello-world.html');
  });

  it('pads single-digit month and day with leading zero', () => {
    const post = {
      publishedAt: new Date('2026-01-05T00:00:00Z'),
      slug: 'new-year',
    };
    expect(postUrl(post)).toBe('/2026/01/05/new-year.html');
  });

  it('uses UTC components so the URL is timezone-stable', () => {
    // 23:30 in Tokyo (UTC+09) on 2026-06-14 is 14:30 UTC same day.
    // 01:30 in Honolulu (UTC-10) on 2026-06-15 is 11:30 UTC same day.
    // Both should map to /2026/06/14/... when given as UTC strings.
    const a = postUrl({ publishedAt: new Date('2026-06-14T14:30:00Z'), slug: 'a' });
    const b = postUrl({ publishedAt: new Date('2026-06-14T11:30:00Z'), slug: 'b' });
    expect(a).toMatch(/^\/2026\/06\/14\//);
    expect(b).toMatch(/^\/2026\/06\/14\//);
  });

  it('does not use local-time getters (would shift the URL across midnight UTC)', () => {
    // 2026-06-14T23:00:00Z is the 14th in UTC but 15th in any +02 or later
    // timezone. The URL must reflect UTC date.
    const post = {
      publishedAt: new Date('2026-06-14T23:00:00Z'),
      slug: 'late-night',
    };
    expect(postUrl(post)).toBe('/2026/06/14/late-night.html');
  });

  it('throws on empty slug (caller bug)', () => {
    expect(() =>
      postUrl({ publishedAt: new Date('2026-06-14T00:00:00Z'), slug: '' })
    ).toThrow(/slug/i);
  });

  it('throws on invalid Date', () => {
    expect(() =>
      postUrl({ publishedAt: new Date('not-a-date'), slug: 'x' })
    ).toThrow();
  });
});

describe('postParams', () => {
  it('returns padded zero-prefixed strings for year/month/day plus the raw slug', () => {
    const params = postParams({
      publishedAt: new Date('2026-01-05T00:00:00Z'),
      slug: 'foo-bar',
    });
    expect(params).toEqual({
      year: '2026',
      month: '01',
      day: '05',
      slug: 'foo-bar',
    });
  });

  it('produces values that, joined into a URL, exactly equal postUrl()', () => {
    const post = { publishedAt: new Date('2017-12-31T05:00:00Z'), slug: 'farewell' };
    const p = postParams(post);
    expect(`/${p.year}/${p.month}/${p.day}/${p.slug}.html`).toBe(postUrl(post));
  });
});

describe('parsePostPath', () => {
  it('parses a canonical post URL into its parts', () => {
    expect(parsePostPath('/2026/06/14/hello-world.html')).toEqual({
      year: '2026',
      month: '06',
      day: '14',
      slug: 'hello-world',
    });
  });

  it('accepts paths without leading slash', () => {
    expect(parsePostPath('2026/06/14/hello-world.html')).toEqual({
      year: '2026',
      month: '06',
      day: '14',
      slug: 'hello-world',
    });
  });

  it('returns null for non-post paths', () => {
    expect(parsePostPath('/about.html')).toBeNull();
    expect(parsePostPath('/2026/06/14/')).toBeNull();
    expect(parsePostPath('/2026/06/14/foo')).toBeNull();      // missing .html
    expect(parsePostPath('/2026/13/14/foo.html')).toBeNull(); // invalid month
    expect(parsePostPath('/2026/06/32/foo.html')).toBeNull(); // invalid day
  });

  it('round-trips with postUrl', () => {
    const url = postUrl({
      publishedAt: new Date('2026-06-14T12:00:00Z'),
      slug: 'round-trip',
    });
    expect(parsePostPath(url)).toEqual({
      year: '2026',
      month: '06',
      day: '14',
      slug: 'round-trip',
    });
  });
});
