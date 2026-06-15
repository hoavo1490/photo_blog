-- Editable single-row-per-slug pages (about, contact, legal, etc).
-- Distinct from `posts` because pages have no date / tags / cover and
-- live at fixed URLs. The (site_id, slug) pair is unique so each tenant
-- owns one row per slug; the editor upserts on save.
CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);
CREATE INDEX idx_pages_site_slug ON pages (site_id, slug);
