// URL slug generation. ASCII-only, hyphen-separated, lowercase.
// Tested against English, accented Latin (NFKD-decomposable), Vietnamese
// (mix of NFKD-decomposable and explicit-map letters), and CJK (dropped).

const MAX_LEN = 80;

// Vietnamese letters that NFKD does NOT decompose to ASCII. Combining
// diacritics on top of these DO decompose, so we run this map AFTER
// stripping combining marks.
const VIETNAMESE_MAP: Record<string, string> = {
  'đ': 'd', 'Đ': 'd',
  'ơ': 'o', 'Ơ': 'o',
  'ư': 'u', 'Ư': 'u',
};

export function slugify(input: string): string {
  if (!input) return '';

  let s = input.normalize('NFKD');
  s = s.replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[đĐơƠưƯ]/g, (ch) => VIETNAMESE_MAP[ch] ?? ch);
  s = s.toLowerCase();
  // Drop intra-word punctuation (apostrophes, quotes) so contractions
  // like "Rio's" stay glued: "rios", not "rio-s".
  s = s.replace(/['’‘`"“”]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');

  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN);
    const lastHyphen = s.lastIndexOf('-');
    // Only step back to the word boundary if we actually have one.
    if (lastHyphen > 0) s = s.slice(0, lastHyphen);
  }

  return s;
}

const VALID_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(s: string): boolean {
  return VALID_SLUG_RE.test(s);
}
