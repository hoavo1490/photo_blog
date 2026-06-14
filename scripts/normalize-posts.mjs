import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const SRC = '_posts';
const DST = 'src/content/posts';

fs.mkdirSync(DST, { recursive: true });

let migrated = 0;
let warnings = [];

for (const file of fs.readdirSync(SRC)) {
  if (!/\.(markdown|md)$/i.test(file)) continue;
  const match = file.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.(?:markdown|md)$/i);
  if (!match) {
    warnings.push(`skip (no date prefix): ${file}`);
    continue;
  }
  const [, y, m, d, slug] = match;

  const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  const { data, content } = matter(raw);

  delete data.layout;
  if (!data.date) data.date = `${y}-${m}-${d}`;
  if (data.tags && typeof data.tags === 'string') data.tags = [data.tags];
  if (!Array.isArray(data.tags)) data.tags = [];

  // Sanity check: warn on Liquid tags that Astro won't process.
  if (/{%\s*\w/.test(content)) {
    warnings.push(`contains Liquid tags: ${file}`);
  }

  const out = matter.stringify(content, data);
  const outName = `${y}-${m}-${d}-${slug}.md`;
  fs.writeFileSync(path.join(DST, outName), out);
  migrated++;
}

console.log(`migrated ${migrated} posts to ${DST}`);
if (warnings.length) {
  console.warn('\nwarnings:');
  for (const w of warnings) console.warn('  -', w);
}
