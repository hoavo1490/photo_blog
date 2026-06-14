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

export interface ImageResolver {
  (imageId: string): { url: string; alt?: string; width?: number; height?: number } | null;
}

/** Replace `![alt](image:<uuid>)` tokens with `![alt](resolved-url)`.
 *  Real URLs pass through untouched. Unresolved tokens are left as-is so
 *  the caller can decide whether to log or surface them. */
export function rewriteImageTokens(body: string, resolve: ImageResolver): string {
  return body.replace(IMAGE_TOKEN_RE, (whole, alt: string, id: string) => {
    const resolved = resolve(id);
    if (!resolved) return whole;
    const finalAlt = alt || resolved.alt || '';
    return `![${finalAlt}](${resolved.url})`;
  });
}
