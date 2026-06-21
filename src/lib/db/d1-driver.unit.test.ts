import { describe, it, expect } from 'vitest';
import { createD1Driver } from './d1-driver';

// We test only the SQL-translation surface here (the only thing that
// doesn't need a live D1 binding). End-to-end query coverage lives in
// the workers pool against miniflare's D1 emulation.

// Reach the internal translateSql by exposing it via a driver shim.
// We snoop the prepared text by intercepting `prepare()` on a fake D1.
interface CapturedQuery { sql: string; params: unknown[] }

function withFakeD1(): { driver: ReturnType<typeof createD1Driver>; captured: CapturedQuery[] } {
  const captured: CapturedQuery[] = [];
  const fakeStatement = {
    bind(...params: unknown[]) {
      // bind() returns a new statement that holds the params
      return {
        async all() { captured[captured.length - 1].params = params; return { results: [] }; },
        async run() { captured[captured.length - 1].params = params; },
      };
    },
  };
  const fakeDb = {
    prepare(sql: string) {
      captured.push({ sql, params: [] });
      return fakeStatement;
    },
  } as unknown as Parameters<typeof createD1Driver>[0];
  return { driver: createD1Driver(fakeDb), captured };
}

describe('d1-driver SQL translation', () => {
  it('rewrites $N placeholders to ?', async () => {
    const { driver, captured } = withFakeD1();
    await driver.query('SELECT * FROM posts WHERE id = $1 AND status = $2', ['x', 'y']);
    expect(captured[0].sql).toBe('SELECT * FROM posts WHERE id = ? AND status = ?');
  });

  it('strips ::type and ::type[] casts', async () => {
    const { driver, captured } = withFakeD1();
    await driver.query('SELECT $1::text, $2::int[], $3::uuid', []);
    expect(captured[0].sql).toBe('SELECT ?, ?, ?');
  });

  it('strips NULLS LAST / NULLS FIRST', async () => {
    const { driver, captured } = withFakeD1();
    await driver.query('SELECT id FROM posts ORDER BY published_at DESC NULLS LAST', []);
    expect(captured[0].sql).toBe('SELECT id FROM posts ORDER BY published_at DESC');
    await driver.query('SELECT id FROM posts ORDER BY published_at ASC NULLS FIRST, id', []);
    expect(captured[1].sql).toBe('SELECT id FROM posts ORDER BY published_at ASC, id');
  });

  it('rewrites now() to a SQLite strftime expression', async () => {
    const { driver, captured } = withFakeD1();
    await driver.query('UPDATE posts SET updated_at = now() WHERE id = $1', ['x']);
    expect(captured[0].sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    expect(captured[0].sql).not.toContain('now()');
  });

  it('rewrites to_char ... AT TIME ZONE UTC patterns to strftime', async () => {
    const { driver, captured } = withFakeD1();
    await driver.query(
      `SELECT 1 WHERE to_char(published_at AT TIME ZONE 'UTC', 'YYYY') = $1
         AND to_char(published_at AT TIME ZONE 'UTC', 'MM') = $2
         AND to_char(published_at AT TIME ZONE 'UTC', 'DD') = $3`,
      ['2026', '06', '21'],
    );
    expect(captured[0].sql).toContain("strftime('%Y',published_at)");
    expect(captured[0].sql).toContain("strftime('%m',published_at)");
    expect(captured[0].sql).toContain("strftime('%d',published_at)");
  });
});

describe('d1-driver param serialization', () => {
  it('serializes Date params to ISO strings', async () => {
    const { driver, captured } = withFakeD1();
    const d = new Date('2026-06-21T12:00:00.000Z');
    await driver.exec('INSERT INTO sessions (id, expires_at) VALUES ($1, $2)', ['x', d]);
    expect(captured[0].params[1]).toBe('2026-06-21T12:00:00.000Z');
  });

  it('serializes array params to JSON strings', async () => {
    const { driver, captured } = withFakeD1();
    await driver.exec('UPDATE images SET variant_widths = $1', [[400, 800, 1200]]);
    expect(captured[0].params[0]).toBe('[400,800,1200]');
  });

  it('leaves strings, numbers, booleans, and nulls untouched', async () => {
    const { driver, captured } = withFakeD1();
    await driver.exec('INSERT INTO posts (id, title, status, cover) VALUES ($1,$2,$3,$4)',
      ['id', 'hi', 'published', null]);
    expect(captured[0].params).toEqual(['id', 'hi', 'published', null]);
  });
});
