import type { D1Database } from '@cloudflare/workers-types';
import type { Row, SqlDriver } from './driver';

// D1 driver. Translates the Postgres-flavoured SQL used throughout the
// repository into SQLite-compatible SQL at runtime so db/*.ts files stay
// driver-agnostic.
//
// Translations applied:
//   $1, $2, ...  →  ?  (D1 uses positional ? not $N)
//   ::type        →  (stripped — no cast operators in SQLite)
//   now()         →  strftime('%Y-%m-%dT%H:%M:%fZ','now')
//   to_char(col AT TIME ZONE 'UTC', 'YYYY/MM/DD')  →  strftime('%Y/%m/%d', col)
//
// Param serialisation:
//   Date      →  ISO 8601 string
//   Array     →  JSON string  (variant_widths is stored as TEXT '[]')

function translateSql(sql: string): string {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/::[a-zA-Z_][\w[\]]*/g, '')
    .replace(/\bnow\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .replace(/to_char\(\s*(\w+)\s+AT\s+TIME\s+ZONE\s+'UTC',\s*'YYYY'\s*\)/gi, "strftime('%Y',$1)")
    .replace(/to_char\(\s*(\w+)\s+AT\s+TIME\s+ZONE\s+'UTC',\s*'MM'\s*\)/gi, "strftime('%m',$1)")
    .replace(/to_char\(\s*(\w+)\s+AT\s+TIME\s+ZONE\s+'UTC',\s*'DD'\s*\)/gi, "strftime('%d',$1)");
}

function serializeParam(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return JSON.stringify(v);
  return v;
}

export function createD1Driver(db: D1Database): SqlDriver {
  return {
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db
        .prepare(translateSql(text))
        .bind(...params.map(serializeParam))
        .all<T>();
      return result.results ?? [];
    },
    async exec(text: string, params: unknown[] = []): Promise<void> {
      await db
        .prepare(translateSql(text))
        .bind(...params.map(serializeParam))
        .run();
    },
  };
}
