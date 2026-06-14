-- riovv-app: initial schema
-- Multi-tenant blog platform. Tenant = site. Defense in depth via RLS
-- (enabled in 0002 once we exercise scoped queries) plus app-layer
-- scopedQuery helper.

-- Updated-at trigger function (used by posts).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Users: stable identity is github_id (numeric, immutable).
-- github_login is denormalized; refreshed on each login.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id bigint UNIQUE NOT NULL,
  github_login text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_github_login_lower ON users (LOWER(github_login));


-- Sites: one row per published blog. slug is for admin subdomain;
-- custom_domain is the primary public host (riovv.com).
CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  custom_domain text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- Membership: site -> user N-to-many with role. Collaborators-ready
-- from day one (avoids painful migration when first co-author shows up).
CREATE TABLE site_members (
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, user_id)
);
CREATE INDEX site_members_user ON site_members (user_id);


-- Historic custom domains. After a rename we serve 301 redirects from
-- the old domain for SEO continuity (handled in middleware).
CREATE TABLE site_domain_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  old_domain text NOT NULL UNIQUE,
  changed_at timestamptz NOT NULL DEFAULT now()
);


-- Images: R2 object references with intrinsic dimensions so PhotoSwipe
-- can place the lightbox without re-fetching. uploaded_by may be null
-- after a member is removed (SET NULL on delete).
CREATE TABLE images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  r2_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  size_bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX images_site_uploaded ON images (site_id, uploaded_at DESC);


-- Posts. Body stores markdown with image-token references like
-- ![alt](image:<uuid>); a remark plugin resolves to public URLs at render.
-- status enum + (site_id, published_at DESC) partial index matches the
-- homepage query exactly.
CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  cover_image_id uuid REFERENCES images(id) ON DELETE SET NULL,
  description text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'scheduled')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);
CREATE INDEX posts_site_pubdate
  ON posts (site_id, published_at DESC)
  WHERE status = 'published';

CREATE TRIGGER posts_set_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Tags: per-site namespace. slug is lowercased for collision-safe matching;
-- name preserves display casing.
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  UNIQUE (site_id, slug)
);

CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX post_tags_tag ON post_tags (tag_id, post_id);


-- Sessions: server-side, revocable. Cookie holds session id; lookup hits
-- this table (cached briefly via caches.default to keep request latency low).
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text
);
CREATE INDEX sessions_user_active
  ON sessions (user_id)
  WHERE revoked_at IS NULL;
