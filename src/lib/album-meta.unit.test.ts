import { describe, it, expect } from 'vitest';
import { fmtAlbumMeta } from './album-meta';

describe('fmtAlbumMeta', () => {
  it('formats count and month/year', () => {
    expect(fmtAlbumMeta(5, new Date('2026-06-14T10:00:00Z'))).toBe('5 photos · Jun 2026');
  });

  it('uses the singular for one photo', () => {
    expect(fmtAlbumMeta(1, new Date('2026-01-01T00:00:00Z'))).toBe('1 photo · Jan 2026');
  });

  it('uses UTC, not the local timezone', () => {
    // 23:30 UTC on 31 Dec is already January in UTC+7.
    expect(fmtAlbumMeta(2, new Date('2026-12-31T23:30:00Z'))).toBe('2 photos · Dec 2026');
  });
});
