import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';

const MAX = 200;

export function remarkDescription() {
  return (tree, file) => {
    const fm = (file.data.astro ??= { frontmatter: {} }).frontmatter ??= {};
    if (fm.description) return;
    let found = null;
    visit(tree, 'paragraph', (node) => {
      if (found) return;
      const text = toString(node).trim();
      if (text) found = text;
    });
    if (!found) return;
    fm.description = found.length > MAX ? found.slice(0, MAX).trimEnd() + '…' : found;
  };
}
