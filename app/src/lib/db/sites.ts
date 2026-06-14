import type { SqlDriver } from './driver';

// Tenant table. findByHost is the hottest lookup -- called by every public
// request through middleware. It checks current custom_domain first, then
// falls back to site_domain_history for SEO-preserving 301 redirects after
// a domain change (the isCurrentHost flag tells the middleware whether to
// serve or redirect).

export type SiteRole = 'owner' | 'editor';

export interface Site {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  createdAt: Date;
}

export interface SiteHostMatch extends Site {
  isCurrentHost: boolean;
}

export interface SiteWithRole extends Site {
  role: SiteRole;
}

interface SiteRow {
  id: string;
  slug: string;
  name: string;
  custom_domain: string | null;
  created_at: string | Date;
}

function fromRow(r: SiteRow): Site {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    customDomain: r.custom_domain,
    createdAt: new Date(r.created_at as string | Date),
  };
}

export interface CreateSiteInput {
  slug: string;
  name: string;
  customDomain?: string | null;
}

export async function create(driver: SqlDriver, input: CreateSiteInput): Promise<Site> {
  const rows = await driver.query<SiteRow>(
    `INSERT INTO sites (slug, name, custom_domain)
     VALUES ($1, $2, $3)
     RETURNING id, slug, name, custom_domain, created_at`,
    [input.slug, input.name, input.customDomain ?? null],
  );
  return fromRow(rows[0]);
}

export async function findById(driver: SqlDriver, id: string): Promise<Site | null> {
  const rows = await driver.query<SiteRow>(
    'SELECT id, slug, name, custom_domain, created_at FROM sites WHERE id = $1',
    [id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function findBySlug(driver: SqlDriver, slug: string): Promise<Site | null> {
  const rows = await driver.query<SiteRow>(
    'SELECT id, slug, name, custom_domain, created_at FROM sites WHERE slug = $1',
    [slug],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function findByHost(driver: SqlDriver, host: string): Promise<SiteHostMatch | null> {
  const normalizedHost = host.toLowerCase();

  // Prefer current host.
  const current = await driver.query<SiteRow>(
    'SELECT id, slug, name, custom_domain, created_at FROM sites WHERE LOWER(custom_domain) = $1',
    [normalizedHost],
  );
  if (current[0]) return { ...fromRow(current[0]), isCurrentHost: true };

  // Historic host -> indicates we should 301 to the current custom_domain.
  const historic = await driver.query<SiteRow>(
    `SELECT s.id, s.slug, s.name, s.custom_domain, s.created_at
     FROM sites s
     JOIN site_domain_history h ON h.site_id = s.id
     WHERE LOWER(h.old_domain) = $1`,
    [normalizedHost],
  );
  if (historic[0]) return { ...fromRow(historic[0]), isCurrentHost: false };

  return null;
}

export interface AddMemberInput {
  siteId: string;
  userId: string;
  role: SiteRole;
}

export async function addMember(driver: SqlDriver, input: AddMemberInput): Promise<void> {
  await driver.exec(
    `INSERT INTO site_members (site_id, user_id, role) VALUES ($1, $2, $3)`,
    [input.siteId, input.userId, input.role],
  );
}

export interface FindMembershipInput {
  siteId: string;
  userId: string;
}

export interface Membership {
  siteId: string;
  userId: string;
  role: SiteRole;
  addedAt: Date;
}

export async function findMembership(
  driver: SqlDriver,
  input: FindMembershipInput,
): Promise<Membership | null> {
  const rows = await driver.query<{
    site_id: string;
    user_id: string;
    role: SiteRole;
    added_at: string | Date;
  }>(
    `SELECT site_id, user_id, role, added_at
     FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [input.siteId, input.userId],
  );
  if (!rows[0]) return null;
  return {
    siteId: rows[0].site_id,
    userId: rows[0].user_id,
    role: rows[0].role,
    addedAt: new Date(rows[0].added_at as string | Date),
  };
}

export async function listForUser(driver: SqlDriver, userId: string): Promise<SiteWithRole[]> {
  const rows = await driver.query<SiteRow & { role: SiteRole }>(
    `SELECT s.id, s.slug, s.name, s.custom_domain, s.created_at, m.role
     FROM sites s
     JOIN site_members m ON m.site_id = s.id
     WHERE m.user_id = $1
     ORDER BY m.added_at ASC`,
    [userId],
  );
  return rows.map((r) => ({ ...fromRow(r), role: r.role }));
}
