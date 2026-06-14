import { describe, it, expect } from 'vitest';
import { slugify, isValidSlug } from './slug';

describe('slugify', () => {
  it('lowercases ASCII words and joins with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation', () => {
    expect(slugify("Rio's Adventure!")).toBe('rios-adventure');
  });

  it('collapses consecutive separators into a single hyphen', () => {
    expect(slugify('a -- b __ c')).toBe('a-b-c');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(slugify('   ')).toBe('');
  });

  it('returns empty string for symbol-only input', () => {
    expect(slugify('!@#$%')).toBe('');
  });

  it('removes Vietnamese diacritics so URLs stay ASCII-safe', () => {
    // Telex output: phở bò -> pho bo
    expect(slugify('phở bò')).toBe('pho-bo');
    expect(slugify('Hà Nội')).toBe('ha-noi');
  });

  it('removes accented Latin characters', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('drops CJK characters (no transliteration in scope)', () => {
    // We do not transliterate CJK; we strip and fall through to whatever is left.
    expect(slugify('你好 world')).toBe('world');
  });

  it('preserves digits', () => {
    expect(slugify('post 2026')).toBe('post-2026');
  });

  it('truncates to a sensible max length', () => {
    const long = 'a'.repeat(200);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not split mid-word when truncating', () => {
    const input = 'this is a very long title with many words that should not be split mid word ever ever ever';
    const result = slugify(input);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
    // Each segment between hyphens should be a whole "word" from the input.
    for (const seg of result.split('-')) {
      expect(input.toLowerCase().split(/\s+/)).toContain(seg);
    }
  });

  it('is idempotent', () => {
    const once = slugify('Hello — World!');
    expect(slugify(once)).toBe(once);
  });
});

describe('isValidSlug', () => {
  it('accepts lowercase ASCII with hyphens', () => {
    expect(isValidSlug('hello-world-2026')).toBe(true);
  });

  it('rejects uppercase', () => {
    expect(isValidSlug('Hello-World')).toBe(false);
  });

  it('rejects empty', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects leading or trailing hyphen', () => {
    expect(isValidSlug('-hello')).toBe(false);
    expect(isValidSlug('hello-')).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    expect(isValidSlug('hello--world')).toBe(false);
  });

  it('rejects symbols and whitespace', () => {
    expect(isValidSlug('hello world')).toBe(false);
    expect(isValidSlug('hello!')).toBe(false);
    expect(isValidSlug('hello/world')).toBe(false);
  });
});
