// Body editor interface. The PostForm and its toolbar code talk to
// this contract -- it doesn't care whether the implementation underneath
// is a plain <textarea> or a WYSIWYG-markdown editor like Milkdown.
//
// Implementations:
//   * mountTextareaEditor  -- back-compat fallback / test mock.
//   * mountMilkdownEditor  -- real WYSIWYG-markdown via @milkdown/crepe.

export interface BodyEditor {
  /** Returns the current content as raw markdown. */
  getMarkdown(): string;
  /** Replaces the current content with the given markdown. */
  setMarkdown(md: string): void;
  /** Inserts `text` at the current cursor position (or appends if no
   *  cursor is tracked). Used by the photo-upload toolbar button to
   *  drop `![alt](image:<uuid>)` next to where the user was typing. */
  insertAtCursor(text: string): void;
  /** Insert a proper image block at the cursor. WYSIWYG implementations
   *  create the editor's native image node so it renders inline
   *  immediately; the textarea fallback just appends the markdown
   *  source. The URL should be the already-resolved /img/<key>...
   *  preview the editor will render. */
  insertImageBlock(url: string, alt?: string): void;
  // ─── formatting commands wired to the bottom toolbar ──────────────────
  /** Wrap the selection in `**…**` (or insert an empty pair). */
  toggleBold(): void;
  /** Wrap the selection in `_…_`. */
  toggleItalic(): void;
  /** Prefix the selected lines (or the current line) with `> `. */
  toggleBlockquote(): void;
  /** Prefix the selected lines (or the current line) with `- `. */
  toggleBulletList(): void;
  /** Wrap the selection with `[text](url)`. Empty selection -> empty
   *  `[](url)` with the cursor placed inside the brackets. */
  insertLink(url: string): void;
  /** Move focus into the editor. */
  focus(): void;
  /** Tear down listeners, DOM, etc. Idempotent. */
  destroy(): void;
}

function wrapSelection(textarea: HTMLTextAreaElement, prefix: string, suffix: string): void {
  const from = textarea.selectionStart ?? textarea.value.length;
  const to = textarea.selectionEnd ?? from;
  const before = textarea.value.slice(0, from);
  const middle = textarea.value.slice(from, to);
  const after = textarea.value.slice(to);
  textarea.value = before + prefix + middle + suffix + after;
  if (from === to) {
    // Place the cursor between prefix and suffix so the next keystroke
    // is captured inside the wrap.
    textarea.selectionStart = textarea.selectionEnd = from + prefix.length;
  } else {
    textarea.selectionStart = from + prefix.length;
    textarea.selectionEnd = to + prefix.length;
  }
}

function prefixLines(textarea: HTMLTextAreaElement, prefix: string): void {
  const from = textarea.selectionStart ?? textarea.value.length;
  const to = textarea.selectionEnd ?? from;
  // Expand to whole-line boundaries: jump backward to the previous
  // newline (or start of doc), forward to the next newline (or EOF).
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = (() => {
    const idx = value.indexOf('\n', to);
    return idx === -1 ? value.length : idx;
  })();
  const head = value.slice(0, lineStart);
  const block = value.slice(lineStart, lineEnd);
  const tail = value.slice(lineEnd);
  const transformed = block.split('\n').map((line) => prefix + line).join('\n');
  textarea.value = head + transformed + tail;
  // Push the selection over so it still covers the same logical lines.
  const addedToHead = 0;
  const addedToBlock = transformed.length - block.length;
  textarea.selectionStart = from + prefix.length + addedToHead;
  textarea.selectionEnd = to + addedToBlock;
}

/** Backs the BodyEditor interface with a plain <textarea>. Used for the
 *  pre-Milkdown world AND as a deterministic implementation we can
 *  unit-test the toolbar's contract against. */
export function mountTextareaEditor(textarea: HTMLTextAreaElement, initial: string): BodyEditor {
  textarea.value = initial;
  return {
    getMarkdown: () => textarea.value,
    setMarkdown: (md: string) => { textarea.value = md; },
    insertAtCursor: (text: string) => {
      const at = textarea.selectionStart ?? textarea.value.length;
      textarea.value = textarea.value.slice(0, at) + text + textarea.value.slice(at);
      textarea.selectionStart = textarea.selectionEnd = at + text.length;
    },
    insertImageBlock: (url: string, alt = '') => {
      const at = textarea.selectionStart ?? textarea.value.length;
      // Two trailing newlines leave a blank line below the image so the
      // user lands on an empty paragraph and can keep typing right away
      // -- mirroring the empty-block affordance the Milkdown impl
      // maintains after an image-block insert.
      const md = `\n![${alt}](${url})\n\n`;
      textarea.value = textarea.value.slice(0, at) + md + textarea.value.slice(at);
      textarea.selectionStart = textarea.selectionEnd = at + md.length;
    },
    toggleBold: () => wrapSelection(textarea, '**', '**'),
    toggleItalic: () => wrapSelection(textarea, '_', '_'),
    toggleBlockquote: () => prefixLines(textarea, '> '),
    toggleBulletList: () => prefixLines(textarea, '- '),
    insertLink: (url: string) => wrapSelection(textarea, '[', `](${url})`),
    focus: () => textarea.focus(),
    destroy: () => { /* nothing to clean up on a bare textarea */ },
  };
}
