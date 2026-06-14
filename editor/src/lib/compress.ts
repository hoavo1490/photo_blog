// Client-side image compression. Runs in the browser before /api/upload.
// Default: max 1600px on the long edge, JPEG quality 0.85, EXIF stripped.
//
// The `createImageBitmap(file, { imageOrientation: 'from-image' })` call
// honors EXIF orientation so iPhone photos shot in portrait don't end up
// sideways after canvas re-encoding.

export interface CompressOptions {
  /** Max length of the longer edge, in pixels. Default 1600. */
  maxEdge?: number;
  /** Encoder quality, 0-1. Default 0.85. */
  quality?: number;
  /** Output mime. Default image/jpeg. WebP is smaller but iOS share-sheets may not. */
  mimeType?: 'image/jpeg' | 'image/webp';
}

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressedImage> {
  const { maxEdge = 1600, quality = 0.85, mimeType = 'image/jpeg' } = opts;

  // Decode with EXIF-respecting orientation. Supported in Safari 14+, Chrome 81+.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    throw new Error(`Could not decode image (format may not be supported): ${(err as Error).message}`);
  }

  const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), mimeType, quality),
  );
  if (!blob) throw new Error('Canvas re-encoding failed');

  return {
    blob,
    width: w,
    height: h,
    originalSize: file.size,
    compressedSize: blob.size,
  };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.split(',')[1] ?? '');
    };
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function filenameFromOriginal(originalName: string, blob: Blob): string {
  const base = originalName
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const safe = base || `image-${Date.now()}`;
  return `${safe}.${ext}`;
}
