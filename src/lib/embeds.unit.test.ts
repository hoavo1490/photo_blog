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

  it('returns null for unrelated text and non-embed URLs', () => {
    expect(detectEmbed('hello world')).toBeNull();
    expect(detectEmbed('https://example.com/page')).toBeNull();
    expect(detectEmbed('check out https://youtu.be/X inline')).toBeNull();
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

  it('leaves inline URLs alone', () => {
    const md = 'see https://youtu.be/X for details';
    expect(rewriteEmbeds(md)).toBe(md);
  });

  it('handles multiple embeds in one document', () => {
    const md =
      'https://youtu.be/dQw4w9WgXcQ\n\nhttps://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    const out = rewriteEmbeds(md);
    expect((out.match(/<iframe/g) ?? []).length).toBe(2);
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
    ]) {
      const meta = detectEmbed(url);
      expect(meta).not.toBeNull();
      expect(hosts.has(new URL(meta!.src).hostname)).toBe(true);
    }
  });
});
