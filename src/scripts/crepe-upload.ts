// Adapter between our two-shape upload pipeline and Crepe's one-shape
// onUpload callback.
//
// Our compress+upload returns { id, url } -- we need both: the URL for
// the editor to render the image inline, and the id to register in the
// imageMap so save-time collapse turns the URL back into a token.
// Crepe's onUpload expects (file) => Promise<string> -- just the URL.
// This factory bridges the two and side-effects the registration via
// the onUploaded callback.

export interface UploadResult {
  id: string;
  url: string;
}

export function createCrepeUploadHandler(
  upload: (file: File) => Promise<UploadResult | null>,
  onUploaded?: (entry: UploadResult) => void,
): (file: File) => Promise<string> {
  return async (file: File) => {
    const r = await upload(file);
    if (!r) throw new Error(`upload failed for ${file.name || 'image'}`);
    onUploaded?.(r);
    return r.url;
  };
}
