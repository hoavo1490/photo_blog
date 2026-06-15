// Milkdown Crepe implementation of the BodyEditor interface. Loaded
// only by the admin editor page; tree-shaken out of public bundles.
//
// Crepe is Milkdown's batteries-included flavor: commonmark preset,
// inline toolbar, slash menu, drag-handle, code-syntax, etc. Outputs
// real markdown via its getMarkdown() API, so our save / preview /
// RSS pipelines stay unchanged.

import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/core';
import { Schema } from '@milkdown/prose/model';
import { TextSelection } from '@milkdown/prose/state';
import { toggleMark, wrapIn } from '@milkdown/prose/commands';
import { wrapInList } from '@milkdown/prose/schema-list';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

import type { BodyEditor } from './body-editor';
import { createCrepeUploadHandler, type UploadResult } from './crepe-upload';

/** Walks the doc; if the last top-level block isn't an empty paragraph,
 *  appends one. Used after mount and after image insertion so the user
 *  always has a place to keep typing below the last block. */
function ensureTrailingEmptyParagraph(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return;
    const last = state.doc.lastChild;
    const hasTrailing =
      last?.type.name === 'paragraph' && last.content.size === 0;
    if (hasTrailing) return;
    const tr = state.tr.insert(state.doc.content.size, paragraphType.create());
    view.dispatch(tr);
  });
}

export interface MountMilkdownOptions {
  /** Compress + upload a File to our R2 backend. Called by Crepe when
   *  the user picks "Image" from the slash menu, drops an image into
   *  the editor, or pastes one from the clipboard. Returns the
   *  resolved {id, url} (or null on failure). */
  uploadImage?: (file: File) => Promise<UploadResult | null>;
  /** Side-effect fired whenever uploadImage succeeds. The host (the
   *  PostForm) uses this to register the new {id, url} in its image
   *  map so save-time token-collapse picks up the new image. */
  onImageUploaded?: (entry: UploadResult) => void;
}

export async function mountMilkdownEditor(
  root: HTMLElement,
  initial: string,
  onChange?: (md: string) => void,
  options: MountMilkdownOptions = {},
): Promise<BodyEditor> {
  // Wire Crepe's ImageBlock feature to our upload pipeline. The
  // feature handles slash-menu "Image", drag-drop, and clipboard
  // paste -- all funnel through onUpload(file) -> Promise<string>.
  const featureConfigs = options.uploadImage
    ? {
        [Crepe.Feature.ImageBlock]: {
          onUpload: createCrepeUploadHandler(options.uploadImage, options.onImageUploaded),
        },
      }
    : undefined;

  const crepe = new Crepe({
    root,
    defaultValue: initial,
    featureConfigs,
  });
  await crepe.create();

  // Guarantee the doc ends with an empty paragraph so there's always a
  // landing place below the last block (especially after an image-block,
  // which is a leaf node -- without a trailing paragraph the user can't
  // easily click below it to keep typing). Idempotent: a no-op if the
  // last node is already an empty paragraph.
  ensureTrailingEmptyParagraph(crepe);

  if (onChange) {
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => onChange(markdown));
    });
  }

  return {
    getMarkdown: () => crepe.getMarkdown(),
    setMarkdown: (md: string) => {
      // Crepe doesn't expose a public setMarkdown(). Tear down and remount
      // when the caller needs to swap content wholesale (rare).
      crepe.destroy();
      // Recursive remount; not common path so the overhead is acceptable.
      mountMilkdownEditor(root, md, onChange).catch(() => { /* noop */ });
    },
    insertAtCursor: (text: string) => {
      // Insert as plain text at the cursor inside Milkdown via the
      // underlying ProseMirror editor.
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;
        const { from, to } = state.selection;
        // Use the schema's text node creator -- inserting plain text
        // here means markdown-as-typed; tokens like `image:<uuid>`
        // round-trip via Crepe's CommonMark parser on next get/set.
        // For richer insertion (e.g. converting the markdown to nodes),
        // we'd parse via the markdown plugin's parseState here.
        const schema: Schema = state.schema;
        const tr = state.tr.replaceWith(from, to, schema.text(text));
        tr.setSelection(TextSelection.create(tr.doc, from + text.length));
        dispatch(tr);
        view.focus();
      });
    },
    insertImageBlock: (url: string, alt = '') => {
      // Insert a real image-block ProseMirror node so Crepe renders it
      // immediately as an inline image -- not as raw markdown text
      // that the user would then have to nudge through an input rule.
      // After insertion, ensure an empty paragraph follows the image
      // and the cursor lands inside it -- otherwise the user has no
      // obvious place to keep typing when the image is the last block.
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        const schema: Schema = state.schema;
        // Crepe's image-block component registers a node named
        // `image-block`. Fall back to the plain `image` node if that's
        // not in the schema (e.g. if someone disabled the feature).
        const imageBlockType = schema.nodes['image-block'] ?? schema.nodes.image;
        if (!imageBlockType) return;
        const paragraphType = schema.nodes.paragraph;
        const imageNode = imageBlockType.create({ src: url, alt });
        let tr = state.tr.replaceSelectionWith(imageNode);
        if (paragraphType) {
          // After replaceSelectionWith on a block node, tr.selection
          // points just after the inserted node. If the next node isn't
          // already an empty paragraph, insert one and move the cursor
          // into it.
          const afterImg = tr.selection.to;
          const next = tr.doc.resolve(afterImg).nodeAfter;
          const hasEmptyParaAfter =
            next?.type.name === 'paragraph' && next.content.size === 0;
          if (!hasEmptyParaAfter) {
            tr = tr.insert(afterImg, paragraphType.create());
          }
          tr = tr.setSelection(TextSelection.create(tr.doc, afterImg + 1));
        }
        view.dispatch(tr);
        view.focus();
      });
    },
    toggleBold: () => {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const mark = view.state.schema.marks.strong;
        if (!mark) return;
        toggleMark(mark)(view.state, view.dispatch);
        view.focus();
      });
    },
    toggleItalic: () => {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const mark = view.state.schema.marks.em;
        if (!mark) return;
        toggleMark(mark)(view.state, view.dispatch);
        view.focus();
      });
    },
    toggleBlockquote: () => {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const node = view.state.schema.nodes.blockquote;
        if (!node) return;
        wrapIn(node)(view.state, view.dispatch);
        view.focus();
      });
    },
    toggleBulletList: () => {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const node = view.state.schema.nodes.bullet_list;
        if (!node) return;
        wrapInList(node)(view.state, view.dispatch);
        view.focus();
      });
    },
    insertLink: (url: string) => {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const mark = view.state.schema.marks.link;
        if (!mark) return;
        // Attach the URL via mark attrs. If the selection is empty,
        // first insert the URL itself as the link text so there's
        // something to mark and click.
        const { from, to } = view.state.selection;
        if (from === to) {
          const tr = view.state.tr.insertText(url, from);
          tr.addMark(from, from + url.length, mark.create({ href: url }));
          tr.setSelection(TextSelection.create(tr.doc, from + url.length));
          view.dispatch(tr);
        } else {
          toggleMark(mark, { href: url })(view.state, view.dispatch);
        }
        view.focus();
      });
    },
    focus: () => {
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
    },
    destroy: () => crepe.destroy(),
  };
}
