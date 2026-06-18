-- D1 (SQLite) schema — all migrations combined.
-- Converted from Postgres: uuid→TEXT, timestamptz→TEXT, boolean→INTEGER(0/1),
-- INTEGER[]→TEXT(JSON), gen_random_uuid()→SQLite v4-UUID expression.
--
-- UUID expression generates a v4-like UUID from randomblob().
-- strftime('%Y-%m-%dT%H:%M:%fZ','now') produces ISO 8601 UTC timestamps.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id           TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  github_id    INTEGER UNIQUE NOT NULL,
  github_login TEXT NOT NULL,
  email        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS users_github_login_lower ON users (lower(github_login));


CREATE TABLE IF NOT EXISTS sites (
  id            TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  custom_domain TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


CREATE TABLE IF NOT EXISTS site_members (
  site_id  TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('owner','editor')),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (site_id, user_id)
);
CREATE INDEX IF NOT EXISTS site_members_user ON site_members (user_id);


CREATE TABLE IF NOT EXISTS site_domain_history (
  id         TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  old_domain TEXT NOT NULL UNIQUE,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


CREATE TABLE IF NOT EXISTS images (
  id             TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  site_id        TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  r2_key         TEXT NOT NULL UNIQUE,
  original_name  TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  uploaded_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  variant_widths TEXT NOT NULL DEFAULT '[]',
  has_avif       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS images_site_uploaded ON images (site_id, uploaded_at DESC);


CREATE TABLE IF NOT EXISTS posts (
  id             TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  site_id        TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  cover_image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled')),
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, slug)
);
CREATE INDEX IF NOT EXISTS posts_site_pubdate ON posts (site_id, published_at DESC) WHERE status = 'published';

-- WHEN guard prevents infinite recursion: trigger only fires when app
-- didn't explicitly set updated_at in the UPDATE statement.
CREATE TRIGGER IF NOT EXISTS posts_set_updated_at
  AFTER UPDATE ON posts
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE posts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
  END;


CREATE TABLE IF NOT EXISTS tags (
  id      TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug    TEXT NOT NULL,
  name    TEXT NOT NULL,
  UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS post_tags_tag ON post_tags (tag_id, post_id);


CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_active ON sessions (user_id) WHERE revoked_at IS NULL;


CREATE TABLE IF NOT EXISTS albums (
  id             TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  site_id        TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL,
  description    TEXT,
  cover_image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
  published      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, slug)
);
CREATE INDEX IF NOT EXISTS albums_site_created ON albums (site_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS albums_set_updated_at
  AFTER UPDATE ON albums
  FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE albums SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
  END;


CREATE TABLE IF NOT EXISTS album_images (
  id         TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  image_id   TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (album_id, image_id)
);
CREATE INDEX IF NOT EXISTS album_images_album ON album_images (album_id, sort_order);


CREATE TABLE IF NOT EXISTS pages (
  id         TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (site_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_pages_site_slug ON pages (site_id, slug);
