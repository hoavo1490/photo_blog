import { PGlite } from '@electric-sql/pglite';
import type { Row, SqlDriver } from './driver';

// Test-only driver. Backed by an in-process PGLite instance.
//
// Usage in tests:
//   const driver = await createPgliteDriver();
//   await driver.applyMigrations(MIGRATION_SQL);
//   await driver.query('SELECT 1', []);
//   await driver.close();
//
// Each test file should create its own driver in beforeAll and close it
// in afterAll. Per-test isolation is via TRUNCATE in beforeEach, not
// instance recreation -- PGLite startup is ~50ms and that adds up.

export interface PgliteDriver extends SqlDriver {
  readonly db: PGlite;
  applyMigrations(sql: string): Promise<void>;
  close(): Promise<void>;
}

export async function createPgliteDriver(): Promise<PgliteDriver> {
  const db = new PGlite();
  // Wait for the WASM runtime to be ready before returning.
  await db.waitReady;

  return {
    db,
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db.query(text, params);
      return result.rows as T[];
    },
    async exec(text: string, params: unknown[] = []): Promise<void> {
      await db.query(text, params);
    },
    async applyMigrations(sql: string): Promise<void> {
      // PGLite supports multi-statement scripts via exec().
      await db.exec(sql);
    },
    async close(): Promise<void> {
      await db.close();
    },
  };
}
