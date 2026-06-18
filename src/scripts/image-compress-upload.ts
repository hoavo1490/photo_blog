// Extracted image compression + upload logic, shared by PostForm, PageForm, AlbumForm.
// Pure helper functions are dependency-injected for testability (no Canvas/XHR globals needed in tests).

export const VARIANT_TARGETS = [400, 800, 1600];

/** Returns which variant widths to encode given a source bitmap width. */
export function selectWidths(bitmapWidth: number, targets: number[]): number[] {
  const widths = targets.filter((w) => w <= bitmapWidth);
  return widths.length > 0 ? widths : [bitmapWidth];
}

export interface VariantResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Encode a single variant of `bitmap` at `targetWidth` using Canvas.
 * Returns null if the canvas produces no blob.
 */
export async function resizeVariant(
  bitmap: ImageBitmap,
  targetWidth: number,
  type: string,
  quality = 0.85,
): Promise<VariantResult | null> {
  const ratio = Math.min(1, targetWidth / bitmap.width);
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  return blob ? { blob, width: w, height: h } : null;
}

/**
 * Build the multipart FormData for the upload endpoint.
 * Uploads WebP variants only (no JPEG variants — server already handles JPEG fallback key).
 */
export function buildUploadForm(
  siteId: string,
  stem: string,
  primary: { width: number; height: number },
  webps: Array<{ blob: Blob; width: number }>,
): FormData {
  const fd = new FormData();
  fd.append('siteId', siteId);
  fd.append('width', String(primary.width));
  fd.append('height', String(primary.height));
  for (const v of webps) {
    fd.append(`file_${v.width}_webp`, v.blob, `${stem}.${v.width}w.webp`);
  }
  return fd;
}

export interface XhrLike {
  open(method: string, url: string): void;
  send(body: FormData): void;
  status: number;
  responseText: string;
  upload: { onprogress: ((e: { loaded: number; total: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export type XhrFactory = () => XhrLike;

/**
 * Upload FormData via XHR so we can report progress.
 * `xhrFactory` is injectable for tests; defaults to creating a real `XMLHttpRequest`.
 */
export function uploadWithProgress(
  fd: FormData,
  url: string,
  onProgress: (pct: number) => void,
  xhrFactory: XhrFactory = () => new XMLHttpRequest() as unknown as XhrLike,
): Promise<{ id: string; url: string; editorUrl?: string } | null> {
  return new Promise((resolve) => {
    const xhr = xhrFactory();
    xhr.upload.onprogress = (e) => {
      if (e.total > 0) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        resolve(null);
      }
    };
    xhr.onerror = () => resolve(null);
    xhr.open('POST', url);
    xhr.send(fd);
  });
}

/**
 * Full compress-and-upload pipeline for a single File.
 * Calls `onPreview` immediately with a blob: URL for instant preview (opt 2).
 * Returns the server response (id + url) after upload completes.
 */
export async function compressAndUpload(
  file: File,
  siteId: string,
  onPreview: (blobUrl: string) => void,
  onProgress: (pct: number) => void,
  opts: {
    variantTargets?: number[];
    xhrFactory?: XhrFactory;
  } = {},
): Promise<{ id: string; url: string; editorUrl?: string } | null> {
  const targets = opts.variantTargets ?? VARIANT_TARGETS;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const widths = selectWidths(bitmap.width, targets);

  const webpResults = await Promise.all(widths.map((w) => resizeVariant(bitmap, w, 'image/webp', 0.80)));
  const webps = webpResults.filter((r): r is VariantResult => r !== null);
  if (webps.length === 0) return null;

  webps.sort((a, b) => b.width - a.width);
  const primary = webps[0];

  // Optimization 2: instant blob preview before network round-trip
  const previewUrl = URL.createObjectURL(primary.blob);
  onPreview(previewUrl);

  const stem = file.name.replace(/\.[^.]+$/, '');
  const fd = buildUploadForm(siteId, stem, primary, webps);

  return uploadWithProgress(fd, '/admin/api/upload', onProgress, opts.xhrFactory);
}
