// Translates the editor's view of body images <-> our storage format.
//
// The DB stores body markdown with portable tokens: `![alt](image:<uuid>)`.
// The Worker's image proxy serves them at `/img/<r2-key>`. When the
// editor opens the post we want the user to SEE the actual image
// rendered inline, so we briefly swap the tokens for the resolved URL
// before handing the markdown to Milkdown. On save, we collapse the
// URLs back to tokens so the storage stays portable (image record
// owns the canonical r2_key; tokens follow it across re-uploads /
// future custom domains).
//
// All functions here are pure -- easy to unit-test, no side effects.

const TOKEN_RE = /!\[([^\]]*)\]\(image:([0-9a-f-]{36})\)/g;
// Lenient image-anywhere regex used when collapsing the editor's
// output. Stops at the first whitespace inside the URL (handles
// markdown titles like `![alt](url "title")` by not consuming them).
const ANY_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export interface ImageMapping {
  /** Forward direction for "open the post in the editor". */
  readonly uuidToUrl: Map<string, string>;
  /** Reverse direction for "save what the user typed". */
  readonly urlToUuid: Map<string, string>;
}

export function buildImageMapping(entries: Iterable<{ id: string; url: string }>): ImageMapping {
  const uuidToUrl = new Map<string, string>();
  const urlToUuid = new Map<string, string>();
  for (const e of entries) {
    uuidToUrl.set(e.id, e.url);
    urlToUuid.set(e.url, e.id);
  }
  return { uuidToUrl, urlToUuid };
}

/** Adds (or replaces) a single mapping. Mutates in place -- used by
 *  the upload flow when a new image record is created mid-edit. */
export function rememberImage(map: ImageMapping, entry: { id: string; url: string }): void {
  (map.uuidToUrl as Map<string, string>).set(entry.id, entry.url);
  (map.urlToUuid as Map<string, string>).set(entry.url, entry.id);
}

/** Replace every `image:<uuid>` token with its resolved URL when known.
 *  Tokens whose uuid isn't in the map are left untouched so they remain
 *  recoverable (better than silently dropping them). */
export function expandImageTokens(markdown: string, map: ImageMapping): string {
  return markdown.replace(TOKEN_RE, (whole, alt, uuid) => {
    const url = map.uuidToUrl.get(uuid);
    return url ? `![${alt}](${url})` : whole;
  });
}

/** Replace every `/img/...` URL we recognize with the corresponding
 *  `image:<uuid>` token. External URLs (anything not in the map) pass
 *  through unchanged so the user's plain http(s) images keep working. */
export function collapseImageTokens(markdown: string, map: ImageMapping): string {
  return markdown.replace(ANY_IMAGE_RE, (whole, alt, url) => {
    const uuid = map.urlToUuid.get(url);
    return uuid ? `![${alt}](image:${uuid})` : whole;
  });
}
