import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';

const url = fs.readFileSync('.dev.vars', 'utf8').match(/DATABASE_URL=(.+)/)[1].trim();
const sql = neon(url);

const APPLY = process.argv.includes('--apply');

// "Camera filename" alt: just digits, optionally with a decimal tail like
// "1.00", "1000045223", "1000045240.00". Real captions ("Ngột", "Thuỷ mặc")
// don't match this pattern.
const FILENAME_ALT_RE = /^\d+(\.\d+)?$/;

function refine(body) {
  let s = body.replace(/\r\n?/g, '\n');

  // 1) Strip camera-filename alts.
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (whole, alt, url) => {
    return FILENAME_ALT_RE.test(alt.trim()) ? `![](${url})` : whole;
  });

  // 2) Ensure a blank line BEFORE an image that follows non-image text.
  //    Specifically: text on a line, then an image starts mid-line or on
  //    the very next line with no blank in between.
  //
  //    Catch the "glued" case: text immediately followed by ![...](...)
  //    on the same line OR the next line. We split into lines and rebuild.
  const lines = s.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Handle trailing-glued image: text followed by ![](...) on same line.
    // Example: "blah blah![alt](url)"
    const trailingImg = /^(.+?\S)(\s*)(!\[[^\]]*\]\([^)]+\).*)$/.exec(line);
    if (trailingImg) {
      out.push(trailingImg[1]);
      out.push('');
      line = trailingImg[3];
    }

    // Handle leading-glued image: ![](...) followed by text on same line.
    // Example: "![alt](url)Some text here..."
    const leadingImg = /^(!\[[^\]]*\]\([^)]+\))(\S.*)$/.exec(line);
    if (leadingImg) {
      out.push(leadingImg[1]);
      out.push('');
      line = leadingImg[2];
    }

    // Handle image directly after a non-blank line with no blank between.
    const prev = out[out.length - 1];
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(line) && prev !== undefined && prev.trim() !== '' && !/^!\[/.test(prev)) {
      out.push('');
    }

    // Handle non-image text directly after an image with no blank between.
    if (prev !== undefined && /^!\[[^\]]*\]\([^)]+\)\s*$/.test(prev) && line.trim() !== '' && !/^!\[/.test(line)) {
      out.push('');
    }

    out.push(line);
  }
  s = out.join('\n');

  // 3) Collapse 3+ blank lines down to 2 (= one blank line between blocks).
  s = s.replace(/\n{3,}/g, '\n\n');

  // 4) Trim trailing whitespace/blank lines, keep one final newline.
  s = s.replace(/[\t ]+$/gm, '');
  s = s.replace(/\n+$/, '\n');

  return s;
}

function unifiedDiff(a, b, slug) {
  const A = a.split('\n');
  const B = b.split('\n');
  const lines = [];
  lines.push(`--- ${slug} (before)`);
  lines.push(`+++ ${slug} (after)`);
  const max = Math.max(A.length, B.length);
  for (let i = 0; i < max; i++) {
    if (A[i] === B[i]) continue;
    if (A[i] !== undefined) lines.push(`- ${A[i]}`);
    if (B[i] !== undefined) lines.push(`+ ${B[i]}`);
  }
  return lines.join('\n');
}

const rows = await sql`select id, slug, body from posts where status='published'`;
let changedCount = 0;
for (const r of rows) {
  const next = refine(r.body);
  if (next === r.body) {
    console.log(`= ${r.slug} (no change)`);
    continue;
  }
  changedCount++;
  console.log(unifiedDiff(r.body, next, r.slug));
  console.log('');
  if (APPLY) {
    await sql`update posts set body = ${next}, updated_at = now() where id = ${r.id}`;
  }
}
console.log(`\n${APPLY ? 'Applied' : 'Would change'}: ${changedCount} post(s).`);
