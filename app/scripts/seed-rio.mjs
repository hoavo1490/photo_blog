#!/usr/bin/env node
// One-shot seed: create Rio's user + site + ownership membership.
// Idempotent (uses ON CONFLICT). Usage:
//   DATABASE_URL=postgres://... node scripts/seed-rio.mjs
//
// Env overrides:
//   RIO_GITHUB_ID         (default: prompts for it)
//   RIO_GITHUB_LOGIN      (default: hoavo1490)
//   SITE_CUSTOM_DOMAIN    (default: riovv.com)
//   SITE_SLUG             (default: rio)
//   SITE_NAME             (default: riovv)

import { spawnSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const githubId = process.env.RIO_GITHUB_ID;
if (!githubId) {
  console.error('RIO_GITHUB_ID not set. Get it from https://api.github.com/users/<your-login>');
  process.exit(1);
}

const githubLogin = process.env.RIO_GITHUB_LOGIN ?? 'hoavo1490';
const customDomain = process.env.SITE_CUSTOM_DOMAIN ?? 'riovv.com';
const siteSlug = process.env.SITE_SLUG ?? 'rio';
const siteName = process.env.SITE_NAME ?? 'riovv';

const sql = `
WITH u AS (
  INSERT INTO users (github_id, github_login)
  VALUES (${githubId}, '${githubLogin}')
  ON CONFLICT (github_id) DO UPDATE SET github_login = EXCLUDED.github_login
  RETURNING id
), s AS (
  INSERT INTO sites (slug, name, custom_domain)
  VALUES ('${siteSlug}', '${siteName}', '${customDomain}')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, custom_domain = EXCLUDED.custom_domain
  RETURNING id
)
INSERT INTO site_members (site_id, user_id, role)
SELECT s.id, u.id, 'owner' FROM s, u
ON CONFLICT (site_id, user_id) DO NOTHING;

SELECT u.id AS user_id, s.id AS site_id, s.slug, s.custom_domain
FROM users u, sites s WHERE u.github_id = ${githubId} AND s.slug = '${siteSlug}';
`;

const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1'], {
  input: sql,
  stdio: ['pipe', 'inherit', 'inherit'],
});
process.exit(r.status ?? 0);
