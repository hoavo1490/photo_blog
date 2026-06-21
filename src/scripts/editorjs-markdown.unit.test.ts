import { describe, it, expect } from 'vitest';
import {
  editorJsToMarkdown,
  markdownToEditorJs,
  inlineHtmlToMarkdown,
  markdownInlineToHtml,
  type EditorJsOutput,
} from './editorjs-markdown';

describe('inlineHtmlToMarkdown', () => {
  it('handles bold, italic, inline-code, and links', () => {
    expect(inlineHtmlToMarkdown('<b>bold</b> and <i>italic</i>')).toBe('**bold** and *italic*');
    expect(inlineHtmlToMarkdown('<strong>x</strong>')).toBe('**x**');
    expect(inlineHtmlToMarkdown('<em>x</em>')).toBe('*x*');
    expect(inlineHtmlToMarkdown('use <code>npm</code>')).toBe('use `npm`');
    expect(inlineHtmlToMarkdown('<a href="https://x.com">link</a>')).toBe('[link](https://x.com)');
  });

  it('returns empty string for empty input', () => {
    expect(inlineHtmlToMarkdown('')).toBe('');
  });
});

describe('markdownInlineToHtml', () => {
  it('converts bold/italic/code/link', () => {
    expect(markdownInlineToHtml('**bold**')).toBe('<b>bold</b>');
    expect(markdownInlineToHtml('*italic*')).toBe('<i>italic</i>');
    expect(markdownInlineToHtml('`code`')).toBe('<code>code</code>');
    expect(markdownInlineToHtml('[t](https://x.com)')).toBe('<a href="https://x.com">t</a>');
  });

  it('escapes raw HTML in the input', () => {
    expect(markdownInlineToHtml('a <script> tag')).toBe('a &lt;script&gt; tag');
  });
});

describe('editorJsToMarkdown', () => {
  it('renders paragraphs, headers, and delimiters', () => {
    const data: EditorJsOutput = {
      blocks: [
        { type: 'header', data: { text: 'Title', level: 1 } },
        { type: 'paragraph', data: { text: 'hello <b>world</b>' } },
        { type: 'delimiter', data: {} },
        { type: 'paragraph', data: { text: 'second' } },
      ],
    };
    expect(editorJsToMarkdown(data)).toBe('# Title\n\nhello **world**\n\n---\n\nsecond\n');
  });

  it('renders unordered + ordered lists (with nesting)', () => {
    const data: EditorJsOutput = {
      blocks: [
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'a', items: [{ content: 'a1', items: [] }] },
              { content: 'b', items: [] },
            ],
          },
        },
        {
          type: 'list',
          data: { style: 'ordered', items: [{ content: 'one', items: [] }, { content: 'two', items: [] }] },
        },
      ],
    };
    expect(editorJsToMarkdown(data)).toBe('- a\n  - a1\n- b\n\n1. one\n2. two\n');
  });

  it('renders quote (with optional caption)', () => {
    expect(
      editorJsToMarkdown({
        blocks: [{ type: 'quote', data: { text: 'be the change', caption: 'Gandhi' } }],
      }),
    ).toBe('> be the change\n> — Gandhi\n');
  });

  it('renders code blocks unchanged', () => {
    expect(
      editorJsToMarkdown({ blocks: [{ type: 'code', data: { code: 'const a = 1;\nconst b = 2;' } }] }),
    ).toBe('```\nconst a = 1;\nconst b = 2;\n```\n');
  });

  it('renders images as standalone markdown', () => {
    expect(
      editorJsToMarkdown({
        blocks: [{ type: 'image', data: { file: { url: '/img/x.jpg' }, caption: 'alt' } }],
      }),
    ).toBe('![alt](/img/x.jpg)\n');
  });

  it('drops unknown block types silently', () => {
    expect(
      editorJsToMarkdown({
        blocks: [
          { type: 'paragraph', data: { text: 'keep' } },
          { type: 'attaches', data: { url: 'x' } },
        ],
      }),
    ).toBe('keep\n');
  });
});

describe('markdownToEditorJs', () => {
  it('parses headers / paragraphs / delimiter', () => {
    const out = markdownToEditorJs('# T\n\nhello **world**\n\n---\n\nsecond\n');
    expect(out.blocks.map((b) => b.type)).toEqual(['header', 'paragraph', 'delimiter', 'paragraph']);
    expect(out.blocks[0].data).toMatchObject({ text: 'T', level: 1 });
    expect(out.blocks[1].data).toMatchObject({ text: 'hello <b>world</b>' });
  });

  it('parses fenced code', () => {
    const out = markdownToEditorJs('```\nconst x = 1;\n```\n');
    expect(out.blocks).toEqual([{ type: 'code', data: { code: 'const x = 1;' } }]);
  });

  it('parses blockquote with caption', () => {
    const out = markdownToEditorJs('> wisdom here\n> — Author\n');
    expect(out.blocks[0].type).toBe('quote');
    expect(out.blocks[0].data).toMatchObject({ text: 'wisdom here', caption: 'Author' });
  });

  it('parses unordered + ordered + nested lists', () => {
    const out = markdownToEditorJs('- a\n  - a1\n- b\n');
    expect(out.blocks[0].type).toBe('list');
    const data = out.blocks[0].data as { style: string; items: Array<{ content: string; items: unknown[] }> };
    expect(data.style).toBe('unordered');
    expect(data.items).toHaveLength(2);
    expect(data.items[0].content).toBe('a');
    expect(data.items[0].items).toHaveLength(1);
  });

  it('parses standalone image as image block', () => {
    const out = markdownToEditorJs('![alt text](/img/x.jpg)\n');
    expect(out.blocks[0]).toMatchObject({
      type: 'image',
      data: { file: { url: '/img/x.jpg' }, caption: 'alt text' },
    });
  });
});

describe('round-trip', () => {
  it('paragraph + header + list + quote + image survives editor->md->editor', () => {
    const original =
      '# Title\n\nIntro paragraph with **bold** and *italic* and a [link](https://x.com).\n\n' +
      '## Section\n\n' +
      '- one\n- two\n  - two-a\n\n' +
      '> a quotation\n\n' +
      '![cap](/img/p.jpg)\n\n' +
      '```\ncode here\n```\n';
    const editorData = markdownToEditorJs(original);
    const back = editorJsToMarkdown(editorData);
    expect(back).toBe(original);
  });
});
