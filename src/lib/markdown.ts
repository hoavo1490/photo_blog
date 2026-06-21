// Markdown helpers. Pure string-level utilities; intentionally NOT a full
// markdown AST walk -- callers either render with `marked` for HTML output
// or use these helpers for previews / first-image extraction.
//
// The image-token format is the editor's internal contract for
// references-by-id: `![alt](image:<uuid>)`. When rendering a post, the
// publish pipeline calls `rewriteImageTokens` with a resolver that maps
// id -> R2 public URL. Real http(s) image URLs are passed through.

import { Marked } from 'marked';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE_TOKEN_RE = new RegExp(`!\\[([^\\]]*)\\]\\(image:(${UUID})\\)`, 'g');
const IMAGE_URL_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/;
const ANY_IMAGE_RE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;

/** First `image:<uuid>` reference in the body (uuid only). */
export function firstImageToken(body: string): string | null {
  const re = new RegExp(`!\\[[^\\]]*\\]\\(image:(${UUID})\\)`);
  const m = body.match(re);
  return m ? m[1] : null;
}

/** First http(s) URL in a markdown image `![](...)`. */
export function firstImageUrl(body: string): string | null {
  const m = body.match(IMAGE_URL_RE);
  return m ? m[2] : null;
}

/** All distinct image:<uuid> tokens, in document order. */
export function allImageTokens(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(IMAGE_TOKEN_RE)) {
    const id = m[2];
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** First plain text paragraph for previews. Skips:
 *    - heading lines (`# `, `## `, etc.)
 *    - fenced code blocks (``` ... ```)
 *    - image-only lines (`![alt](url)`)
 *  Returns null when no text content exists. Truncates at `maxChars` on
 *  a word boundary if the paragraph is longer. */
export function firstParagraph(body: string, maxChars = 200): string | null {
  if (!body) return null;
  const lines = body.split('\n');
  const paraLines: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence;
      // a fence boundary terminates an in-progress paragraph
      if (paraLines.length > 0) break;
      continue;
    }
    if (inFence) continue;
    if (line === '') {
      if (paraLines.length > 0) break;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (ANY_IMAGE_RE.test(line)) continue;
    paraLines.push(line);
  }

  if (paraLines.length === 0) return null;
  const text = stripMarkdown(paraLines.join(' '));
  if (text.length <= maxChars) return text;

  // Walk back from maxChars to the last space so we don't split a word.
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
}

/** Strip inline markdown formatting from a paragraph so it can be safely
 *  used as an SEO meta description / OG description / RSS blurb. Removes
 *  emphasis runs, inline code, link syntax (keeps the visible text), and
 *  any stray image tokens. Block-level constructs are already filtered
 *  by firstParagraph before this runs. */
export function stripMarkdown(s: string): string {
  let out = s;
  // Image tokens (in case any leaked past the paragraph filter).
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: [text](url) -> text
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // Inline code: `code` -> code
  out = out.replace(/`([^`]+)`/g, '$1');
  // Bold: **text** / __text__ -> text
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  // Italic: *text* / _text_ -> text. Boundary-guarded so foo_bar_baz stays intact.
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2');
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1$2');
  // Backslash escapes: \* -> *
  out = out.replace(/\\([\\`*_[\]])/g, '$1');
  // Collapse double spaces left by removals.
  return out.replace(/\s+/g, ' ').trim();
}

export interface ResolvedImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  /** Available responsive widths for srcset. Empty = no variants
   *  (legacy image); fall back to a plain ![alt](url). */
  variantWidths?: number[];
  /** When variantWidths is non-empty, the helper substitutes the
   *  url's extension to build `.<W>w.jpg`, `.<W>w.webp`, and (when
   *  hasAvif) `.<W>w.avif` URLs. */
  variantUrlBase?: string;
  /** True when matching `.<W>w.avif` variants exist in R2. Only
   *  emitted as a `<source type="image/avif">` when this is true,
   *  otherwise the picture chain stays at WebP -> JPEG. */
  hasAvif?: boolean;
}

export interface ImageResolver {
  (imageId: string): ResolvedImage | null;
}

/** Body image sizes attribute. The post detail page sits inside the
 *  750px page mixin, so on desktop the image is up to ~750px wide; on
 *  mobile it fills the viewport. */
const BODY_IMAGE_SIZES = '(max-width: 800px) 100vw, 750px';

function buildPictureHtml(resolved: ResolvedImage, alt: string, priority: boolean): string {
  const widths = resolved.variantWidths ?? [];
  const base = resolved.variantUrlBase;
  // First in-body image is the LCP candidate: eager + high priority +
  // sync decode. Everything else gets lazy + async + explicit LOW
  // priority so Chrome's network scheduler won't let stacked lazy
  // images steal bandwidth from the LCP fetch.
  const loading = priority ? 'eager' : 'lazy';
  const decoding = priority ? 'sync' : 'async';
  const fetchAttr = priority ? ' fetchpriority="high"' : ' fetchpriority="low"';

  if (widths.length === 0 || !base) {
    const dim = resolved.width && resolved.height
      ? ` width="${resolved.width}" height="${resolved.height}"`
      : '';
    return `<img src="${resolved.url}" alt="${escapeAttr(alt)}"${dim} loading="${loading}" decoding="${decoding}"${fetchAttr} data-pswp-src="${resolved.url}" />`;
  }

  const stripped = base.replace(/\.(jpe?g|png|webp|gif)$/i, '');
  const jpegSet = widths.map((w) => `${stripped}.${w}w.jpg ${w}w`).join(', ');
  const webpSet = widths.map((w) => `${stripped}.${w}w.webp ${w}w`).join(', ');
  const avifSet = widths.map((w) => `${stripped}.${w}w.avif ${w}w`).join(', ');
  const dim = resolved.width && resolved.height
    ? ` width="${resolved.width}" height="${resolved.height}"`
    : '';
  // Source order: AVIF (smallest, ~93% browser support) -> WebP (~95%) ->
  // JPEG <img> fallback. Browsers pick the first <source> whose `type`
  // they speak, so unsupported formats are skipped without a 404.
  const sources: string[] = [];
  if (resolved.hasAvif) {
    sources.push(`<source type="image/avif" srcset="${avifSet}" sizes="${BODY_IMAGE_SIZES}" />`);
  }
  sources.push(`<source type="image/webp" srcset="${webpSet}" sizes="${BODY_IMAGE_SIZES}" />`);
  // The primary R2 object is the largest variant by definition. Label
  // the canonical srcset entry with its real natural width so the
  // browser can pick it (and the lightbox can use it) on hi-DPR / 4K
  // viewports. Falls back to 1600 for legacy posts that didn't record
  // the primary's intrinsic width.
  const primaryWidth = resolved.width && resolved.width > 0 ? resolved.width : 1600;
  return [
    '<picture>',
    ...sources,
    `<img src="${resolved.url}" srcset="${jpegSet}, ${resolved.url} ${primaryWidth}w" sizes="${BODY_IMAGE_SIZES}" alt="${escapeAttr(alt)}"${dim} loading="${loading}" decoding="${decoding}"${fetchAttr} data-pswp-src="${resolved.url}" />`,
    '</picture>',
  ].join('');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Heuristic: does this alt text look like a meaningless camera/phone
 *  filename (e.g. "1000045235", "IMG_20240101_123456", "DSC01234")?
 *  Such "alt" comes from the upload's originalName and adds nothing for
 *  screen readers -- WCAG calls for empty alt on decorative images. */
function isFilenameSlugAlt(alt: string): boolean {
  if (!alt) return false;
  const trimmed = alt.trim();
  // Long pure-digit runs (>=7 digits) look like phone-camera filenames
  // (10-digit Pixel timestamps, 13-digit epoch ms, etc). Short digit
  // strings like "2024" or counts get to pass through as author intent.
  if (/^\d{7,}$/.test(trimmed)) return true;
  // Filename-shaped: digits + the editor's width-suffix or other
  // dot/dash/underscore decoration ("1000045235-1600w",
  // "1000045235.1600w", "IMG_20240101"). Has to START with digits or a
  // known camera prefix to qualify.
  if (/^\d{4,}[._\-][\w._\-]+$/.test(trimmed)) return true;
  if (/^(IMG|DSC|PXL|MVIMG|VID|PHOTO|P)[_-]?[\d_\-]+$/i.test(trimmed)) return true;
  return false;
}

/** Replace `![alt](image:<uuid>)` tokens with a responsive <picture>
 *  block (when variants exist) or a plain markdown image (when they
 *  don't). The first resolved image is emitted with eager loading and
 *  high fetchpriority -- it's the LCP candidate -- and every other
 *  image is lazy-loaded so they don't fight for bandwidth.
 *  Unresolved tokens stay as-is. */
export function rewriteImageTokens(body: string, resolve: ImageResolver): string {
  let resolvedCount = 0;
  return body.replace(IMAGE_TOKEN_RE, (whole, alt: string, id: string) => {
    const resolved = resolve(id);
    if (!resolved) return whole;
    // Inline alt wins when it's meaningful. If both the inline alt and
    // the resolved alt look like phone-camera filename slugs (the editor
    // auto-fills the inline alt from the filename), drop to empty alt
    // per WCAG "decorative image" semantics.
    let finalAlt = isFilenameSlugAlt(alt) ? '' : alt;
    if (!finalAlt) {
      const candidate = resolved.alt ?? '';
      finalAlt = isFilenameSlugAlt(candidate) ? '' : candidate;
    }
    const priority = resolvedCount === 0;
    resolvedCount++;
    return buildPictureHtml(resolved, finalAlt, priority);
  });
}

/** Returns LCP-preload info for the first resolved image in the body,
 *  or null if none. Used by PostLayout to add a <link rel="preload">
 *  for the first body image. */
export function firstBodyImageInfo(
  body: string,
  resolve: ImageResolver,
): { src: string; srcset?: string; webpSrcset?: string; avifSrcset?: string; sizes?: string } | null {
  for (const m of body.matchAll(IMAGE_TOKEN_RE)) {
    const id = m[2];
    const resolved = resolve(id);
    if (!resolved) continue;
    const widths = resolved.variantWidths ?? [];
    const base = resolved.variantUrlBase;
    if (widths.length === 0 || !base) {
      return { src: resolved.url };
    }
    const stripped = base.replace(/\.(jpe?g|png|webp|gif)$/i, '');
    const jpegSet = widths.map((w) => `${stripped}.${w}w.jpg ${w}w`).join(', ') + `, ${resolved.url} 1600w`;
    const webpSet = widths.map((w) => `${stripped}.${w}w.webp ${w}w`).join(', ');
    const avifSet = resolved.hasAvif
      ? widths.map((w) => `${stripped}.${w}w.avif ${w}w`).join(', ')
      : undefined;
    return {
      src: resolved.url,
      srcset: jpegSet,
      webpSrcset: webpSet,
      avifSrcset: avifSet,
      sizes: BODY_IMAGE_SIZES,
    };
  }
  return null;
}

// ─── Renderer: a Marked instance with shifted heading levels ────────
// The post page already has a single H1 (the post title in PostLayout).
// Any `#` in the body would create a second H1, splitting topical
// authority for SEO and breaking the document outline for assistive
// tech. This renderer shifts every body heading down one level: # → h2,
// ## → h3, ..., h5 → h6. h6 stays at h6 since there's no h7.
//
// Uses a fresh `Marked` instance (rather than mutating the global one
// via `marked.use`) so unit tests of the shared default `marked` keep
// their unshifted behavior.
const postMarked = new Marked();
postMarked.use({
  renderer: {
    heading(token) {
      const text = this.parser.parseInline(token.tokens);
      const shifted = Math.min(6, token.depth + 1);
      return `<h${shifted}>${text}</h${shifted}>\n`;
    },
  },
});

/** Render markdown intended for an article body, with heading levels
 *  shifted down by one so the post title remains the page's only H1. */
export async function renderPostHtml(md: string): Promise<string> {
  return postMarked.parse(md);
}
