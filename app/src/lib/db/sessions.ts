import type { SqlDriver } from './driver';

// Server-side sessions. Cookie carries the session id; this table is the
// source of truth. Choices that paid off in the critic review:
//   - revoked_at column (free "log out other devices" + audit)
//   - explicit expires_at (no clock drift between client / server)
//   - last_used_at refreshed via touch() to enable idle expiry policies later
//
// findActive enforces "not revoked AND not expired" in SQL so callers
// can't accidentally serve a revoked session.

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: string | Date;
  last_used_at: string | Date;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  user_agent: string | null;
}

function fromRow(r: SessionRow): Session {
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: new Date(r.created_at as string | Date),
    lastUsedAt: new Date(r.last_used_at as string | Date),
    expiresAt: new Date(r.expires_at as string | Date),
    revokedAt: r.revoked_at ? new Date(r.revoked_at as string | Date) : null,
    userAgent: r.user_agent,
  };
}

export interface CreateSessionInput {
  userId: string;
  expiresAt: Date;
  userAgent?: string | null;
}

export async function create(driver: SqlDriver, input: CreateSessionInput): Promise<Session> {
  const rows = await driver.query<SessionRow>(
    `INSERT INTO sessions (user_id, expires_at, user_agent)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, created_at, last_used_at, expires_at, revoked_at, user_agent`,
    [input.userId, input.expiresAt.toISOString(), input.userAgent ?? null],
  );
  return fromRow(rows[0]);
}

export async function findActive(driver: SqlDriver, id: string): Promise<Session | null> {
  const rows = await driver.query<SessionRow>(
    `SELECT id, user_id, created_at, last_used_at, expires_at, revoked_at, user_agent
     FROM sessions
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function touch(driver: SqlDriver, id: string): Promise<void> {
  // Skip update when already revoked -- avoids confusing "kept alive after revoke" semantics.
  await driver.exec(
    `UPDATE sessions SET last_used_at = now()
     WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
}

export async function revoke(driver: SqlDriver, id: string): Promise<void> {
  await driver.exec(
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
}

export async function revokeAllForUser(driver: SqlDriver, userId: string): Promise<void> {
  await driver.exec(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
