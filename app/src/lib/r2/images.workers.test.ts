import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  keyFor,
  uploadImage,
  publicUrlForKey,
  deleteImage,
  readImageDimensions,
} from './images';

// `env.PHOTOS` is the Miniflare R2 binding configured in vitest.config.ts.
// `env.R2_PUBLIC_BASE` / `env.R2_DEV_BASE` are set as bindings in the same
// place so the helpers under test resolve real URLs.

const SITE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(async () => {
  // List + delete everything between tests so dedupe assertions are clean.
  const listed = await env.PHOTOS.list();
  await Promise.all(listed.objects.map((o: { key: string }) => env.PHOTOS.delete(o.key)));
});

describe('keyFor', () => {
  it('is deterministic for the same bytes, name, and site within a UTC day', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const a = await keyFor({ siteId: SITE, originalName: 'hello.jpg', bytes });
    const b = await keyFor({ siteId: SITE, originalName: 'hello.jpg', bytes });
    expect(a).toBe(b);
  });

  it('produces different keys for different bytes', async () => {
    const a = await keyFor({
      siteId: SITE,
      originalName: 'x.jpg',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const b = await keyFor({
      siteId: SITE,
      originalName: 'x.jpg',
      bytes: new Uint8Array([4, 5, 6]),
    });
    expect(a).not.toBe(b);
  });

  it('normalizes weird filenames', async () => {
    const bytes = new Uint8Array([1]);
    const spaces = await keyFor({ siteId: SITE, originalName: 'Hello World.JPG', bytes });
    expect(spaces.endsWith('-hello-world.jpg')).toBe(true);

    const unicode = await keyFor({ siteId: SITE, originalName: 'phở bò.png', bytes });
    expect(unicode.endsWith('-pho-bo.png')).toBe(true);

    const noExt = await keyFor({ siteId: SITE, originalName: 'just-a-name', bytes });
    expect(noExt.endsWith('-just-a-name')).toBe(true);

    const allSymbols = await keyFor({ siteId: SITE, originalName: '!!!.???', bytes });
    // stem becomes empty -> 'image'; ext stripped of symbols -> ''
    expect(allSymbols.endsWith('-image')).toBe(true);
  });
});

describe('uploadImage', () => {
  it('round-trips bytes and contentType through R2', async () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const result = await uploadImage(
      env.PHOTOS,
      { siteId: SITE, originalName: 'pic.jpg', bytes, contentType: 'image/jpeg' },
      env,
    );

    const obj = await env.PHOTOS.get(result.r2Key);
    expect(obj).not.toBeNull();
    const got = new Uint8Array(await obj!.arrayBuffer());
    expect(Array.from(got)).toEqual(Array.from(bytes));
    expect(obj!.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('returns a publicUrl matching publicUrlForKey', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await uploadImage(
      env.PHOTOS,
      { siteId: SITE, originalName: 'a.png', bytes, contentType: 'image/png' },
      env,
    );
    expect(result.publicUrl).toBe(publicUrlForKey(result.r2Key, env));
  });
});

describe('publicUrlForKey', () => {
  it('prefers R2_PUBLIC_BASE over R2_DEV_BASE', () => {
    const url = publicUrlForKey('s/2025/01/01/abc-x.jpg', {
      R2_PUBLIC_BASE: 'https://media.example.com',
      R2_DEV_BASE: 'https://dev.r2.dev',
    });
    expect(url).toBe('https://media.example.com/s/2025/01/01/abc-x.jpg');
  });

  it('falls back to R2_DEV_BASE when no public base is set', () => {
    const url = publicUrlForKey('s/x.jpg', { R2_DEV_BASE: 'https://dev.r2.dev' });
    expect(url).toBe('https://dev.r2.dev/s/x.jpg');
  });

  it('throws when neither base is set', () => {
    expect(() => publicUrlForKey('s/x.jpg', {})).toThrow(/R2_PUBLIC_BASE|R2_DEV_BASE/);
  });

  it('strips a trailing slash on the base', () => {
    const url = publicUrlForKey('s/x.jpg', { R2_PUBLIC_BASE: 'https://media.test/' });
    expect(url).toBe('https://media.test/s/x.jpg');
  });
});

describe('deleteImage', () => {
  it('removes a stored object', async () => {
    const key = `${SITE}/2025/01/01/deadbeef-x.jpg`;
    await env.PHOTOS.put(key, new Uint8Array([1, 2, 3]));
    await deleteImage(env.PHOTOS, key);
    expect(await env.PHOTOS.get(key)).toBeNull();
  });

  it('is a silent no-op for a missing key', async () => {
    await expect(deleteImage(env.PHOTOS, 'does/not/exist.jpg')).resolves.toBeUndefined();
  });
});

describe('readImageDimensions', () => {
  it('reads a hand-rolled JPEG header (640x480)', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,              // SOI
      0xff, 0xc0,              // SOF0
      0x00, 0x11,              // segment length
      0x08,                    // precision
      0x01, 0xe0,              // height = 480
      0x02, 0x80,              // width  = 640
      0x03,                    // components
      // remainder doesn't matter for the probe
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(readImageDimensions(bytes)).toEqual({ width: 640, height: 480 });
  });

  it('reads a hand-rolled PNG header (1024x768)', () => {
    const bytes = new Uint8Array(24);
    // signature
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // IHDR length (13) + 'IHDR' -- the probe doesn't actually check these,
    // but populate them for shape correctness.
    bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    // width 1024 (0x00000400), height 768 (0x00000300), big-endian
    bytes.set([0x00, 0x00, 0x04, 0x00], 16);
    bytes.set([0x00, 0x00, 0x03, 0x00], 20);
    expect(readImageDimensions(bytes)).toEqual({ width: 1024, height: 768 });
  });

  it('reads a hand-rolled WebP (VP8 variant, 320x240)', () => {
    const bytes = new Uint8Array(30);
    // 'RIFF' + dummy size + 'WEBP' + 'VP8 '
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x00, 0x00, 0x00, 0x00], 4);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x20], 12);
    // chunk size + frame tag padding (positions 16..25), ignored
    // width=320 LE at 26, height=240 LE at 28
    bytes[26] = 0x40; bytes[27] = 0x01; // 320
    bytes[28] = 0xf0; bytes[29] = 0x00; // 240
    expect(readImageDimensions(bytes)).toEqual({ width: 320, height: 240 });
  });

  it('reads a hand-rolled GIF header (200x100)', () => {
    const bytes = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // 'GIF89a'
      0xc8, 0x00,                          // width 200 LE
      0x64, 0x00,                          // height 100 LE
    ]);
    expect(readImageDimensions(bytes)).toEqual({ width: 200, height: 100 });
  });

  it('throws on garbage input', () => {
    expect(() => readImageDimensions(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toThrow();
  });
});
