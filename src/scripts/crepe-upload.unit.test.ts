import { describe, it, expect, vi } from 'vitest';
import { createCrepeUploadHandler } from './crepe-upload';

const FILE = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', { type: 'image/jpeg' });

describe('createCrepeUploadHandler', () => {
  it('calls upload(file) and returns the resulting URL', async () => {
    const upload = vi.fn(async () => ({ id: 'u1', url: '/img/a.jpg' }));
    const handler = createCrepeUploadHandler(upload);
    const url = await handler(FILE);
    expect(upload).toHaveBeenCalledExactlyOnceWith(FILE);
    expect(url).toBe('/img/a.jpg');
  });

  it('side-effects onUploaded with the full {id, url} entry', async () => {
    const upload = vi.fn(async () => ({ id: 'u1', url: '/img/a.jpg' }));
    const onUploaded = vi.fn();
    const handler = createCrepeUploadHandler(upload, onUploaded);
    await handler(FILE);
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith({ id: 'u1', url: '/img/a.jpg' });
  });

  it('throws (so Crepe shows its error state) when upload returns null', async () => {
    const upload = vi.fn(async () => null);
    const handler = createCrepeUploadHandler(upload);
    await expect(handler(FILE)).rejects.toThrow(/upload failed/i);
  });

  it('propagates underlying upload rejections', async () => {
    const upload = vi.fn(async () => { throw new Error('network down'); });
    const handler = createCrepeUploadHandler(upload);
    await expect(handler(FILE)).rejects.toThrow('network down');
  });

  it('does NOT call onUploaded when upload fails', async () => {
    const upload = vi.fn(async () => null);
    const onUploaded = vi.fn();
    const handler = createCrepeUploadHandler(upload, onUploaded);
    await expect(handler(FILE)).rejects.toThrow();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('works without an onUploaded callback (it is optional)', async () => {
    const upload = vi.fn(async () => ({ id: 'u1', url: '/img/a.jpg' }));
    const handler = createCrepeUploadHandler(upload);
    await expect(handler(FILE)).resolves.toBe('/img/a.jpg');
  });
});
