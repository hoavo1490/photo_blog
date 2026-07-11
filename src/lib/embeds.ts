// Embed renderer: turns standalone provider URLs in markdown bodies into
// safe <iframe> HTML before marked.parse runs.
//
// Author convention: an embed is a URL **on its own line**, with blank
// lines (or paragraph boundaries) above and below. Inline URLs inside a
// sentence are left alone — they become normal autolinks via marked.
//
// Authors may also paste a provider's ready-made "embed code" (a full
// `<iframe …>` snippet on its own line). We pull the `src` out of it and
// run it through the same handlers, so the pasted iframe is normalized to
// our privacy host + CSS wrapper rather than surviving raw. This matters
// most for YouTube: its embed code points at www.youtube.com, which is NOT
// in the iframe allowlist, so a raw paste would have its src stripped by
// sanitize-html and render as an empty box. Normalizing rewrites it to the
// allowlisted youtube-nocookie host. Both the canonical share URL and the
// `/embed/` URL form are recognized for every provider.
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
  provider: 'youtube' | 'spotify' | 'vimeo' | 'applemusic';
  /** Match a *single trimmed line*; return embed metadata or null. */
  match: (line: string) => EmbedMeta | null;
}

export interface EmbedMeta {
  provider: EmbedHandler['provider'];
  /** Final iframe `src`. */
  src: string;
  /** Display shape — 'video' (16:9), 'audio' (compact 152px), or
   *  'playlist' (tall 450px for Apple Music stream playlists). */
  shape: 'video' | 'audio' | 'playlist';
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
      // youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/shorts/<id>,
      // and the embed form youtube(-nocookie).com/embed/<id> (the src of a
      // pasted embed snippet). All normalize to the nocookie host.
      const m =
        /^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(line) ||
        /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^ ]*&)?v=([A-Za-z0-9_-]{6,})/.exec(line) ||
        /^https?:\/\/(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/.exec(line) ||
        /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/.exec(line);
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
      // open.spotify.com/(track|album|playlist|episode|show)/<id> and the
      // embed form open.spotify.com/embed/<type>/<id> (the src of a pasted
      // embed snippet). Query strings (utm_source=generator, ?si=…) are
      // dropped by rebuilding the canonical embed URL.
      const m = /^https?:\/\/open\.spotify\.com\/(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/.exec(line);
      if (!m) return null;
      const type = m[1];
      // A single track / episode fits Spotify's compact 152px player, but
      // a playlist / album / show streams a scrollable track list that is
      // unusable at 152px — give those the taller 'playlist' shape so the
      // list is actually visible.
      const isList = type === 'playlist' || type === 'album' || type === 'show';
      return {
        provider: 'spotify',
        src: `https://open.spotify.com/embed/${type}/${m[2]}`,
        shape: isList ? 'playlist' : 'audio',
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        title: 'Spotify embed',
      };
    },
  },
  {
    provider: 'vimeo',
    match: (line) => {
      // vimeo.com/<id> and the embed form player.vimeo.com/video/<id>
      // (the src of a pasted embed snippet).
      const m =
        /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/.exec(line) ||
        /^https?:\/\/player\.vimeo\.com\/video\/(\d+)/.exec(line);
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
  {
    provider: 'applemusic',
    match: (line) => {
      // music.apple.com/{country}/{type}/{slug}/{id}[?i=trackNum], plus
      // the embed form embed.music.apple.com/… (the src of a pasted embed
      // snippet). Embed host swaps music.apple.com → embed.music.apple.com
      // and keeps the full path including query string. Playlists get a
      // taller 'playlist' shape (450px) because Apple Music streams the
      // track list; everything else uses 'audio' (152px) which is tall
      // enough for the compact album/track player.
      const m = /^https?:\/\/(?:embed\.)?music\.apple\.com\/(\S+)/.exec(line);
      if (!m) return null;
      const path = m[1];
      const isPlaylist = /\/playlist\//.test(path);
      return {
        provider: 'applemusic',
        src: `https://embed.music.apple.com/${path}`,
        shape: isPlaylist ? 'playlist' : 'audio',
        allow: 'encrypted-media',
        title: isPlaylist ? 'Apple Music playlist' : 'Apple Music',
      };
    },
  },
];

/** Pull the `src` URL out of a standalone pasted `<iframe …>` embed
 *  snippet. Returns null when the trimmed line isn't an iframe tag or has
 *  no src. Only single-line iframes are recognized — every provider's
 *  copy-paste embed code is emitted on a single line. */
function iframeSrc(line: string): string | null {
  if (!/^<iframe[\s>]/i.test(line)) return null;
  const m = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(line);
  return m ? m[1] : null;
}

/** Detect a standalone embed on a single trimmed line — either a bare
 *  provider URL or a pasted `<iframe>` embed snippet. Exported for tests. */
export function detectEmbed(line: string): EmbedMeta | null {
  for (const h of handlers) {
    const m = h.match(line);
    if (m) return m;
  }
  // Fall back to a pasted iframe: extract its src and re-run the handlers
  // against the URL. This normalizes the paste to our privacy host + CSS
  // wrapper, and keeps the emitted src on an allowlisted host (e.g.
  // youtube.com/embed → youtube-nocookie.com).
  const src = iframeSrc(line);
  if (src) {
    for (const h of handlers) {
      const m = h.match(src);
      if (m) return m;
    }
  }
  return null;
}

/** Render an EmbedMeta into the iframe HTML that will survive sanitize.
 *  Wrapper <div class="embed embed--video|audio|playlist"> lets the
 *  public CSS enforce aspect-ratio without inline styles. */
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
  'embed.music.apple.com',
];
