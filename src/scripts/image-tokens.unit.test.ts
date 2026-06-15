import { describe, it, expect } from 'vitest';
import {
  buildImageMapping,
  rememberImage,
  expandImageTokens,
  collapseImageTokens,
} from './image-tokens';

const UUID_A = '11111111-2222-3333-4444-555555555555';
const UUID_B = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const URL_A = '/img/site/2026/06/14/abc123-photo-a.jpg';
const URL_B = '/img/site/2026/06/14/def456-photo-b.jpg';

describe('buildImageMapping', () => {
  it('builds both directions of the lookup', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    expect(m.uuidToUrl.get(UUID_A)).toBe(URL_A);
    expect(m.urlToUuid.get(URL_A)).toBe(UUID_A);
  });

  it('handles empty input', () => {
    const m = buildImageMapping([]);
    expect(m.uuidToUrl.size).toBe(0);
    expect(m.urlToUuid.size).toBe(0);
  });
});

describe('rememberImage', () => {
  it('adds a new mapping in both directions', () => {
    const m = buildImageMapping([]);
    rememberImage(m, { id: UUID_A, url: URL_A });
    expect(m.uuidToUrl.get(UUID_A)).toBe(URL_A);
    expect(m.urlToUuid.get(URL_A)).toBe(UUID_A);
  });
});

describe('expandImageTokens', () => {
  it('replaces known tokens with their URL', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    expect(expandImageTokens(`![cover](image:${UUID_A})`, m)).toBe(`![cover](${URL_A})`);
  });

  it('preserves alt text exactly', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    expect(expandImageTokens(`![my photo](image:${UUID_A})`, m)).toBe(`![my photo](${URL_A})`);
    expect(expandImageTokens(`![](image:${UUID_A})`, m)).toBe(`![](${URL_A})`);
  });

  it('leaves unknown tokens untouched (recovery-safe)', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    const out = expandImageTokens(`![](image:${UUID_B})`, m);
    expect(out).toBe(`![](image:${UUID_B})`);
  });

  it('handles multiple tokens in the same document', () => {
    const m = buildImageMapping([
      { id: UUID_A, url: URL_A },
      { id: UUID_B, url: URL_B },
    ]);
    const body = `intro\n\n![](image:${UUID_A})\n\nmiddle\n\n![](image:${UUID_B})`;
    expect(expandImageTokens(body, m)).toBe(
      `intro\n\n![](${URL_A})\n\nmiddle\n\n![](${URL_B})`,
    );
  });

  it('leaves non-token markdown alone (text, headings, http URLs)', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    const body = `# Title\n\nThis is **bold** with a [link](https://example.com).\n\n![alt](https://cdn.example.com/foo.jpg)`;
    expect(expandImageTokens(body, m)).toBe(body);
  });
});

describe('collapseImageTokens', () => {
  it('replaces a known URL with its token', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    expect(collapseImageTokens(`![cover](${URL_A})`, m)).toBe(`![cover](image:${UUID_A})`);
  });

  it('leaves external URLs untouched', () => {
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    const body = `![](https://cdn.example.com/foo.jpg)`;
    expect(collapseImageTokens(body, m)).toBe(body);
  });

  it('handles multiple known URLs in one document', () => {
    const m = buildImageMapping([
      { id: UUID_A, url: URL_A },
      { id: UUID_B, url: URL_B },
    ]);
    const body = `![a](${URL_A})\n\n![b](${URL_B})`;
    expect(collapseImageTokens(body, m)).toBe(
      `![a](image:${UUID_A})\n\n![b](image:${UUID_B})`,
    );
  });

  it('round-trips with expandImageTokens (the editor lifecycle)', () => {
    const m = buildImageMapping([
      { id: UUID_A, url: URL_A },
      { id: UUID_B, url: URL_B },
    ]);
    const stored = `intro\n\n![cover](image:${UUID_A})\n\n![](image:${UUID_B})\n\nfin`;
    const expanded = expandImageTokens(stored, m);
    const recollapsed = collapseImageTokens(expanded, m);
    expect(recollapsed).toBe(stored);
  });

  it('preserves alt text edited in the editor', () => {
    // User opens post (alt=""), types "Sơn Trà sunset" while editing.
    // On save the new alt must survive the collapse back to a token.
    const m = buildImageMapping([{ id: UUID_A, url: URL_A }]);
    const editorOutput = `![Sơn Trà sunset](${URL_A})`;
    expect(collapseImageTokens(editorOutput, m)).toBe(`![Sơn Trà sunset](image:${UUID_A})`);
  });
});
