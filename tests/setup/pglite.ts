import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPgliteDriver, type PgliteDriver } from '../../src/lib/db/pglite-driver';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

/**
 * Create a fresh PGLite driver with all migrations applied.
 *
 * Use in `beforeAll` of an integration test:
 *
 *   let driver: PgliteDriver;
 *   beforeAll(async () => { driver = await freshDb(); });
 *   afterAll(async () => { await driver.close(); });
 *
 * Combine with `clearAllTables(driver)` in `beforeEach` for per-test
 * isolation -- TRUNCATE is ~2-5ms; recreating the instance would be ~50ms.
 */
export async function freshDb(): Promise<PgliteDriver> {
  const driver = await createPgliteDriver();
  // Apply every migration file in lexical order, matching production.
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
    await driver.applyMigrations(sql);
  }
  return driver;
}

/** Wipe all rows from every user table, keep schema. */
export async function clearAllTables(driver: PgliteDriver): Promise<void> {
  // Single statement so deletes happen in the right FK order (CASCADE).
  await driver.exec(
    'TRUNCATE TABLE ' +
      'sessions, post_tags, tags, posts, images, pages, ' +
      'site_domain_history, site_members, sites, users ' +
      'RESTART IDENTITY CASCADE',
  );
}
