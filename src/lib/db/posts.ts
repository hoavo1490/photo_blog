import type { SqlDriver } from './driver';

// Every public function takes `siteId` and includes it in WHERE / SET
// scoping. This is the application-layer tenant isolation; combined
// with Postgres RLS (added in a later migration), the system has two
// independent layers of defense against cross-tenant data leakage.
//
// `del` is named with a trailing letter because `delete` is reserved.

export type PostStatus = 'draft' | 'published' | 'scheduled';

export interface Post {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  body: string;
  coverImageId: string | null;
  description: string | null;
  status: PostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PostRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  body: string;
  cover_image_id: string | null;
  description: string | null;
  status: PostStatus;
  published_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function fromRow(r: PostRow): Post {
  return {
    id: r.id,
    siteId: r.site_id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    coverImageId: r.cover_image_id,
    description: r.description,
    status: r.status,
    publishedAt: r.published_at ? new Date(r.published_at as string | Date) : null,
    createdAt: new Date(r.created_at as string | Date),
    updatedAt: new Date(r.updated_at as string | Date),
  };
}

const SELECT = `
  id, site_id, slug, title, body, cover_image_id, description,
  status, published_at, created_at, updated_at
`;

// ----- create ----- //

export interface CreateDraftInput {
  siteId: string;
  slug: string;
  title: string;
  body?: string;
  description?: string | null;
  coverImageId?: string | null;
}

export async function createDraft(driver: SqlDriver, input: CreateDraftInput): Promise<Post> {
  const rows = await driver.query<PostRow>(
    `INSERT INTO posts (site_id, slug, title, body, description, cover_image_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')
     RETURNING ${SELECT}`,
    [
      input.siteId,
      input.slug,
      input.title,
      input.body ?? '',
      input.description ?? null,
      input.coverImageId ?? null,
    ],
  );
  return fromRow(rows[0]);
}

// ----- find ----- //

export async function findById(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<Post | null> {
  const rows = await driver.query<PostRow>(
    `SELECT ${SELECT} FROM posts WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function findBySlug(
  driver: SqlDriver,
  args: { siteId: string; slug: string },
): Promise<Post | null> {
  const rows = await driver.query<PostRow>(
    `SELECT ${SELECT} FROM posts WHERE site_id = $1 AND slug = $2`,
    [args.siteId, args.slug],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface FindByPathInput {
  siteId: string;
  year: string;
  month: string;
  day: string;
  slug: string;
}

export async function findByPath(driver: SqlDriver, args: FindByPathInput): Promise<Post | null> {
  // Only published posts have URL-resolvable paths. Match the slug + the
  // UTC year/month/day of published_at.
  const rows = await driver.query<PostRow>(
    `SELECT ${SELECT}
     FROM posts
     WHERE site_id = $1
       AND slug = $2
       AND status = 'published'
       AND to_char(published_at AT TIME ZONE 'UTC', 'YYYY') = $3
       AND to_char(published_at AT TIME ZONE 'UTC', 'MM') = $4
       AND to_char(published_at AT TIME ZONE 'UTC', 'DD') = $5`,
    [args.siteId, args.slug, args.year, args.month, args.day],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

// ----- list ----- //

export interface ListPublishedInput {
  siteId: string;
  limit?: number;
  offset?: number;
}

export async function listPublished(
  driver: SqlDriver,
  args: ListPublishedInput,
): Promise<Post[]> {
  const limit = args.limit ?? 100;
  const offset = args.offset ?? 0;
  const rows = await driver.query<PostRow>(
    `SELECT ${SELECT}
     FROM posts
     WHERE site_id = $1 AND status = 'published' AND published_at <= now()
     ORDER BY published_at DESC
     LIMIT $2 OFFSET $3`,
    [args.siteId, limit, offset],
  );
  return rows.map(fromRow);
}

// ----- mutate ----- //

export interface PublishInput {
  siteId: string;
  id: string;
  publishedAt?: Date;
}

export async function publish(driver: SqlDriver, args: PublishInput): Promise<Post | null> {
  const rows = await driver.query<PostRow>(
    `UPDATE posts
     SET status = 'published',
         published_at = $3::timestamptz
     WHERE site_id = $1 AND id = $2
     RETURNING ${SELECT}`,
    [args.siteId, args.id, (args.publishedAt ?? new Date()).toISOString()],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface UpdatePostInput {
  siteId: string;
  id: string;
  title?: string;
  body?: string;
  description?: string | null;
  coverImageId?: string | null;
  /** When provided, restamps published_at. The editor's date chip uses
   *  this to let authors retroactively change a post's publish day; the
   *  /YYYY/MM/DD/<slug> URL changes with it (by design). */
  publishedAt?: Date;
}

export async function update(driver: SqlDriver, args: UpdatePostInput): Promise<Post | null> {
  // Dynamic SET clause for present fields only. We keep this readable rather
  // than chasing maximum performance -- few posts in flight at once.
  const sets: string[] = [];
  const params: unknown[] = [args.siteId, args.id];
  if (args.title !== undefined) {
    sets.push(`title = $${params.length + 1}`);
    params.push(args.title);
  }
  if (args.body !== undefined) {
    sets.push(`body = $${params.length + 1}`);
    params.push(args.body);
  }
  if (args.description !== undefined) {
    sets.push(`description = $${params.length + 1}`);
    params.push(args.description);
  }
  if (args.coverImageId !== undefined) {
    sets.push(`cover_image_id = $${params.length + 1}`);
    params.push(args.coverImageId);
  }
  if (args.publishedAt !== undefined) {
    sets.push(`published_at = $${params.length + 1}::timestamptz`);
    params.push(args.publishedAt.toISOString());
  }
  if (sets.length === 0) return findById(driver, { siteId: args.siteId, id: args.id });

  const rows = await driver.query<PostRow>(
    `UPDATE posts SET ${sets.join(', ')}
     WHERE site_id = $1 AND id = $2
     RETURNING ${SELECT}`,
    params,
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Find the published sibling posts on the same site immediately
 *  before and after `post` by publish date. Used by the post detail
 *  page to render the prev / next chevrons in the closing divider.
 *  Drafts and scheduled posts are ignored. Returns nulls at the
 *  ends of the timeline. */
export async function findAdjacent(
  driver: SqlDriver,
  args: { siteId: string; post: Pick<Post, 'id' | 'publishedAt'> },
): Promise<{ previous: Post | null; next: Post | null }> {
  if (!args.post.publishedAt) return { previous: null, next: null };
  const publishedAt = args.post.publishedAt.toISOString();
  // Tie-break on id when two posts share a published_at, so navigating
  // through ties is deterministic and complete.
  const [prevRows, nextRows] = await Promise.all([
    driver.query<PostRow>(
      `SELECT ${SELECT} FROM posts
       WHERE site_id = $1 AND status = 'published' AND id <> $2
         AND (published_at < $3::timestamptz
              OR (published_at = $3::timestamptz AND id < $2))
       ORDER BY published_at DESC, id DESC
       LIMIT 1`,
      [args.siteId, args.post.id, publishedAt],
    ),
    driver.query<PostRow>(
      `SELECT ${SELECT} FROM posts
       WHERE site_id = $1 AND status = 'published' AND id <> $2
         AND (published_at > $3::timestamptz
              OR (published_at = $3::timestamptz AND id > $2))
       ORDER BY published_at ASC, id ASC
       LIMIT 1`,
      [args.siteId, args.post.id, publishedAt],
    ),
  ]);
  return {
    previous: prevRows[0] ? fromRow(prevRows[0]) : null,
    next: nextRows[0] ? fromRow(nextRows[0]) : null,
  };
}

export async function del(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<void> {
  await driver.exec(
    `DELETE FROM posts WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
}
