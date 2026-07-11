import { describe, it, expect } from 'vitest';
import { detectEmbed, rewriteEmbeds, ALLOWED_IFRAME_HOSTNAMES } from './embeds';

describe('detectEmbed', () => {
  it('matches YouTube short URL', () => {
    const m = detectEmbed('https://youtu.be/dQw4w9WgXcQ');
    expect(m?.provider).toBe('youtube');
    expect(m?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('matches YouTube watch URL', () => {
    const m = detectEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
    expect(m?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('matches Spotify track', () => {
    const m = detectEmbed('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    expect(m?.provider).toBe('spotify');
    expect(m?.src).toBe('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');
  });

  it('matches Vimeo', () => {
    const m = detectEmbed('https://vimeo.com/123456');
    expect(m?.provider).toBe('vimeo');
    expect(m?.src).toBe('https://player.vimeo.com/video/123456');
  });

  it('matches Apple Music album (audio shape)', () => {
    const m = detectEmbed('https://music.apple.com/us/album/folklore/1551278014');
    expect(m?.provider).toBe('applemusic');
    expect(m?.src).toBe('https://embed.music.apple.com/us/album/folklore/1551278014');
    expect(m?.shape).toBe('audio');
  });

  it('matches Apple Music playlist (playlist shape)', () => {
    const m = detectEmbed('https://music.apple.com/us/playlist/indie-vibes/pl.u-PmRNqP9TChg');
    expect(m?.provider).toBe('applemusic');
    expect(m?.src).toBe('https://embed.music.apple.com/us/playlist/indie-vibes/pl.u-PmRNqP9TChg');
    expect(m?.shape).toBe('playlist');
  });

  it('matches Apple Music song (?i= track query retained)', () => {
    const m = detectEmbed('https://music.apple.com/us/album/folklore/1551278014?i=1551278029');
    expect(m?.provider).toBe('applemusic');
    expect(m?.src).toBe('https://embed.music.apple.com/us/album/folklore/1551278014?i=1551278029');
    expect(m?.shape).toBe('audio');
  });

  it('matches Spotify playlist with the taller playlist shape', () => {
    const m = detectEmbed('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(m?.provider).toBe('spotify');
    expect(m?.src).toBe('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(m?.shape).toBe('playlist');
  });

  it('keeps a single Spotify track in the compact audio shape', () => {
    const m = detectEmbed('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    expect(m?.shape).toBe('audio');
  });

  it('returns null for unrelated text and non-embed URLs', () => {
    expect(detectEmbed('hello world')).toBeNull();
    expect(detectEmbed('https://example.com/page')).toBeNull();
    expect(detectEmbed('check out https://youtu.be/X inline')).toBeNull();
  });
});

describe('detectEmbed — /embed/ URL forms', () => {
  it('normalizes a YouTube /embed/ URL to the nocookie host', () => {
    const m = detectEmbed('https://www.youtube.com/embed/xQzNjsl18yY?si=Cze6q23NQCDA3z-u');
    expect(m?.provider).toBe('youtube');
    expect(m?.src).toBe('https://www.youtube-nocookie.com/embed/xQzNjsl18yY');
  });

  it('matches a Spotify /embed/ URL', () => {
    const m = detectEmbed('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT?utm_source=generator');
    expect(m?.src).toBe('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');
  });

  it('matches a Vimeo player URL', () => {
    const m = detectEmbed('https://player.vimeo.com/video/123456?h=abc');
    expect(m?.src).toBe('https://player.vimeo.com/video/123456');
  });

  it('matches an Apple Music embed host URL', () => {
    const m = detectEmbed('https://embed.music.apple.com/us/album/folklore/1551278014?theme=light');
    expect(m?.provider).toBe('applemusic');
    expect(m?.src).toBe('https://embed.music.apple.com/us/album/folklore/1551278014?theme=light');
  });
});

describe('detectEmbed — pasted <iframe> embed snippets', () => {
  it('normalizes a pasted YouTube iframe to the nocookie host', () => {
    const iframe =
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/xQzNjsl18yY?si=Cze6q23NQCDA3z-u" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
    const m = detectEmbed(iframe);
    expect(m?.provider).toBe('youtube');
    expect(m?.src).toBe('https://www.youtube-nocookie.com/embed/xQzNjsl18yY');
    expect(m?.shape).toBe('video');
  });

  it('handles a pasted Spotify iframe (single-quoted src)', () => {
    const iframe =
      "<iframe style='border-radius:12px' src='https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator' width='100%' height='352' frameBorder='0' allowfullscreen='' loading='lazy'></iframe>";
    const m = detectEmbed(iframe);
    expect(m?.provider).toBe('spotify');
    expect(m?.src).toBe('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(m?.shape).toBe('playlist');
  });

  it('handles a pasted Apple Music iframe', () => {
    const iframe =
      '<iframe allow="autoplay *; encrypted-media *;" frameborder="0" height="450" style="width:100%;max-width:660px;" src="https://embed.music.apple.com/us/playlist/indie-vibes/pl.u-PmRNqP9TChg?theme=light"></iframe>';
    const m = detectEmbed(iframe);
    expect(m?.provider).toBe('applemusic');
    expect(m?.src).toBe('https://embed.music.apple.com/us/playlist/indie-vibes/pl.u-PmRNqP9TChg?theme=light');
    expect(m?.shape).toBe('playlist');
  });

  it('ignores a non-provider iframe (src not on an allowed host)', () => {
    expect(detectEmbed('<iframe src="https://evil.example.com/x"></iframe>')).toBeNull();
  });
});

describe('rewriteEmbeds', () => {
  it('replaces a standalone embed line with iframe HTML', () => {
    const md = 'before\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nafter';
    const out = rewriteEmbeds(md);
    expect(out).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(out).toContain('class="embed embed--video embed--youtube"');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('rewrites a pasted YouTube iframe into a normalized nocookie embed', () => {
    const md =
      'intro\n\n<iframe width="560" height="315" src="https://www.youtube.com/embed/xQzNjsl18yY?si=abc" allowfullscreen></iframe>\n\noutro';
    const out = rewriteEmbeds(md);
    expect(out).toContain('<iframe src="https://www.youtube-nocookie.com/embed/xQzNjsl18yY"');
    expect(out).toContain('class="embed embed--video embed--youtube"');
    expect(out).not.toContain('www.youtube.com');
  });

  it('leaves inline URLs alone', () => {
    const md = 'see https://youtu.be/X for details';
    expect(rewriteEmbeds(md)).toBe(md);
  });

  it('handles multiple embeds in one document', () => {
    const md =
      'https://youtu.be/dQw4w9WgXcQ\n\nhttps://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT\n\nhttps://music.apple.com/us/playlist/indie-vibes/pl.u-PmRNqP9TChg';
    const out = rewriteEmbeds(md);
    expect((out.match(/<iframe/g) ?? []).length).toBe(3);
    expect(out).toContain('class="embed embed--playlist embed--applemusic"');
  });
});

describe('security envelope', () => {
  it('only emits iframes pointing at the documented host list', () => {
    const hosts = new Set(ALLOWED_IFRAME_HOSTNAMES);
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://vimeo.com/123456',
      'https://music.apple.com/us/album/folklore/1551278014',
      'https://music.apple.com/us/playlist/indie-vibes/pl.u-PmRNqP9TChg',
    ]) {
      const meta = detectEmbed(url);
      expect(meta).not.toBeNull();
      expect(hosts.has(new URL(meta!.src).hostname)).toBe(true);
    }
  });
});
