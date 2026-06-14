// Markdown helpers. Pure string-level utilities; intentionally NOT a full
// markdown AST walk -- callers either render with `marked` for HTML output
// or use these helpers for previews / first-image extraction.
//
// The image-token format is the editor's internal contract for
// references-by-id: `![alt](image:<uuid>)`. When rendering a post, the
// publish pipeline calls `rewriteImageTokens` with a resolver that maps
// id -> R2 public URL. Real http(s) image URLs are passed through.

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
  const text = paraLines.join(' ');
  if (text.length <= maxChars) return text;

  // Walk back from maxChars to the last space so we don't split a word.
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
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
   *  url's extension to build `.<W>w.jpg` and `.<W>w.webp` URLs. */
  variantUrlBase?: string;
}

export interface ImageResolver {
  (imageId: string): ResolvedImage | null;
}

/** Body image sizes attribute. The post detail page sits inside the
 *  750px page mixin, so on desktop the image is up to ~750px wide; on
 *  mobile it fills the viewport. */
const BODY_IMAGE_SIZES = '(max-width: 800px) 100vw, 750px';

function buildPictureHtml(resolved: ResolvedImage, alt: string): string {
  const widths = resolved.variantWidths ?? [];
  const base = resolved.variantUrlBase;
  if (widths.length === 0 || !base) {
    // No variants: a plain <img> with whatever dimensions the resolver
    // could give us. Width/height let the browser reserve layout and
    // avoid CLS.
    const dim = resolved.width && resolved.height
      ? ` width="${resolved.width}" height="${resolved.height}"`
      : '';
    return `<img src="${resolved.url}" alt="${escapeAttr(alt)}"${dim} data-pswp-src="${resolved.url}" />`;
  }

  // Strip .jpg from the base; variants are `<base>.<W>w.jpg` and
  // `<base>.<W>w.webp`.
  const stripped = base.replace(/\.(jpe?g|png|webp|gif)$/i, '');
  const jpegSet = widths.map((w) => `${stripped}.${w}w.jpg ${w}w`).join(', ');
  const webpSet = widths.map((w) => `${stripped}.${w}w.webp ${w}w`).join(', ');
  const dim = resolved.width && resolved.height
    ? ` width="${resolved.width}" height="${resolved.height}"`
    : '';
  return [
    '<picture>',
    `<source type="image/webp" srcset="${webpSet}" sizes="${BODY_IMAGE_SIZES}" />`,
    `<img src="${resolved.url}" srcset="${jpegSet}, ${resolved.url} 1600w" sizes="${BODY_IMAGE_SIZES}" alt="${escapeAttr(alt)}"${dim} decoding="async" data-pswp-src="${resolved.url}" />`,
    '</picture>',
  ].join('');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Replace `![alt](image:<uuid>)` tokens with a responsive <picture>
 *  block (when variants exist) or a plain markdown image (when they
 *  don't). The resulting HTML is passed through marked unchanged.
 *  Unresolved tokens stay as-is. */
export function rewriteImageTokens(body: string, resolve: ImageResolver): string {
  return body.replace(IMAGE_TOKEN_RE, (whole, alt: string, id: string) => {
    const resolved = resolve(id);
    if (!resolved) return whole;
    const finalAlt = alt || resolved.alt || '';
    return buildPictureHtml(resolved, finalAlt);
  });
}
