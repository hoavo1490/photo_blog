/** Extract a cover image URL from the raw markdown body of a post. */
export function firstImage(body: string): string | null {
  // Markdown: ![alt](url)  (also matches the [![alt](url)](link) wrapper form)
  const md = body.match(/!\[[^\]]*\]\(([^)\s]+)/);
  if (md) return md[1];
  // Raw HTML: <img src="url">
  const html = body.match(/<img[^>]+src=["']([^"']+)["']/i);
  return html ? html[1] : null;
}

/** First non-empty paragraph as a plaintext description, truncated. */
export function firstParagraph(body: string, max = 180): string | null {
  // Strip frontmatter is already done by the loader; body is markdown after `---`.
  // Skip leading images / blockquotes / headings; find first paragraph-like line.
  const lines = body.split(/\r?\n/);
  const buf: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    // Skip pure-image / link-only / heading / blockquote / code lines.
    if (/^!\[/.test(t)) continue;
    if (/^\[!\[/.test(t)) continue;
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^>/.test(t)) continue;
    if (/^```/.test(t)) continue;
    if (/^<\w/.test(t)) continue;
    buf.push(t);
  }
  if (!buf.length) return null;
  const text = buf.join(' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')        // strip images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // unwrap [text](url) -> text
    .replace(/[*_`~]/g, '')                       // strip md emphasis chars
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}
