import { describe, it, expect } from 'vitest';
import {
  firstImageToken,
  firstImageUrl,
  firstParagraph,
  allImageTokens,
  rewriteImageTokens,
} from './markdown';

const UUID_A = '11111111-2222-3333-4444-555555555555';
const UUID_B = '66666666-7777-8888-9999-aaaaaaaaaaaa';

describe('firstImageToken', () => {
  it('returns the uuid of the first image: token', () => {
    const body = `intro\n\n![](image:${UUID_A})\n\nrest`;
    expect(firstImageToken(body)).toBe(UUID_A);
  });

  it('returns null when no token is present', () => {
    expect(firstImageToken('just some text\n\nmore text')).toBeNull();
  });

  it('returns null when only raw URL images are present', () => {
    expect(firstImageToken('![alt](https://example.com/x.jpg)')).toBeNull();
  });

  it('picks the earliest token when multiple exist', () => {
    const body = `![](image:${UUID_A}) and ![](image:${UUID_B})`;
    expect(firstImageToken(body)).toBe(UUID_A);
  });
});

describe('firstImageUrl', () => {
  it('returns the URL of the first http image', () => {
    expect(firstImageUrl('text ![alt](https://cdn.example.com/x.jpg) text')).toBe(
      'https://cdn.example.com/x.jpg',
    );
  });

  it('returns the URL of the first https image', () => {
    expect(firstImageUrl('![](http://example.com/a.png)')).toBe('http://example.com/a.png');
  });

  it('returns null when no image URL is present', () => {
    expect(firstImageUrl(`![](image:${UUID_A})`)).toBeNull();
  });
});

describe('firstParagraph', () => {
  it('returns the first non-heading, non-image paragraph', () => {
    const body = `# Title\n\nThis is the lead paragraph.\n\nSecond paragraph.`;
    expect(firstParagraph(body)).toBe('This is the lead paragraph.');
  });

  it('skips fenced code blocks', () => {
    const body = '```\ncode here\n```\n\nActual text.';
    expect(firstParagraph(body)).toBe('Actual text.');
  });

  it('skips image-only lines', () => {
    const body = `![cover](image:${UUID_A})\n\nReal paragraph.`;
    expect(firstParagraph(body)).toBe('Real paragraph.');
  });

  it('truncates at maxChars without splitting words', () => {
    const body = 'one two three four five six seven eight nine ten eleven twelve';
    const out = firstParagraph(body, 20);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(20);
    expect(out!.endsWith(' ')).toBe(false);
    // last char should not be a partial word
    expect(body.startsWith(out!)).toBe(true);
  });

  it('returns null on empty body', () => {
    expect(firstParagraph('')).toBeNull();
    expect(firstParagraph('   \n\n')).toBeNull();
  });

  it('returns null when body has only headings and images', () => {
    expect(firstParagraph(`# Heading\n\n![](image:${UUID_A})`)).toBeNull();
  });
});

describe('allImageTokens', () => {
  it('returns unique tokens in document order', () => {
    const body = `![](image:${UUID_A}) ... ![](image:${UUID_B}) ... ![](image:${UUID_A})`;
    expect(allImageTokens(body)).toEqual([UUID_A, UUID_B]);
  });

  it('returns empty array when no tokens are present', () => {
    expect(allImageTokens('just text')).toEqual([]);
  });
});

describe('rewriteImageTokens', () => {
  const resolver = (id: string) =>
    id === UUID_A ? { url: 'https://cdn/a.jpg' } : null;

  it('emits an <img> tag pointing at the resolved URL', () => {
    const out = rewriteImageTokens(`![cover](image:${UUID_A})`, resolver);
    expect(out).toContain('<img');
    expect(out).toContain('src="https://cdn/a.jpg"');
    expect(out).toContain('alt="cover"');
    expect(out).toContain('data-pswp-src="https://cdn/a.jpg"');
  });

  it('preserves alt text', () => {
    const out = rewriteImageTokens(`![hello world](image:${UUID_A})`, resolver);
    expect(out).toContain('alt="hello world"');
  });

  it('falls back to resolver alt when no inline alt is provided', () => {
    const out = rewriteImageTokens(`![](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg', alt: 'fallback' } : null,
    );
    expect(out).toContain('alt="fallback"');
  });

  it('leaves real http URLs untouched', () => {
    const body = `![](https://example.com/x.jpg)`;
    expect(rewriteImageTokens(body, resolver)).toBe(body);
  });

  it('leaves unresolved tokens unchanged', () => {
    const body = `![](image:${UUID_B})`;
    expect(rewriteImageTokens(body, resolver)).toBe(body);
  });

  it('handles multiple tokens on one line', () => {
    const out = rewriteImageTokens(
      `pre ![a](image:${UUID_A}) mid ![b](image:${UUID_A}) post`,
      resolver,
    );
    expect(out.match(/<img/g)?.length).toBe(2);
    expect(out).toContain('alt="a"');
    expect(out).toContain('alt="b"');
    expect(out).toMatch(/^pre /);
    expect(out).toMatch(/ post$/);
  });

  it('emits a <picture> with srcset when variants are provided', () => {
    const out = rewriteImageTokens(`![pic](image:${UUID_A})`, (id) =>
      id === UUID_A
        ? {
            url: 'https://cdn/a.jpg',
            variantWidths: [400, 800],
            variantUrlBase: 'https://cdn/a.jpg',
            width: 1600,
            height: 1200,
          }
        : null,
    );
    expect(out).toContain('<picture>');
    expect(out).toContain('type="image/webp"');
    expect(out).toContain('https://cdn/a.400w.webp 400w');
    expect(out).toContain('https://cdn/a.800w.jpg 800w');
    expect(out).toContain('width="1600"');
    expect(out).toContain('height="1200"');
  });

  it('escapes alt text into HTML attributes', () => {
    const out = rewriteImageTokens(`![he said "hi" & <ok>](image:${UUID_A})`, resolver);
    expect(out).toContain('alt="he said &quot;hi&quot; &amp; &lt;ok>"');
  });
});
