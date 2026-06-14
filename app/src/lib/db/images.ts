import type { SqlDriver } from './driver';

// Image metadata. The bytes live in R2 (keyed by r2_key); this table is
// the source of truth for which keys exist, who owns them, and what their
// intrinsic dimensions are (so PhotoSwipe can place the lightbox without
// re-fetching). r2_key is globally unique so the same key can't be
// claimed by two sites -- R2's flat namespace doesn't isolate by site
// without app-layer enforcement.

export interface Image {
  id: string;
  siteId: string;
  r2Key: string;
  originalName: string;
  sizeBytes: number;
  width: number;
  height: number;
  uploadedBy: string | null;
  uploadedAt: Date;
}

interface ImageRow {
  id: string;
  site_id: string;
  r2_key: string;
  original_name: string;
  size_bytes: number;
  width: number;
  height: number;
  uploaded_by: string | null;
  uploaded_at: string | Date;
}

function fromRow(r: ImageRow): Image {
  return {
    id: r.id,
    siteId: r.site_id,
    r2Key: r.r2_key,
    originalName: r.original_name,
    sizeBytes: typeof r.size_bytes === 'string' ? parseInt(r.size_bytes, 10) : r.size_bytes,
    width: typeof r.width === 'string' ? parseInt(r.width, 10) : r.width,
    height: typeof r.height === 'string' ? parseInt(r.height, 10) : r.height,
    uploadedBy: r.uploaded_by,
    uploadedAt: new Date(r.uploaded_at as string | Date),
  };
}

const SELECT = `id, site_id, r2_key, original_name, size_bytes, width, height, uploaded_by, uploaded_at`;

export interface CreateImageInput {
  siteId: string;
  r2Key: string;
  originalName: string;
  sizeBytes: number;
  width: number;
  height: number;
  uploadedBy: string | null;
}

export async function create(driver: SqlDriver, input: CreateImageInput): Promise<Image> {
  const rows = await driver.query<ImageRow>(
    `INSERT INTO images (site_id, r2_key, original_name, size_bytes, width, height, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SELECT}`,
    [
      input.siteId,
      input.r2Key,
      input.originalName,
      input.sizeBytes,
      input.width,
      input.height,
      input.uploadedBy,
    ],
  );
  return fromRow(rows[0]);
}

export async function findById(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<Image | null> {
  const rows = await driver.query<ImageRow>(
    `SELECT ${SELECT} FROM images WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listForSite(
  driver: SqlDriver,
  args: { siteId: string; limit?: number; offset?: number },
): Promise<Image[]> {
  const rows = await driver.query<ImageRow>(
    `SELECT ${SELECT} FROM images
     WHERE site_id = $1
     ORDER BY uploaded_at DESC
     LIMIT $2 OFFSET $3`,
    [args.siteId, args.limit ?? 100, args.offset ?? 0],
  );
  return rows.map(fromRow);
}

export async function del(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<void> {
  await driver.exec(
    `DELETE FROM images WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
}
