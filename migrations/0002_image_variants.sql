-- Image responsive variants.
--
-- The application now stores multiple-sized JPEGs (400w/800w/1200w/...)
-- alongside the original under keys like `<base>.400w.jpg`. The list of
-- which widths exist for a given image is recorded here so PostCard can
-- emit a valid srcset without 404-ing on non-existent variants.
--
-- Empty array = legacy image with no variants generated; renderers fall
-- back to the original src in that case.

ALTER TABLE images
  ADD COLUMN IF NOT EXISTS variant_widths INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[];
