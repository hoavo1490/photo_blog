#!/usr/bin/env node
// Migrate data from Neon (Postgres) to Cloudflare D1.
//
// Usage:
//   DATABASE_URL=<neon-pooler-url> node scripts/neon-to-d1.mjs
//
// The script dumps every table from Neon, writes INSERT statements to a
// temp SQL file, then applies it with `wrangler d1 execute --file`.
//
// Tables migrated (FK-safe order):
//   users, sites, site_members, site_domain_history,
//   images, posts, tags, post_tags, albums, album_images, pages
//
// Sessions are skipped by default (users re-login after migration).
// Pass --include-sessions to copy them.

import { neon } from '@neondatabase/serverless';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB_NAME = 'photoblog';
const includeSessions = process.argv.includes('--include-sessions');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('Set DATABASE_URL to your Neon pooler URL'); process.exit(1); }

const sql = neon(dbUrl);

function escape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `'${v.toISOString().replace(/'/g, "''")}'`;
  if (Array.isArray(v)) return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function runFile(statements) {
  if (statements.length === 0) return;
  const tmp = join(tmpdir(), `d1-migrate-${Date.now()}.sql`);
  writeFileSync(tmp, statements.join('\n'), 'utf8');
  try {
    execSync(
      `./node_modules/.bin/wrangler d1 execute ${DB_NAME} --remote --file=${tmp}`,
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
  } finally {
    unlinkSync(tmp);
  }
}

async function migrateTable(table, orderBy, rowToSql) {
  const rows = await sql.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  if (rows.length === 0) { console.log(`  ${table}: 0 rows`); return; }
  runFile(rows.map(rowToSql));
  console.log(`  ${table}: ${rows.length} rows`);
}

console.log('Migrating Neon → D1…\n');

await migrateTable('users', 'created_at', (r) =>
  `INSERT OR IGNORE INTO users (id,github_id,github_login,email,created_at) VALUES (${escape(r.id)},${escape(Number(r.github_id))},${escape(r.github_login)},${escape(r.email)},${escape(r.created_at)});`);

await migrateTable('sites', 'created_at', (r) =>
  `INSERT OR IGNORE INTO sites (id,slug,name,custom_domain,created_at) VALUES (${escape(r.id)},${escape(r.slug)},${escape(r.name)},${escape(r.custom_domain)},${escape(r.created_at)});`);

await migrateTable('site_members', 'added_at', (r) =>
  `INSERT OR IGNORE INTO site_members (site_id,user_id,role,added_at) VALUES (${escape(r.site_id)},${escape(r.user_id)},${escape(r.role)},${escape(r.added_at)});`);

await migrateTable('site_domain_history', 'changed_at', (r) =>
  `INSERT OR IGNORE INTO site_domain_history (id,site_id,old_domain,changed_at) VALUES (${escape(r.id)},${escape(r.site_id)},${escape(r.old_domain)},${escape(r.changed_at)});`);

await migrateTable('images', 'uploaded_at', (r) =>
  `INSERT OR IGNORE INTO images (id,site_id,r2_key,original_name,size_bytes,width,height,uploaded_by,uploaded_at,variant_widths,has_avif) VALUES (${escape(r.id)},${escape(r.site_id)},${escape(r.r2_key)},${escape(r.original_name)},${escape(r.size_bytes)},${escape(r.width)},${escape(r.height)},${escape(r.uploaded_by)},${escape(r.uploaded_at)},${escape(r.variant_widths ?? [])},${escape(r.has_avif ? 1 : 0)});`);

await migrateTable('posts', 'created_at', (r) =>
  `INSERT OR IGNORE INTO posts (id,site_id,slug,title,body,cover_image_id,description,status,published_at,created_at,updated_at) VALUES (${escape(r.id)},${escape(r.site_id)},${escape(r.slug)},${escape(r.title)},${escape(r.body)},${escape(r.cover_image_id)},${escape(r.description)},${escape(r.status)},${escape(r.published_at)},${escape(r.created_at)},${escape(r.updated_at)});`);

await migrateTable('tags', 'id', (r) =>
  `INSERT OR IGNORE INTO tags (id,site_id,slug,name) VALUES (${escape(r.id)},${escape(r.site_id)},${escape(r.slug)},${escape(r.name)});`);

await migrateTable('post_tags', 'post_id', (r) =>
  `INSERT OR IGNORE INTO post_tags (post_id,tag_id) VALUES (${escape(r.post_id)},${escape(r.tag_id)});`);

await migrateTable('albums', 'created_at', (r) =>
  `INSERT OR IGNORE INTO albums (id,site_id,title,slug,description,cover_image_id,published,created_at,updated_at) VALUES (${escape(r.id)},${escape(r.site_id)},${escape(r.title)},${escape(r.slug)},${escape(r.description)},${escape(r.cover_image_id)},${escape(r.published ? 1 : 0)},${escape(r.created_at)},${escape(r.updated_at)});`);

await migrateTable('album_images', 'created_at', (r) =>
  `INSERT OR IGNORE INTO album_images (id,album_id,image_id,sort_order,caption,created_at) VALUES (${escape(r.id)},${escape(r.album_id)},${escape(r.image_id)},${escape(r.sort_order)},${escape(r.caption)},${escape(r.created_at)});`);

await migrateTable('pages', 'id', (r) =>
  `INSERT OR IGNORE INTO pages (id,site_id,slug,body,updated_at) VALUES (${escape(r.id)},${escape(r.site_id)},${escape(r.slug)},${escape(r.body)},${escape(r.updated_at)});`);

if (includeSessions) {
  await migrateTable('sessions', 'created_at', (r) =>
    `INSERT OR IGNORE INTO sessions (id,user_id,created_at,last_used_at,expires_at,revoked_at,user_agent) VALUES (${escape(r.id)},${escape(r.user_id)},${escape(r.created_at)},${escape(r.last_used_at)},${escape(r.expires_at)},${escape(r.revoked_at)},${escape(r.user_agent)});`);
} else {
  console.log('  sessions: skipped (users will re-login)');
}

console.log('\n✅ Migration complete.');
