// Embed renderer: turns standalone provider URLs in markdown bodies into
// safe <iframe> HTML before marked.parse runs.
//
// Author convention: an embed is a URL **on its own line**, with blank
// lines (or paragraph boundaries) above and below. Inline URLs inside a
// sentence are left alone — they become normal autolinks via marked.
//
// All emitted iframes use the host's no-cookie / privacy variant where
// available (youtube-nocookie.com), lazy-load, and carry no inline
// styles — the public stylesheet controls width / aspect-ratio.
//
// sanitize-html validates the iframe host against `allowedIframeHostnames`
// after this step. So even if a bad pattern matched here, only known
// hosts survive sanitization.

export interface EmbedHandler {
  /** Stable id used in the iframe class for CSS styling hooks. */
  provider: 'youtube' | 'spotify' | 'vimeo';
  /** Match a *single trimmed line*; return embed metadata or null. */
  match: (line: string) => EmbedMeta | null;
}

export interface EmbedMeta {
  provider: EmbedHandler['provider'];
  /** Final iframe `src`. */
  src: string;
  /** Display aspect ratio class — 'video' (16:9) or 'audio' (compact). */
  shape: 'video' | 'audio';
  /** allow= attribute value, per provider best practice. */
  allow: string;
  /** Title attribute (a11y). */
  title: string;
}

const YOUTUBE_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

const handlers: EmbedHandler[] = [
  {
    provider: 'youtube',
    match: (line) => {
      // youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/shorts/<id>
      const m =
        /^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(line) ||
        /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^ ]*&)?v=([A-Za-z0-9_-]{6,})/.exec(line) ||
        /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/.exec(line);
      if (!m) return null;
      return {
        provider: 'youtube',
        src: `https://www.youtube-nocookie.com/embed/${m[1]}`,
        shape: 'video',
        allow: YOUTUBE_ALLOW,
        title: 'YouTube video',
      };
    },
  },
  {
    provider: 'spotify',
    match: (line) => {
      // open.spotify.com/(track|album|playlist|episode|show)/<id>
      const m = /^https?:\/\/open\.spotify\.com\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/.exec(line);
      if (!m) return null;
      return {
        provider: 'spotify',
        src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
        // Album / playlist embeds prefer the wider audio shape; track
        // embeds also work fine in 'audio' (Spotify renders a compact
        // 152px-tall player by default).
        shape: 'audio',
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        title: 'Spotify embed',
      };
    },
  },
  {
    provider: 'vimeo',
    match: (line) => {
      const m = /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/.exec(line);
      if (!m) return null;
      return {
        provider: 'vimeo',
        src: `https://player.vimeo.com/video/${m[1]}`,
        shape: 'video',
        allow: 'autoplay; fullscreen; picture-in-picture; clipboard-write',
        title: 'Vimeo video',
      };
    },
  },
];

/** Detect a standalone embed URL on a single trimmed line. Exported for
 *  tests. */
export function detectEmbed(line: string): EmbedMeta | null {
  for (const h of handlers) {
    const m = h.match(line);
    if (m) return m;
  }
  return null;
}

/** Render an EmbedMeta into the iframe HTML that will survive sanitize.
 *  Wrapper <div class="embed embed--video|audio"> lets the public CSS
 *  enforce aspect-ratio without inline styles. */
export function renderEmbedHtml(m: EmbedMeta): string {
  return (
    `<div class="embed embed--${m.shape} embed--${m.provider}">` +
    `<iframe src="${m.src}" title="${m.title}" allow="${m.allow}" ` +
    `allowfullscreen="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>` +
    `</div>`
  );
}

/** Walk the markdown line-by-line; replace any standalone embed URL with
 *  pre-rendered iframe HTML. marked.parse will pass the HTML through. */
export function rewriteEmbeds(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const meta = trimmed ? detectEmbed(trimmed) : null;
    if (meta) {
      out.push(renderEmbedHtml(meta));
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** Allowed iframe hostnames for sanitize-html. Must stay in sync with
 *  the providers above; this is the actual security boundary. */
export const ALLOWED_IFRAME_HOSTNAMES = [
  'www.youtube-nocookie.com',
  'open.spotify.com',
  'player.vimeo.com',
];
