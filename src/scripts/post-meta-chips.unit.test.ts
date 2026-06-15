// Pure formatters for the editor's status row -- the chips that surface
// date / tags / cover state under the title. Pure functions so we can
// pin the display logic with vitest unit tests and reuse the same
// helpers on the server (initial render) and the client (re-render on
// edit) without DOM dependencies.
import { describe, it, expect } from 'vitest';
import { formatDateChip, formatTagsChip } from './post-meta-chips';

describe('formatDateChip', () => {
  it('returns "today" when the date matches today', () => {
    expect(formatDateChip('2026-06-15', '2026-06-15')).toBe('today');
  });

  it('returns short form ("Mar 4") when same year as today', () => {
    expect(formatDateChip('2026-03-04', '2026-06-15')).toBe('Mar 4');
  });

  it('returns long form ("Mar 4, 2024") when different year', () => {
    expect(formatDateChip('2024-03-04', '2026-06-15')).toBe('Mar 4, 2024');
  });

  it('returns "+ date" when the date is empty string', () => {
    expect(formatDateChip('', '2026-06-15')).toBe('+ date');
  });

  it('returns "+ date" when the date is null', () => {
    expect(formatDateChip(null, '2026-06-15')).toBe('+ date');
  });
});

describe('formatTagsChip', () => {
  it('returns "+ tags" when given an empty array', () => {
    expect(formatTagsChip([])).toBe('+ tags');
  });

  it('returns "+ tags" when every entry is blank', () => {
    expect(formatTagsChip(['', '  '])).toBe('+ tags');
  });

  it('formats tags with # prefix joined by space', () => {
    expect(formatTagsChip(['photography', 'leica'])).toBe('#photography #leica');
  });

  it('trims whitespace and ignores blank entries', () => {
    expect(formatTagsChip(['a', '  ', ' b '])).toBe('#a #b');
  });

  it('parses a comma-separated string when given one', () => {
    // Convenience overload: the form input stores tags as a comma list,
    // so accepting that shape avoids a split() at every call site.
    expect(formatTagsChip('photography, leica')).toBe('#photography #leica');
  });

  it('returns "+ tags" for an empty comma-separated string', () => {
    expect(formatTagsChip('')).toBe('+ tags');
  });
});
