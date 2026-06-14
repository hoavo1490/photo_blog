import type { SqlDriver } from './driver';

// Stable identity: github_id. github_login is denormalized and refreshed
// on every upsert (GitHub allows username changes; we still want the
// latest one shown in UI). Tests assert that two distinct github_ids
// with the same login remain separate rows -- the unique constraint is
// on github_id, not github_login.

export interface User {
  id: string;
  githubId: number;
  githubLogin: string;
  email: string | null;
  createdAt: Date;
}

interface UserRow {
  id: string;
  github_id: string | number; // PG bigint comes back as string from some drivers
  github_login: string;
  email: string | null;
  created_at: string | Date;
}

function fromRow(r: UserRow): User {
  return {
    id: r.id,
    githubId: typeof r.github_id === 'string' ? Number(r.github_id) : r.github_id,
    githubLogin: r.github_login,
    email: r.email,
    createdAt: new Date(r.created_at as string | Date),
  };
}

export async function findById(driver: SqlDriver, id: string): Promise<User | null> {
  const rows = await driver.query<UserRow>(
    'SELECT id, github_id, github_login, email, created_at FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function findByGithubId(driver: SqlDriver, githubId: number): Promise<User | null> {
  const rows = await driver.query<UserRow>(
    'SELECT id, github_id, github_login, email, created_at FROM users WHERE github_id = $1',
    [githubId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface UpsertGithubUserInput {
  githubId: number;
  githubLogin: string;
  email: string | null;
}

export async function upsertByGithubId(
  driver: SqlDriver,
  input: UpsertGithubUserInput,
): Promise<User> {
  // Insert; on conflict on github_id, refresh login + email and return existing row.
  const rows = await driver.query<UserRow>(
    `INSERT INTO users (github_id, github_login, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (github_id) DO UPDATE
       SET github_login = EXCLUDED.github_login,
           email = EXCLUDED.email
     RETURNING id, github_id, github_login, email, created_at`,
    [input.githubId, input.githubLogin, input.email],
  );
  return fromRow(rows[0]);
}
