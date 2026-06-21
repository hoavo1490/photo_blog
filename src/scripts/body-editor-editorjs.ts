// Editor.js implementation of the BodyEditor contract. Loaded only by
// the admin editor pages; tree-shaken out of public bundles.
//
// Editor.js stores content as block JSON, but our public pipeline
// (preview, RSS, render) is markdown end-to-end. So this module hides
// the JSON behind the BodyEditor contract:
//   * mount with initial markdown -> markdownToEditorJs -> Editor.js
//   * on every change emit `editor.save() -> editorJsToMarkdown -> onChange`
//   * the host (PostForm/PageForm) keeps treating the body as markdown.
//
// Inline formatting commands (bold/italic/link) are wired to Editor.js's
// InlineToolbar API via document.execCommand on the selection so the
// host's existing bottom toolbar keeps working without per-block tool
// awareness.

import EditorJS from '@editorjs/editorjs';
import type { OutputData } from '@editorjs/editorjs';
import Header from '@editorjs/header';
import List from '@editorjs/list';
import Quote from '@editorjs/quote';
import Code from '@editorjs/code';
import Delimiter from '@editorjs/delimiter';
import ImageTool from '@editorjs/image';
import InlineCode from '@editorjs/inline-code';

import type { BodyEditor } from './body-editor';
import { editorJsToMarkdown, markdownToEditorJs } from './editorjs-markdown';
import type { UploadResult } from './crepe-upload';

export interface MountEditorJsOptions {
  /** Upload a File to R2; returns the resolved {id, url} (or null). */
  uploadImage?: (file: File) => Promise<UploadResult | null>;
  /** Side-effect fired whenever uploadImage succeeds. The host registers
   *  the new {id, url} in its image map so save-time token-collapse
   *  picks up the new image. */
  onImageUploaded?: (entry: UploadResult) => void;
}

export async function mountEditorJsEditor(
  root: HTMLElement,
  initial: string,
  onChange?: (md: string) => void,
  options: MountEditorJsOptions = {},
): Promise<BodyEditor> {
  // Give Editor.js a holder it owns so we can tear it down cleanly. The
  // caller's `root` may be wrapping styles we don't want to wipe.
  const holder = document.createElement('div');
  holder.className = 'editorjs-holder';
  root.appendChild(holder);

  const initialData = markdownToEditorJs(initial);

  // Image upload integration. Editor.js's image plugin supports either
  // a backend endpoint OR a custom uploader. We want our existing
  // compress + R2 pipeline, so we use uploader.uploadByFile.
  const imageUploader = options.uploadImage
    ? {
        uploader: {
          async uploadByFile(file: File) {
            const r = await options.uploadImage!(file);
            if (!r) return { success: 0 };
            options.onImageUploaded?.(r);
            return {
              success: 1,
              file: { url: r.editorUrl ?? r.url },
            };
          },
          async uploadByUrl(url: string) {
            // External URLs pass through unchanged (no upload).
            return { success: 1, file: { url } };
          },
        },
      }
    : {};

  let editor: EditorJS;
  // Cached latest markdown — kept fresh by fireChange so the
  // synchronous getMarkdown() in our BodyEditor contract has something
  // to return without awaiting Editor.js's async save().
  let latestMarkdown = initial;

  const fireChange = async () => {
    try {
      const data: OutputData = await editor.save();
      latestMarkdown = editorJsToMarkdown(data as unknown as Parameters<typeof editorJsToMarkdown>[0]);
      onChange?.(latestMarkdown);
    } catch {
      // ignore save races during teardown / rapid edits
    }
  };

  editor = new EditorJS({
    holder,
    data: initialData as unknown as OutputData,
    minHeight: 0,
    placeholder: 'write here…',
    tools: {
      header: { class: Header as unknown as never, inlineToolbar: true, config: { levels: [1, 2, 3], defaultLevel: 2 } },
      list: { class: List as unknown as never, inlineToolbar: true },
      quote: { class: Quote as unknown as never, inlineToolbar: true },
      code: Code as unknown as never,
      delimiter: Delimiter as unknown as never,
      inlineCode: { class: InlineCode as unknown as never },
      image: { class: ImageTool as unknown as never, config: imageUploader },
    },
    onChange: () => { void fireChange(); },
  });

  await editor.isReady;

  return {
    getMarkdown: () => latestMarkdown,
    setMarkdown: (md: string) => {
      const data = markdownToEditorJs(md);
      void editor.render(data as unknown as OutputData);
    },
    insertAtCursor: (text: string) => {
      // Insert as plain text at the current block's text. Editor.js
      // doesn't have a public "insert at cursor" API; we use execCommand
      // which works while the contenteditable holds focus.
      document.execCommand('insertText', false, text);
      void fireChange();
    },
    insertImageBlock: (url: string, alt = '') => {
      const index = (editor.blocks.getCurrentBlockIndex?.() ?? -1) + 1;
      editor.blocks.insert(
        'image',
        { file: { url }, caption: alt, withBorder: false, stretched: false, withBackground: false },
        undefined,
        index >= 0 ? index : undefined,
      );
      void fireChange();
    },
    toggleBold: () => {
      document.execCommand('bold');
      void fireChange();
    },
    toggleItalic: () => {
      document.execCommand('italic');
      void fireChange();
    },
    toggleBlockquote: () => {
      // Convert current block to a quote. Falls back to a no-op if the
      // current block can't be converted (Editor.js will reject and the
      // editor stays in its previous state).
      const idx = editor.blocks.getCurrentBlockIndex();
      if (idx < 0) return;
      const current = editor.blocks.getBlockByIndex(idx);
      if (!current) return;
      editor.blocks.convert(current.id, 'quote');
      void fireChange();
    },
    toggleBulletList: () => {
      const idx = editor.blocks.getCurrentBlockIndex();
      if (idx < 0) return;
      const current = editor.blocks.getBlockByIndex(idx);
      if (!current) return;
      editor.blocks.convert(current.id, 'list');
      void fireChange();
    },
    insertLink: (url: string) => {
      // Wrap the current selection (or insert the URL if empty) with an
      // anchor. We avoid execCommand('createLink') because it doesn't
      // play nicely with no-selection inserts.
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (range.collapsed) {
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url;
        range.insertNode(a);
        range.setStartAfter(a);
        range.setEndAfter(a);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.appendChild(range.extractContents());
        range.insertNode(a);
      }
      void fireChange();
    },
    focus: () => {
      editor.focus();
    },
    destroy: () => {
      try { editor.destroy(); } catch { /* idempotent */ }
      if (holder.parentNode) holder.parentNode.removeChild(holder);
    },
  };
}
