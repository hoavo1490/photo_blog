// HTML sanitizer for rendered markdown.
//
// `marked.parse()` runs with raw-HTML passthrough by default -- any
// `<script>` an author writes lands in the published page. We pipe the
// rendered output through sanitize-html before `set:html` so a hostile
// author can't XSS readers.
//
// The allowlist must INCLUDE everything `rewriteImageTokens` emits
// (<picture>, <source srcset/sizes>, <img srcset/sizes/data-pswp-src/
// loading/decoding/fetchpriority>) so the responsive picture chain
// survives sanitization intact.

import sanitizeHtmlLib from 'sanitize-html';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li',
  'a', 'blockquote', 'code', 'pre',
  'strong', 'em', 'b', 'i', 's', 'del',
  'hr', 'br',
  'picture', 'source', 'img',
  'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span',
];

/** Sanitize HTML rendered from markdown. The allowlist intentionally
 *  matches what `rewriteImageTokens` emits plus the standard `marked`
 *  output -- nothing else (no <script>, no <iframe>, no inline handlers,
 *  no <style>). */
export function sanitizePostHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: [
        'src', 'alt', 'title', 'width', 'height',
        'srcset', 'sizes',
        'loading', 'decoding', 'fetchpriority',
        'data-pswp-src',
      ],
      source: ['srcset', 'sizes', 'type', 'media'],
      picture: [],
      code: ['class'],
      pre: ['class'],
      span: ['class'],
      // Block tags (h1-h6, p, ul, ol, li, blockquote, table cells) have no
      // useful attributes from markdown; leaving them empty keeps the door
      // shut on `style=` smuggling.
    },
    // Schemes allowed in href/src. `data:` for <img> would let an author
    // smuggle large blobs in HTML and bypass R2, so we exclude it.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset'],
    // sanitize-html parses srcset properly when this is on.
    allowProtocolRelative: false,
  });
}
