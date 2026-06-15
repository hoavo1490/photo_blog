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

export async function mountMilkdownEditor(
  root: HTMLElement,
  initial: string,
  onChange?: (md: string) => void,
): Promise<BodyEditor> {
  const crepe = new Crepe({
    root,
    defaultValue: initial,
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
    focus: () => {
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
    },
    destroy: () => crepe.destroy(),
  };
}
