-- Topics: per-site primary category for a post. Unlike tags (many-to-many),
-- a post belongs to at most one topic. Slug is lowercased for collision-safe
-- matching; name preserves display casing.
CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  UNIQUE (site_id, slug)
);

ALTER TABLE posts
  ADD COLUMN topic_id uuid REFERENCES topics(id) ON DELETE SET NULL;

CREATE INDEX posts_topic ON posts (topic_id) WHERE topic_id IS NOT NULL;
