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
  /** Move focus into the editor. */
  focus(): void;
  /** Tear down listeners, DOM, etc. Idempotent. */
  destroy(): void;
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
      const md = `\n![${alt}](${url})\n`;
      textarea.value = textarea.value.slice(0, at) + md + textarea.value.slice(at);
      textarea.selectionStart = textarea.selectionEnd = at + md.length;
    },
    focus: () => textarea.focus(),
    destroy: () => { /* nothing to clean up on a bare textarea */ },
  };
}
