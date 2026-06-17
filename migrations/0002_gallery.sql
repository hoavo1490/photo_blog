-- riovv-app: gallery/albums feature
-- albums: curated photo albums for the public gallery page.
-- album_images: ordered junction between albums and the existing images table.

CREATE TABLE albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL,
  description text,
  cover_image_id uuid REFERENCES images(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);

CREATE INDEX albums_site_created ON albums (site_id, created_at DESC);

CREATE TABLE album_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (album_id, image_id)
);

CREATE INDEX album_images_album ON album_images (album_id, sort_order);

CREATE TRIGGER albums_updated_at
  BEFORE UPDATE ON albums
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
