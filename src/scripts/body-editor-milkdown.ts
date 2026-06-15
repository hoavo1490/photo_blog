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
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

import type { BodyEditor } from './body-editor';
import { createCrepeUploadHandler, type UploadResult } from './crepe-upload';

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
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const schema: Schema = view.state.schema;
        // Crepe's image-block component registers a node named
        // `image-block`. Fall back to the plain `image` node if that's
        // not in the schema (e.g. if someone disabled the feature).
        const imageBlockType = schema.nodes['image-block'] ?? schema.nodes.image;
        if (!imageBlockType) return;
        const node = imageBlockType.create({ src: url, alt });
        const tr = view.state.tr.replaceSelectionWith(node);
        view.dispatch(tr);
        view.focus();
      });
    },
    focus: () => {
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
    },
    destroy: () => crepe.destroy(),
  };
}
