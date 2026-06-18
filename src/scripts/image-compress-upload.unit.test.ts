import { describe, it, expect, vi } from 'vitest';
import type { XhrFactory } from './image-compress-upload';
import {
  VARIANT_TARGETS,
  selectWidths,
  buildUploadForm,
  uploadWithProgress,
} from './image-compress-upload';

// ── Optimization 1: trimmed variant targets ───────────────────────────────────

describe('VARIANT_TARGETS', () => {
  it('is [400, 800, 1600]', () => {
    expect(VARIANT_TARGETS).toEqual([400, 800, 1600]);
  });
});

describe('selectWidths', () => {
  it('returns all targets when bitmap is wide enough', () => {
    expect(selectWidths(2000, [400, 800, 1600])).toEqual([400, 800, 1600]);
  });

  it('filters targets larger than bitmap width', () => {
    expect(selectWidths(900, [400, 800, 1600])).toEqual([400, 800]);
  });

  it('includes targets equal to bitmap width', () => {
    expect(selectWidths(800, [400, 800, 1600])).toEqual([400, 800]);
  });

  it('falls back to bitmap width when all targets are larger', () => {
    expect(selectWidths(300, [400, 800, 1600])).toEqual([300]);
  });
});

// ── Optimization 3: WebP-only upload (no JPEG variants) ──────────────────────

describe('buildUploadForm', () => {
  it('includes siteId, width, height', () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    const fd = buildUploadForm('site-1', 'photo', { width: 1600, height: 900 }, [
      { blob, width: 1600 },
    ]);
    expect(fd.get('siteId')).toBe('site-1');
    expect(fd.get('width')).toBe('1600');
    expect(fd.get('height')).toBe('900');
  });

  it('appends WebP variant entries as file_<W>_webp', () => {
    const b400 = new Blob(['a'], { type: 'image/webp' });
    const b800 = new Blob(['b'], { type: 'image/webp' });
    const fd = buildUploadForm('site-1', 'photo', { width: 800, height: 600 }, [
      { blob: b400, width: 400 },
      { blob: b800, width: 800 },
    ]);
    // FormData wraps Blobs with filename as File; check size to confirm correct blob
    expect((fd.get('file_400_webp') as File).size).toBe(b400.size);
    expect((fd.get('file_800_webp') as File).size).toBe(b800.size);
  });

  it('does NOT include JPEG file_ entries', () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    const fd = buildUploadForm('site-1', 'photo', { width: 800, height: 600 }, [
      { blob, width: 800 },
    ]);
    // No file_<W> key (JPEG), only file_<W>_webp
    expect(fd.get('file_800')).toBeNull();
  });

  it('names the file with stem and width', () => {
    const blob = new Blob(['x'], { type: 'image/webp' });
    const fd = buildUploadForm('site-1', 'my-photo', { width: 800, height: 600 }, [
      { blob, width: 800 },
    ]);
    const entry = fd.get('file_800_webp') as File;
    expect(entry.name).toBe('my-photo.800w.webp');
  });
});

// ── Optimization 4: XHR progress upload ──────────────────────────────────────

describe('uploadWithProgress', () => {
  it('resolves with parsed JSON on status 200', async () => {
    const xhrMock = makeFakeXhr({ status: 200, responseText: '{"id":"abc","url":"/img/abc.webp"}' });
    const fd = new FormData();
    const result = await uploadWithProgress(fd, '/admin/api/upload', () => {}, xhrMock.factory);
    expect(result).toEqual({ id: 'abc', url: '/img/abc.webp' });
  });

  it('resolves null on non-200 status', async () => {
    const xhrMock = makeFakeXhr({ status: 500, responseText: 'error' });
    const fd = new FormData();
    const result = await uploadWithProgress(fd, '/admin/api/upload', () => {}, xhrMock.factory);
    expect(result).toBeNull();
  });

  it('calls onProgress with percentage computed from loaded/total', async () => {
    const xhrMock = makeFakeXhr({ status: 200, responseText: '{"id":"x","url":"/y"}' });
    const progress: number[] = [];
    const fd = new FormData();
    const uploadPromise = uploadWithProgress(fd, '/admin/api/upload', (pct) => progress.push(pct), xhrMock.factory);
    // Fire progress before the upload resolves
    xhrMock.fireProgress(500, 1000);
    await uploadPromise;
    expect(progress).toContain(50);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeFakeXhr(opts: { status: number; responseText: string }) {
  let uploadProgressHandler: ((e: { loaded: number; total: number }) => void) | null = null;
  let loadHandler: (() => void) | null = null;

  const instance = {
    open: vi.fn(),
    send: vi.fn().mockImplementation(() => {
      Promise.resolve().then(() => loadHandler?.());
    }),
    status: opts.status,
    responseText: opts.responseText,
    upload: {
      set onprogress(fn: ((e: { loaded: number; total: number }) => void) | null) {
        uploadProgressHandler = fn;
      },
    },
    set onload(fn: () => void) { loadHandler = fn; },
    set onerror(_fn: () => void) {},
  };

  const factory: XhrFactory = () => instance as ReturnType<XhrFactory>;

  return {
    factory,
    fireProgress: (loaded: number, total: number) => {
      uploadProgressHandler?.({ loaded, total });
    },
  };
}
