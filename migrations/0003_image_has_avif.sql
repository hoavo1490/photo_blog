-- Track whether AVIF variants exist alongside JPEG/WebP for each
-- image. New uploads don't generate AVIF (no client-side WASM
-- encoder); the backfill script populates it for images encoded
-- locally via avifenc. Renderers only emit a `<source type="image/avif">`
-- when this is true, so we never 404 on a missing variant.

ALTER TABLE images
  ADD COLUMN IF NOT EXISTS has_avif BOOLEAN NOT NULL DEFAULT false;
