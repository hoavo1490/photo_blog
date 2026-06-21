#!/usr/bin/env node
// Apply migrations to a Postgres database. Usage:
//   DATABASE_URL=postgres://... node scripts/migrate.mjs
//
// Reads every .sql file under ./migrations in lexical order and pipes
// them to psql. Idempotent across migration files that use CREATE TABLE
// IF NOT EXISTS etc.; 0001_init.sql is not -- run it only once per DB.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const dir = new URL('../migrations/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error('No migrations found');
  process.exit(1);
}

for (const f of files) {
  console.log(`\n--- applying ${f} ---`);
  const sql = readFileSync(join(dir, f), 'utf8');
  const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    console.error(`migration ${f} failed`);
    process.exit(r.status ?? 1);
  }
}
console.log('\nall migrations applied.');
