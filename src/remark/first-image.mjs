import { visit } from 'unist-util-visit';

export function remarkFirstImage() {
  return (tree, file) => {
    const fm = (file.data.astro ??= { frontmatter: {} }).frontmatter ??= {};
    if (fm.cover) return;
    let found = null;
    visit(tree, 'image', (node) => {
      if (!found && node.url) found = node.url;
    });
    if (!found) {
      visit(tree, 'html', (node) => {
        if (found) return;
        const m = node.value && node.value.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) found = m[1];
      });
    }
    if (found) fm.cover = found;
  };
}
