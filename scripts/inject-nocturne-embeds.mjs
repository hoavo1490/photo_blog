// One-off content edit: add YouTube URLs after each track mention in
// the Nocturne post. Idempotent — re-running is a no-op once URLs are
// present (we check for the URL line right after the title).
//
// URLs picked from established interpreters:
//   * John O'Conor: Field's canonical recorder (Nos. 1 and 5)
//   * Rubinstein 1965: the touchstone Op. 9 No. 2
//   * Pollini: contrast for Op. 27 No. 2

import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const sql = neon(url);
const APPLY = process.argv.includes('--apply');

const SLUG = 'ai-moi-la-nguoi-khai-sinh-ra-nocturne';

const insertions = [
  {
    after: 'John Field – Nocturne No. 1 in E-flat Major',
    url: 'https://www.youtube.com/watch?v=3yIp6t-0lMA',
  },
  {
    after: 'Chopin – Nocturne Op. 9 No. 2 in E-flat Major',
    url: 'https://www.youtube.com/watch?v=c2beUDDsgws',
  },
];

// Two extra tracks belong AFTER the paragraph that mentions both.
const longParagraphMarker = 'Để thấy Chopin đã dần bứt phá';
const trailingBlock = [
  '',
  '',
  'John Field – Nocturne No. 5 in B-flat Major',
  '',
  'https://www.youtube.com/watch?v=14QphtxLZ3w',
  '',
  'Chopin – Nocturne Op. 27 No. 2 in D-flat Major',
  '',
  'https://www.youtube.com/watch?v=CkPGi8yn4rk',
].join('\n');

function inject(body) {
  let out = body.replace(/\r\n?/g, '\n');

  // 1) Per-title URL insertion — only if not already present right below.
  for (const ins of insertions) {
    const re = new RegExp(
      `(${escapeReg(ins.after)})\\n\\n(?!${escapeReg(ins.url)})`,
      'g',
    );
    out = out.replace(re, `$1\n\n${ins.url}\n\n`);
  }

  // 2) Long-paragraph block: only append once.
  if (!out.includes(trailingBlock.trim())) {
    // Find the paragraph that starts with the marker and ends at the
    // next blank line. Insert the embed block right after it.
    const re = new RegExp(`(${escapeReg(longParagraphMarker)}[\\s\\S]*?)(\\n\\n)`, '');
    out = out.replace(re, `$1${trailingBlock}$2`);
  }

  return out;
}

function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function diff(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  const out = [];
  for (let i = 0, j = 0; i < A.length || j < B.length; ) {
    if (A[i] === B[j]) { i++; j++; continue; }
    if (B[j] !== undefined && !A.includes(B[j])) { out.push('+ ' + B[j]); j++; continue; }
    if (A[i] !== undefined && !B.includes(A[i])) { out.push('- ' + A[i]); i++; continue; }
    // safety
    if (A[i] !== undefined) { out.push('  ' + A[i]); i++; }
    if (B[j] !== undefined) { j++; }
  }
  return out.join('\n');
}

const [row] = await sql`select id, body from posts where slug = ${SLUG}`;
if (!row) {
  console.error(`Post not found: ${SLUG}`);
  process.exit(1);
}
const next = inject(row.body);
if (next === row.body) {
  console.log('No changes (already up to date).');
  process.exit(0);
}
console.log(diff(row.body, next));
console.log('');
if (APPLY) {
  await sql`update posts set body = ${next}, updated_at = now() where id = ${row.id}`;
  console.log('Applied.');
} else {
  console.log('Dry-run. Pass --apply to write.');
}
