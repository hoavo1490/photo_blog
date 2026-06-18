import type { SqlDriver } from './driver';

// Every public function takes `siteId` and includes it in WHERE / SET
// scoping for application-layer tenant isolation.
//
// `delAlbum` is named with a suffix because `delete` is reserved.

export interface Album {
  id: string;
  siteId: string;
  title: string;
  slug: string;
  description: string | null;
  coverImageId: string | null;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface AlbumRow {
  id: string;
  site_id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_id: string | null;
  published: boolean | number;
  created_at: string | Date;
  updated_at: string | Date;
}

function parseVariantWidths(raw: number[] | string | null | undefined): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(Number);
  try { return (JSON.parse(raw) as unknown[]).map(Number); } catch { return []; }
}

function fromRow(r: AlbumRow): Album {
  return {
    id: r.id,
    siteId: r.site_id,
    title: r.title,
    slug: r.slug,
    description: r.description,
    coverImageId: r.cover_image_id,
    published: Boolean(r.published),
    createdAt: new Date(r.created_at as string | Date),
    updatedAt: new Date(r.updated_at as string | Date),
  };
}

const SELECT = `
  id, site_id, title, slug, description, cover_image_id,
  published, created_at, updated_at
`;

export interface AlbumImageRow {
  imageId: string;
  r2Key: string;
  width: number;
  height: number;
  variantWidths: number[];
  caption: string | null;
  sortOrder: number;
}

export interface AlbumWithImages extends Album {
  images: AlbumImageRow[];
}

// ----- create ----- //

export interface CreateAlbumInput {
  siteId: string;
  title: string;
  slug: string;
  description?: string | null;
  coverImageId?: string | null;
}

export async function createAlbum(driver: SqlDriver, input: CreateAlbumInput): Promise<Album> {
  const rows = await driver.query<AlbumRow>(
    `INSERT INTO albums (site_id, title, slug, description, cover_image_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SELECT}`,
    [
      input.siteId,
      input.title,
      input.slug,
      input.description ?? null,
      input.coverImageId ?? null,
    ],
  );
  return fromRow(rows[0]);
}

// ----- find ----- //

export async function findAlbumById(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<Album | null> {
  const rows = await driver.query<AlbumRow>(
    `SELECT ${SELECT} FROM albums WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

interface AlbumWithImagesRow extends AlbumRow {
  image_id: string | null;
  sort_order: number | null;
  caption: string | null;
  r2_key: string | null;
  width: number | null;
  height: number | null;
  variant_widths: number[] | string | null;
}

export async function findAlbumBySlug(
  driver: SqlDriver,
  args: { siteId: string; slug: string },
): Promise<AlbumWithImages | null> {
  const rows = await driver.query<AlbumWithImagesRow>(
    `SELECT
       a.id, a.site_id, a.title, a.slug, a.description, a.cover_image_id,
       a.published, a.created_at, a.updated_at,
       ai.image_id, ai.sort_order, ai.caption,
       i.r2_key, i.width, i.height, i.variant_widths
     FROM albums a
     LEFT JOIN album_images ai ON ai.album_id = a.id
     LEFT JOIN images i ON i.id = ai.image_id
     WHERE a.site_id = $1 AND a.slug = $2 AND a.published = true
     ORDER BY ai.sort_order ASC, ai.created_at ASC`,
    [args.siteId, args.slug],
  );
  if (!rows[0]) return null;

  const album: AlbumWithImages = {
    ...fromRow(rows[0]),
    images: [],
  };

  for (const r of rows) {
    if (r.image_id != null) {
      album.images.push({
        imageId: r.image_id,
        r2Key: r.r2_key!,
        width: r.width!,
        height: r.height!,
        variantWidths: parseVariantWidths(r.variant_widths),
        caption: r.caption,
        sortOrder: r.sort_order!,
      });
    }
  }

  return album;
}

// ----- list ----- //

export async function listAlbumsWithImages(
  driver: SqlDriver,
  args: { siteId: string },
): Promise<AlbumWithImages[]> {
  const rows = await driver.query<AlbumWithImagesRow>(
    `SELECT
       a.id, a.site_id, a.title, a.slug, a.description, a.cover_image_id,
       a.published, a.created_at, a.updated_at,
       ai.image_id, ai.sort_order, ai.caption,
       i.r2_key, i.width, i.height, i.variant_widths
     FROM albums a
     LEFT JOIN album_images ai ON ai.album_id = a.id
     LEFT JOIN images i ON i.id = ai.image_id
     WHERE a.site_id = $1 AND a.published = true
     ORDER BY a.created_at DESC, ai.sort_order ASC, ai.created_at ASC`,
    [args.siteId],
  );

  const albumMap = new Map<string, AlbumWithImages>();
  for (const r of rows) {
    if (!albumMap.has(r.id)) albumMap.set(r.id, { ...fromRow(r), images: [] });
    if (r.image_id != null) {
      albumMap.get(r.id)!.images.push({
        imageId: r.image_id,
        r2Key: r.r2_key!,
        width: r.width!,
        height: r.height!,
        variantWidths: parseVariantWidths(r.variant_widths),
        caption: r.caption,
        sortOrder: r.sort_order!,
      });
    }
  }
  return [...albumMap.values()];
}

export async function listAlbums(
  driver: SqlDriver,
  args: { siteId: string },
): Promise<Album[]> {
  const rows = await driver.query<AlbumRow>(
    `SELECT ${SELECT}
     FROM albums
     WHERE site_id = $1 AND published = true
     ORDER BY created_at DESC`,
    [args.siteId],
  );
  return rows.map(fromRow);
}

export async function listAllAlbums(
  driver: SqlDriver,
  args: { siteId: string },
): Promise<Album[]> {
  const rows = await driver.query<AlbumRow>(
    `SELECT ${SELECT}
     FROM albums
     WHERE site_id = $1
     ORDER BY created_at DESC`,
    [args.siteId],
  );
  return rows.map(fromRow);
}

// ----- mutate ----- //

export interface UpdateAlbumInput {
  siteId: string;
  id: string;
  title?: string;
  slug?: string;
  description?: string | null;
  coverImageId?: string | null;
  published?: boolean;
}

export async function updateAlbum(
  driver: SqlDriver,
  args: UpdateAlbumInput,
): Promise<Album | null> {
  const sets: string[] = [];
  const params: unknown[] = [args.siteId, args.id];

  if (args.title !== undefined) {
    sets.push(`title = $${params.length + 1}`);
    params.push(args.title);
  }
  if (args.slug !== undefined) {
    sets.push(`slug = $${params.length + 1}`);
    params.push(args.slug);
  }
  if (args.description !== undefined) {
    sets.push(`description = $${params.length + 1}`);
    params.push(args.description);
  }
  if (args.coverImageId !== undefined) {
    sets.push(`cover_image_id = $${params.length + 1}`);
    params.push(args.coverImageId);
  }
  if (args.published !== undefined) {
    sets.push(`published = $${params.length + 1}`);
    params.push(args.published);
  }
  if (sets.length === 0) return findAlbumById(driver, { siteId: args.siteId, id: args.id });

  const rows = await driver.query<AlbumRow>(
    `UPDATE albums SET ${sets.join(', ')}
     WHERE site_id = $1 AND id = $2
     RETURNING ${SELECT}`,
    params,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function setAlbumImages(
  driver: SqlDriver,
  args: { albumId: string; orderedImageIds: string[] },
): Promise<void> {
  await driver.exec(
    `DELETE FROM album_images WHERE album_id = $1`,
    [args.albumId],
  );

  for (let i = 0; i < args.orderedImageIds.length; i++) {
    await driver.exec(
      `INSERT INTO album_images (album_id, image_id, sort_order) VALUES ($1, $2, $3)`,
      [args.albumId, args.orderedImageIds[i], i],
    );
  }
}

export async function delAlbum(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<void> {
  await driver.exec(
    `DELETE FROM albums WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
}
