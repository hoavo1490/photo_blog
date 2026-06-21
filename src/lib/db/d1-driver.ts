import type { D1Database } from '@cloudflare/workers-types';
import type { Row, SqlDriver } from './driver';

// D1 driver. Translates the Postgres-flavoured SQL used throughout the
// repository into SQLite-compatible SQL at runtime so db/*.ts files stay
// driver-agnostic.
//
// Translations applied:
//   $1, $2, ...   →  ?  (D1 uses positional ? not $N)
//   ::type        →  (stripped — no cast operators in SQLite)
//   NULLS LAST/FIRST → (stripped — SQLite sorts NULLs first asc / last desc
//                       by default; matches Postgres NULLS LAST for our
//                       DESC-by-timestamp queries)
//   now()         →  strftime('%Y-%m-%dT%H:%M:%fZ','now')
//   to_char(col AT TIME ZONE 'UTC', 'YYYY/MM/DD')  →  strftime('%Y/%m/%d', col)
//
// Param serialisation (write side):
//   Date      →  ISO 8601 string
//   Array     →  JSON string  (variant_widths is stored as TEXT '[]')
//
// Result deserialisation (read side):
//   JSON_ARRAY_COLUMNS values that come back as strings → parsed back
//   into JS arrays so repository code reads native arrays regardless
//   of which backend served the query.

function translateSql(sql: string): string {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/::[a-zA-Z_][\w[\]]*/g, '')
    .replace(/\s+NULLS\s+(LAST|FIRST)\b/gi, '')
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

// Columns we know are stored as JSON-string TEXT in the D1 schema but
// app code consumes as a JS array (variant_widths is stored as
// `TEXT NOT NULL DEFAULT '[]'`). The driver auto-parses these on read
// so every repository/render call site gets a native array instead of
// the raw JSON string. Adding a new array column means appending here.
const JSON_ARRAY_COLUMNS = new Set(['variant_widths']);

function deserializeRow<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const r = row as Record<string, unknown>;
  for (const col of JSON_ARRAY_COLUMNS) {
    const v = r[col];
    if (typeof v === 'string' && v.length >= 2 && v.charCodeAt(0) === 0x5b /* [ */) {
      try {
        r[col] = JSON.parse(v);
      } catch {
        // Leave the original string in place if it isn't valid JSON --
        // surfacing the raw value lets the caller see what's wrong
        // rather than silently swallowing data.
      }
    }
  }
  return row;
}

export function createD1Driver(db: D1Database): SqlDriver {
  return {
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await db
        .prepare(translateSql(text))
        .bind(...params.map(serializeParam))
        .all<T>();
      return (result.results ?? []).map(deserializeRow);
    },
    async exec(text: string, params: unknown[] = []): Promise<void> {
      await db
        .prepare(translateSql(text))
        .bind(...params.map(serializeParam))
        .run();
    },
  };
}
