import { neon } from '@neondatabase/serverless';
import type { Row, SqlDriver } from './driver';

// Production driver. @neondatabase/serverless v1.0+ requires:
//   - tagged-template OR sql.query(text, params)
//   - the `-pooler` host in the connection URL
//   - sslmode=require in the URL
//
// We use sql.query() to keep a single text+params shape across drivers.

export function createNeonDriver(databaseUrl: string): SqlDriver {
  const sql = neon(databaseUrl);

  return {
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await sql.query(text, params as any[]);
      return rows as T[];
    },
    async exec(text: string, params: unknown[] = []): Promise<void> {
      await sql.query(text, params as any[]);
    },
  };
}
