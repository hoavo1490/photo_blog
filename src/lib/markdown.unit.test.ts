import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import {
  firstImageToken,
  firstImageUrl,
  firstParagraph,
  allImageTokens,
  rewriteImageTokens,
} from './markdown';
import { sanitizePostHtml } from './sanitize-html';

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

  it('labels the canonical srcset entry with the primary width (not a hardcoded 1600w)', () => {
    // The primary R2 object is the LARGEST variant by definition. With the
    // new 2400w target tier in place, the primary can now be 2400px wide.
    // The srcset entry for `resolved.url` has to declare that real width
    // so the browser doesn't underpick on hi-DPR / lightbox use.
    const out = rewriteImageTokens(`![pic](image:${UUID_A})`, (id) =>
      id === UUID_A
        ? {
            url: 'https://cdn/big.jpg',
            variantWidths: [400, 800, 1200, 1600],
            variantUrlBase: 'https://cdn/big.jpg',
            width: 2400,
            height: 1600,
          }
        : null,
    );
    expect(out).toContain('https://cdn/big.jpg 2400w');
    expect(out).not.toContain('https://cdn/big.jpg 1600w');
  });

  it('escapes alt text into HTML attributes', () => {
    const out = rewriteImageTokens(`![he said "hi" & <ok>](image:${UUID_A})`, resolver);
    expect(out).toContain('alt="he said &quot;hi&quot; &amp; &lt;ok>"');
  });

  it('emits alt="" when resolver alt is a digit-only filename slug', () => {
    // Phone-camera filenames like "1000045235" carry no semantic value;
    // WCAG-correct treatment is empty alt (decorative).
    const out = rewriteImageTokens(`![](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg', alt: '1000045235' } : null,
    );
    expect(out).toContain('alt=""');
    expect(out).not.toContain('alt="1000045235"');
  });

  it('emits alt="" when resolver alt looks like an IMG_ filename', () => {
    const out = rewriteImageTokens(`![](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg', alt: 'IMG_20240101_123456' } : null,
    );
    expect(out).toContain('alt=""');
  });

  it('keeps short digit inline alt (4-digit year-like captions pass through)', () => {
    const out = rewriteImageTokens(`![2024](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg', alt: '1000045235' } : null,
    );
    expect(out).toContain('alt="2024"');
  });

  it('strips inline slug alt but lets a meaningful resolver alt win', () => {
    // The editor auto-fills the inline alt from the upload filename.
    // If the row carries a real caption set elsewhere, that promotes.
    const out = rewriteImageTokens(`![1000045235](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg', alt: 'sunset over Sơn Trà' } : null,
    );
    expect(out).toContain('alt="sunset over Sơn Trà"');
    expect(out).not.toContain('alt="1000045235"');
  });

  it('emits alt="" when both inline and resolver alts are filename slugs', () => {
    // The real-world case: editor inserts the digit filename as alt,
    // DB originalName is the same string. Neither is semantic.
    const out = rewriteImageTokens(`![1000045235](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg', alt: '1000045235.1600w.jpg' } : null,
    );
    expect(out).toContain('alt=""');
    expect(out).not.toContain('alt="1000045235"');

    const out2 = rewriteImageTokens(`![1000045235-1600w](image:${UUID_A})`, (id) =>
      id === UUID_A ? { url: 'https://cdn/a.jpg' } : null,
    );
    expect(out2).toContain('alt=""');
  });
});

describe('sanitizePostHtml', () => {
  it('strips <script> tags from marked output', async () => {
    const md = `# hi\n\n<script>alert(1)</script>\n\nbye`;
    const rendered = await marked.parse(md);
    const clean = sanitizePostHtml(rendered);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
    expect(clean).toContain('<h1');
    expect(clean).toContain('bye');
  });

  it('strips inline event handlers like onerror', () => {
    const dirty = `<img src="x" onerror="alert(1)" />`;
    const clean = sanitizePostHtml(dirty);
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert');
  });

  it('strips javascript: hrefs', () => {
    const dirty = `<a href="javascript:alert(1)">click</a>`;
    const clean = sanitizePostHtml(dirty);
    expect(clean).not.toContain('javascript:');
  });

  it('preserves the rewriter <picture><source><img> chain intact', () => {
    const dirty =
      '<picture>' +
      '<source type="image/avif" srcset="https://cdn/a.400w.avif 400w" sizes="(max-width: 800px) 100vw, 750px" />' +
      '<source type="image/webp" srcset="https://cdn/a.400w.webp 400w" sizes="(max-width: 800px) 100vw, 750px" />' +
      '<img src="https://cdn/a.jpg" srcset="https://cdn/a.400w.jpg 400w" sizes="(max-width: 800px) 100vw, 750px" alt="pic" width="1600" height="1200" loading="lazy" decoding="async" fetchpriority="low" data-pswp-src="https://cdn/a.jpg" />' +
      '</picture>';
    const clean = sanitizePostHtml(dirty);
    expect(clean).toContain('<picture>');
    expect(clean).toContain('type="image/avif"');
    expect(clean).toContain('type="image/webp"');
    expect(clean).toContain('srcset="https://cdn/a.400w.jpg 400w"');
    expect(clean).toContain('sizes="(max-width: 800px) 100vw, 750px"');
    expect(clean).toContain('loading="lazy"');
    expect(clean).toContain('decoding="async"');
    expect(clean).toContain('fetchpriority="low"');
    expect(clean).toContain('data-pswp-src="https://cdn/a.jpg"');
    expect(clean).toContain('width="1600"');
    expect(clean).toContain('height="1200"');
  });

  it('keeps standard markdown output (headings, lists, code, links)', async () => {
    const md = `# Title\n\nSome **bold** text and a [link](https://example.com).\n\n- one\n- two\n\n\`code\`\n\n\`\`\`\nfenced\n\`\`\``;
    const rendered = await marked.parse(md);
    const clean = sanitizePostHtml(rendered);
    expect(clean).toContain('<h1');
    expect(clean).toContain('<strong>bold</strong>');
    expect(clean).toContain('<a href="https://example.com"');
    expect(clean).toContain('<ul>');
    expect(clean).toContain('<li>one</li>');
    expect(clean).toContain('<code>');
    expect(clean).toContain('<pre>');
  });

  it('strips <iframe> and <style>', () => {
    const dirty = `<iframe src="https://evil"></iframe><style>p{display:none}</style><p>ok</p>`;
    const clean = sanitizePostHtml(dirty);
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<style');
    expect(clean).toContain('<p>ok</p>');
  });
});
