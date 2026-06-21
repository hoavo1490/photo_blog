// Lossless-for-the-supported-set converter between Editor.js OutputData
// and CommonMark markdown. Keeps storage in markdown so the existing
// preview / RSS / public-render pipelines stay unchanged.
//
// Supported blocks (must match the tools enabled in body-editor-editorjs.ts):
//   paragraph, header, list (ordered/unordered, nested), quote, code,
//   delimiter, image.
// Supported inline marks: bold, italic, inline-code, link.
//
// Anything outside this set is intentionally dropped on the markdown
// side so we never persist editor-only state that would silently
// disappear on round-trip.

export interface EditorJsBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface EditorJsOutput {
  time?: number;
  blocks: EditorJsBlock[];
  version?: string;
}

// ─── inline HTML <-> inline markdown ──────────────────────────────────

/** Editor.js stores inline-formatted text as a small HTML fragment in
 *  `data.text`. Convert that fragment into the markdown equivalent. We
 *  parse with the browser's DOMParser when available (editor runs in
 *  the browser); when run from tests under Node we fall through to a
 *  regex-based path that handles the same closed set of tags. */
export function inlineHtmlToMarkdown(html: string): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild as HTMLElement | null;
    return root ? walkInline(root) : '';
  }
  return inlineHtmlToMarkdownRegex(html);
}

function walkInline(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      out += escapeMarkdown(child.nodeValue ?? '');
      return;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = walkInline(el);
    switch (tag) {
      case 'b':
      case 'strong':
        out += `**${inner}**`;
        break;
      case 'i':
      case 'em':
        out += `*${inner}*`;
        break;
      case 'code':
        out += `\`${el.textContent ?? ''}\``;
        break;
      case 'a': {
        const href = el.getAttribute('href') ?? '';
        out += `[${inner}](${href})`;
        break;
      }
      case 'br':
        out += '\n';
        break;
      default:
        out += inner;
    }
  });
  return out;
}

function escapeMarkdown(text: string): string {
  // Only escape the characters that would otherwise become syntax in a
  // paragraph context. Aggressive escaping would defeat the readability
  // of stored markdown for things like RSS previews and grep.
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

/** Fallback for Node-side unit tests (no DOMParser). Handles the same
 *  tag set the DOM walker does, just less robustly with nested
 *  attributes. */
function inlineHtmlToMarkdownRegex(html: string): string {
  let out = html;
  out = out.replace(/<br\s*\/?>(?!\n)/gi, '\n');
  out = out.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `**${inlineHtmlToMarkdownRegex(inner)}**`);
  out = out.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `*${inlineHtmlToMarkdownRegex(inner)}*`);
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${stripTags(inner)}\``);
  out = out.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `[${inlineHtmlToMarkdownRegex(inner)}](${href})`);
  out = stripTags(out);
  out = decodeEntities(out);
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Markdown inline string → minimal HTML for Editor.js. Only emits the
 *  tags Editor.js renders natively (b, i, code, a). */
export function markdownInlineToHtml(md: string): string {
  if (!md) return '';
  // Order matters: code spans first (their contents shouldn't be
  // re-processed), then links, then bold (** before *), then italic.
  let s = escapeHtml(md);
  // Re-introduce \* etc. — escapeHtml didn't touch backslash escapes.
  // Code spans: `…` — capture lazily.
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  // Bold: **…**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<b>${c}</b>`);
  // Italic: *…* or _…_  (avoid matching inside <a>/<b>/<code> by
  // requiring non-* boundaries — simple enough for our content).
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, (_, pre, c) => `${pre}<i>${c}</i>`);
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, (_, pre, c) => `${pre}<i>${c}</i>`);
  // Resolve backslash escapes (\*, \_, etc.) into bare characters.
  s = s.replace(/\\([\\`*_[\]])/g, '$1');
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── blocks <-> markdown ─────────────────────────────────────────────

export function editorJsToMarkdown(data: EditorJsOutput | null | undefined): string {
  if (!data || !Array.isArray(data.blocks)) return '';
  const out: string[] = [];
  for (const block of data.blocks) {
    const rendered = renderBlock(block);
    if (rendered !== null) out.push(rendered);
  }
  return out.join('\n\n').trim() + (out.length ? '\n' : '');
}

function renderBlock(block: EditorJsBlock): string | null {
  switch (block.type) {
    case 'paragraph': {
      const text = String(block.data?.text ?? '');
      return inlineHtmlToMarkdown(text);
    }
    case 'header': {
      const lvl = Math.min(6, Math.max(1, Number(block.data?.level) || 2));
      const text = inlineHtmlToMarkdown(String(block.data?.text ?? ''));
      return `${'#'.repeat(lvl)} ${text}`;
    }
    case 'list': {
      const style = block.data?.style === 'ordered' ? 'ordered' : 'unordered';
      const items = (block.data?.items ?? []) as unknown[];
      return renderList(items, style, 0);
    }
    case 'quote': {
      const text = inlineHtmlToMarkdown(String(block.data?.text ?? ''));
      const caption = inlineHtmlToMarkdown(String(block.data?.caption ?? ''));
      const lines = text.split('\n').map((l) => `> ${l}`).join('\n');
      return caption ? `${lines}\n> — ${caption}` : lines;
    }
    case 'code': {
      const code = String(block.data?.code ?? '');
      return '```\n' + code.replace(/\n+$/, '') + '\n```';
    }
    case 'delimiter':
      return '---';
    case 'image': {
      const data = block.data as { file?: { url?: string }; url?: string; caption?: string };
      const url = data.file?.url ?? data.url ?? '';
      if (!url) return null;
      const alt = inlineHtmlToMarkdown(String(data.caption ?? ''));
      return `![${alt}](${url})`;
    }
    default:
      return null;
  }
}

interface ListItemShape {
  content?: string;
  items?: ListItemShape[];
}

function renderList(items: unknown[], style: 'ordered' | 'unordered', depth: number): string {
  const indent = '  '.repeat(depth);
  return items
    .map((raw, i) => {
      // @editorjs/list 2.x uses { content, items }; 1.x stored plain strings.
      const item: ListItemShape =
        typeof raw === 'string' ? { content: raw, items: [] } : (raw as ListItemShape);
      const bullet = style === 'ordered' ? `${i + 1}.` : '-';
      const content = inlineHtmlToMarkdown(item.content ?? '');
      let line = `${indent}${bullet} ${content}`;
      if (item.items && item.items.length) {
        line += '\n' + renderList(item.items, style, depth + 1);
      }
      return line;
    })
    .join('\n');
}

// ─── markdown -> blocks ──────────────────────────────────────────────

export function markdownToEditorJs(markdown: string): EditorJsOutput {
  const blocks: EditorJsBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines between blocks.
    if (line.trim() === '') { i++; continue; }

    // Fenced code: ```...```
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', data: { code: codeLines.join('\n') } });
      continue;
    }

    // Horizontal rule.
    if (/^(\s*)(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: 'delimiter', data: {} });
      i++; continue;
    }

    // Heading: # … ######
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'header', data: { text: markdownInlineToHtml(h[2]), level: h[1].length } });
      i++; continue;
    }

    // Image-only paragraph (standalone): ![alt](url)
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (img) {
      blocks.push({
        type: 'image',
        data: { file: { url: img[2] }, caption: markdownInlineToHtml(img[1]), withBorder: false, stretched: false, withBackground: false },
      });
      i++; continue;
    }

    // Blockquote: > …  (consume contiguous quoted lines, last "> — caption" becomes the caption)
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      let text = quoteLines.join('\n');
      let caption = '';
      const capMatch = /\n— (.+)$/.exec(text);
      if (capMatch) {
        caption = capMatch[1];
        text = text.slice(0, capMatch.index);
      }
      blocks.push({
        type: 'quote',
        data: {
          text: markdownInlineToHtml(text),
          caption: markdownInlineToHtml(caption),
          alignment: 'left',
        },
      });
      continue;
    }

    // List: contiguous lines starting with `- `, `* `, `+ `, or `N. `.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const result = parseList(lines, i);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    // Paragraph: accumulate non-blank, non-block-starter lines.
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') break;
      if (/^(#{1,6}\s|```|>\s?|---\s*$|\s*([-*+]|\d+\.)\s+|!\[)/.test(next)) break;
      paraLines.push(next);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      data: { text: markdownInlineToHtml(paraLines.join('\n')) },
    });
  }

  return { time: Date.now(), blocks, version: '2.31.0' };
}

interface ListParseResult {
  block: EditorJsBlock;
  next: number;
}

function parseList(lines: string[], start: number): ListParseResult {
  const first = /^(\s*)([-*+]|\d+\.)\s+/.exec(lines[start])!;
  const baseIndent = first[1].length;
  const style: 'ordered' | 'unordered' = /\d/.test(first[2]) ? 'ordered' : 'unordered';

  const items: ListItemShape[] = [];
  let i = start;

  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
    if (!m) break;
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent === baseIndent) {
      items.push({ content: markdownInlineToHtml(m[3]), items: [] });
      i++;
    } else {
      // Nested — recurse, attach to last item.
      const nested = parseList(lines, i);
      const last = items[items.length - 1];
      if (last) {
        const nestedData = nested.block.data as { items?: ListItemShape[] };
        last.items = nestedData.items ?? [];
      }
      i = nested.next;
    }
  }

  return {
    block: { type: 'list', data: { style, items } },
    next: i,
  };
}
