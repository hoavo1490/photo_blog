#!/usr/bin/env node
// One-shot importer: takes the .md posts + .jpg images Rio wrote with the
// old GitHub-as-database editor and lands them in the new Neon + R2
// architecture. Idempotent on the image side via content-hash R2 keys;
// posts use ON CONFLICT (site_id, slug) DO NOTHING.
//
// Usage:
//   DATABASE_URL=... \
//   RIO_SITE_ID=<uuid> RIO_USER_ID=<uuid> \
//   SOURCE_DIR=/tmp/rio-content R2_BUCKET=riovv-media \
//   node scripts/import-rio-content.mjs
//
// Assumes:
//   - migrations applied + seed-rio.mjs already run
//   - wrangler authenticated (uses `wrangler r2 object put --remote`)

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import matter from 'gray-matter';

const REQUIRED = ['DATABASE_URL', 'RIO_SITE_ID', 'RIO_USER_ID', 'SOURCE_DIR', 'R2_BUCKET'];
for (const k of REQUIRED) {
  if (!process.env[k]) { console.error(`missing env: ${k}`); process.exit(1); }
}
const {
  DATABASE_URL, RIO_SITE_ID, RIO_USER_ID, SOURCE_DIR, R2_BUCKET,
} = process.env;

const sql = neon(DATABASE_URL);

// ─── JPEG-only dimension probe (the imports are all .jpg) ──────────────────
function readJpegDims(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('bad marker');
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + segLen;
  }
  throw new Error('SOF not found');
}

// ─── R2 upload via wrangler CLI ────────────────────────────────────────────
function r2Put(key, filePath, contentType) {
  const r = spawnSync('pnpm', [
    'exec', 'wrangler', 'r2', 'object', 'put',
    `${R2_BUCKET}/${key}`,
    `--file=${filePath}`,
    `--content-type=${contentType}`,
    '--remote',
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`wrangler r2 put failed for ${key}`);
}

// ─── Step 1: upload all images, capture filename -> image_uuid mapping ─────
const mediaDir = join(SOURCE_DIR, 'media');
const imageFiles = readdirSync(mediaDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));

const filenameToImageId = new Map();   // 1000045078-f08ko.jpg -> uuid
const filenameToCoverUrl = new Map();  // original /media/.../foo.jpg path -> uuid

for (const f of imageFiles) {
  const filePath = join(mediaDir, f);
  const bytes = readFileSync(filePath);
  const { width, height } = readJpegDims(new Uint8Array(bytes));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  // Match the new system's keyFor() convention: <siteId>/YYYY/MM/DD/<hash>-<name>
  const key = `${RIO_SITE_ID}/2026/06/14/${hash}-${f}`;

  console.log(`upload  ${f}  -> ${key}  (${width}x${height})`);
  r2Put(key, filePath, 'image/jpeg');

  const [row] = await sql.query(
    `INSERT INTO images (site_id, r2_key, original_name, size_bytes, width, height, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (r2_key) DO UPDATE SET original_name = EXCLUDED.original_name
     RETURNING id`,
    [RIO_SITE_ID, key, f, bytes.length, width, height, RIO_USER_ID],
  );
  filenameToImageId.set(f, row.id);
  filenameToCoverUrl.set(`/media/files/2026/06/14/${f}`, row.id);
}

console.log(`\n${filenameToImageId.size} images imported.\n`);

// ─── Step 2: import posts ──────────────────────────────────────────────────
const postsDir = join(SOURCE_DIR, 'posts');
const postFiles = readdirSync(postsDir).filter((f) => f.endsWith('.md'));

for (const f of postFiles) {
  const raw = readFileSync(join(postsDir, f), 'utf8');
  const { data, content } = matter(raw);

  // Rewrite body image URLs to image:<uuid> tokens
  let body = content;
  for (const [oldUrl, imageId] of filenameToCoverUrl) {
    body = body.replaceAll(oldUrl, `image:${imageId}`);
  }

  // Slug from filename (strip date prefix + .md)
  const slug = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const title = String(data.title || slug);
  const publishedAt = data.date ? new Date(`${data.date}T12:00:00Z`).toISOString() : new Date().toISOString();

  // Cover: convert frontmatter `cover: /media/.../foo.jpg` -> image uuid
  let coverImageId = null;
  if (data.cover) {
    coverImageId = filenameToCoverUrl.get(String(data.cover)) ?? null;
  }
  // Or: first body image becomes implicit cover when no explicit one set
  if (!coverImageId) {
    const m = body.match(/!\[[^\]]*\]\(image:([0-9a-f-]{36})\)/);
    if (m) coverImageId = m[1];
  }

  const [post] = await sql.query(
    `INSERT INTO posts (site_id, slug, title, body, cover_image_id, status, published_at)
     VALUES ($1, $2, $3, $4, $5, 'published', $6)
     ON CONFLICT (site_id, slug) DO UPDATE
       SET title = EXCLUDED.title,
           body = EXCLUDED.body,
           cover_image_id = EXCLUDED.cover_image_id,
           status = EXCLUDED.status,
           published_at = EXCLUDED.published_at
     RETURNING id`,
    [RIO_SITE_ID, slug, title, body, coverImageId, publishedAt],
  );

  // Tags: strip leading # if present, lowercase-slug, upsert into tags + post_tags
  const tagNames = Array.isArray(data.tags) ? data.tags : [];
  await sql.query(`DELETE FROM post_tags WHERE post_id = $1`, [post.id]);
  for (const rawTag of tagNames) {
    const cleanName = String(rawTag).replace(/^#/, '').trim();
    if (!cleanName) continue;
    const tagSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!tagSlug) continue;
    const [tag] = await sql.query(
      `INSERT INTO tags (site_id, slug, name) VALUES ($1, $2, $3)
       ON CONFLICT (site_id, slug) DO UPDATE SET name = tags.name
       RETURNING id`,
      [RIO_SITE_ID, tagSlug, cleanName],
    );
    await sql.query(
      `INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [post.id, tag.id],
    );
  }

  console.log(`post    ${slug}  -> ${post.id}  (cover=${coverImageId ?? 'none'}, tags=${tagNames.length})`);
}

console.log(`\nimport complete.`);
