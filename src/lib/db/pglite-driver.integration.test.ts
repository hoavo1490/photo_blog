import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { freshDb } from '../../../tests/setup/pglite';
import type { PgliteDriver } from './pglite-driver';

describe('pglite-driver + migrations', () => {
  let driver: PgliteDriver;

  beforeAll(async () => {
    driver = await freshDb();
  });

  afterAll(async () => {
    await driver.close();
  });

  it('applies the schema and exposes all expected tables', async () => {
    const rows = await driver.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = rows.map((r) => r.tablename);
    expect(names).toEqual([
      'images',
      'pages',
      'post_tags',
      'posts',
      'sessions',
      'site_domain_history',
      'site_members',
      'sites',
      'tags',
      'users',
    ]);
  });

  it('rejects inserts that violate the status CHECK constraint on posts', async () => {
    await driver.exec(
      `INSERT INTO sites (id, slug, name) VALUES ('00000000-0000-0000-0000-000000000001', 'tmp', 'tmp')`,
    );
    await expect(
      driver.exec(
        `INSERT INTO posts (site_id, slug, title, status)
         VALUES ('00000000-0000-0000-0000-000000000001', 's', 't', 'whatever')`,
      ),
    ).rejects.toThrow(/check|constraint/i);
    // cleanup
    await driver.exec(`DELETE FROM sites WHERE id = '00000000-0000-0000-0000-000000000001'`);
  });

  it('updates posts.updated_at via trigger on UPDATE', async () => {
    await driver.exec(
      `INSERT INTO sites (id, slug, name) VALUES ('00000000-0000-0000-0000-000000000002', 'tmp2', 'tmp2')`,
    );
    await driver.exec(
      `INSERT INTO posts (id, site_id, slug, title)
       VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000002', 'hi', 'Hi')`,
    );
    const [before] = await driver.query<{ updated_at: string }>(
      `SELECT updated_at FROM posts WHERE id = '00000000-0000-0000-0000-000000000099'`,
    );
    // Sleep 10ms so the trigger sees a later timestamp.
    await new Promise((r) => setTimeout(r, 10));
    await driver.exec(
      `UPDATE posts SET title = 'Hello' WHERE id = '00000000-0000-0000-0000-000000000099'`,
    );
    const [after] = await driver.query<{ updated_at: string }>(
      `SELECT updated_at FROM posts WHERE id = '00000000-0000-0000-0000-000000000099'`,
    );
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    await driver.exec(`DELETE FROM sites WHERE id = '00000000-0000-0000-0000-000000000002'`);
  });
});
