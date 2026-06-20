# Post Typography Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Crepe editor, the in-form Preview pane, and the published Post/Page surfaces render markdown body content with one identical typographic system, driven by a single SCSS mixin.

**Architecture:** Introduce one SCSS partial `src/styles/_post-content.scss` exporting `@mixin post-typography` with nested `&` selectors. Three consumers `@use` it: `global.scss` (under `article .post`), `PostForm.astro` (under `.milkdown-host :global(.ProseMirror)` and `.preview-area`), and `PageForm.astro` (under `.milkdown-host :global(.ProseMirror)`). Delete the two global rules that cause divergence (`article p { padding: .7em 0 }` and the inner `.post img { ... }` block). All other behavior — markdown emission, image tokens, sanitize allowlist, lightbox, `data-pswp-src`, responsive `<picture>`, Crepe chrome hiding, responsive page width, post-title sizing — stays intact.

**Tech Stack:** SCSS (Dart Sass via Astro/Vite), Astro scoped styles with `:global()`, Crepe (Milkdown) editor runtime, marked + sanitize-html on published path.

**Spec:** `docs/superpowers/specs/2026-06-20-post-typography-convergence-design.md`

**Note on TDD:** This is a CSS-only convergence task with no existing visual/CSS test suite. The spec explicitly forbids adding one. Tasks below verify via `pnpm typecheck`, `pnpm test` (unit tests, which cover markdown/sanitize/image-resolution logic that this plan does NOT touch — they must still pass), and manual dev-server verification per the spec. Per-task code blocks show exact final state.

---

## File Structure

**Created:**
- `src/styles/_post-content.scss` — single source of truth for rendered-markdown typography. One mixin, ~30 lines.

**Modified:**
- `src/styles/global.scss` — `@use` the new partial; delete `article p { padding: .7em 0 }` (line 109) and the inner `.post img { ... }` block (line 133); add `article .post { @include post-typography; }` inside the existing `article { ... }` block.
- `src/components/PostForm.astro` — replace the per-element typographic rules under `.milkdown-host :global(.ProseMirror)` (paragraph/h1-h3/blockquote/ul/ol/li) and `.preview-area` (h1-h3/p/blockquote and the img/picture margin rule) with `@include post-typography;`. Keep host-level rules (max-width, padding, font-size, line-height, color, overflow, outline, box-sizing), keep image-block + Crepe chrome rules, keep `.preview-placeholder`.
- `src/components/PageForm.astro` — same substitution under `.milkdown-host :global(.ProseMirror)`. No preview-area in this file.

**Untouched:**
- `src/layouts/PostLayout.astro`, `src/layouts/PageLayout.astro`, `src/layouts/BaseLayout.astro`
- `src/scripts/lightbox.ts`, `src/lib/sanitize-html.ts`, `src/lib/markdown.ts`, `src/lib/render.ts`
- All unit tests in `src/scripts/*.unit.test.ts` and `src/lib/*.unit.test.ts`
- `_vars.scss`, `_media-queries.scss`, `_cards.scss`, `_gallery.scss`, `_tags.scss`

---

## Task 1: Create the typography mixin partial

**Files:**
- Create: `src/styles/_post-content.scss`

- [ ] **Step 1: Create the partial with the mixin**

Write `src/styles/_post-content.scss` with this exact content:

```scss
// Canonical typographic system for rendered markdown body content.
//
// Consumed by three surfaces so authors and readers see the same
// rhythm: published Post/Page (`article .post`), the Crepe editor
// (`.milkdown-host .ProseMirror`), and the in-form Preview pane
// (`.preview-area`). Each consumer @includes this mixin under the
// scope selector that wraps their rendered content.
//
// Rules are emitted as nested `&` selectors. Specificity matters:
// when included at `article .post { @include post-typography; }`,
// the nested `& p` compiles to `article .post p` (0,2,1), which
// beats both the soon-deleted `article p` (0,1,1) and any bare
// global `p` rule (0,0,1). DO NOT change `&` to bare selectors --
// that would re-introduce the leakage problem this file exists to
// eliminate.
//
// `color` is left to the host scope: editor + preview set
// `color: var(--fg)` at their host selector; published inherits
// from `body { color: #555 }`. The mixin does not touch `color`.
//
// Out of scope (intentional drift between editor and published):
// links (`a`), inline `code`, `pre`, and `hr`. Convergence here
// would expand scope per the design doc.

@mixin post-typography {
  font-size: 17px;
  line-height: 1.7;

  & p { margin: 0 0 16px; }

  & h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 28px 0 12px;
    letter-spacing: -0.015em;
  }
  & h2 {
    font-size: 22px;
    font-weight: 700;
    margin: 24px 0 10px;
    letter-spacing: -0.01em;
  }
  & h3 {
    font-size: 18px;
    font-weight: 600;
    margin: 20px 0 8px;
  }

  & blockquote {
    margin: 16px 0;
    padding: 2px 0 2px 18px;
    border-left: 3px solid var(--border-strong, #d0d0d0);
    color: var(--muted, #767676);
    // Explicitly clear the global blockquote rule's properties so
    // the published surface doesn't carry over the dashed-box look.
    background: none;
    border-top: none;
    border-right: none;
    border-bottom: none;
    font-size: inherit;
  }

  & ul,
  & ol {
    margin: 0 0 16px;
    padding-left: 24px;
    list-style-position: outside;
  }
  & li { margin: 4px 0; padding: 0; }

  & img,
  & picture {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 16px auto;
  }
}
```

- [ ] **Step 2: Verify the partial parses**

Run: `pnpm typecheck`

Expected: no SCSS-related errors. (The partial isn't `@use`d yet so it won't affect output; this just confirms the file is syntactically valid SCSS and doesn't break Astro's pipeline. If `astro check` flags anything unrelated, that's not from this task.)

- [ ] **Step 3: Commit**

```bash
git add src/styles/_post-content.scss
git commit -m "feat(styles): add post-typography mixin partial"
```

---

## Task 2: Wire the mixin into the published surface

**Files:**
- Modify: `src/styles/global.scss`

This task does three things in one commit: imports the partial, deletes the two divergence-causing rules, and adds the mixin call. They're inseparable — deleting `article p { padding: .7em 0 }` without adding the mixin would visually regress the published post until later tasks land.

- [ ] **Step 1: Add the `@use` line at the top of `global.scss`**

The file currently starts with:

```scss
@use "vars" as *;
@use "media-queries" as *;
@use "cards";
@use "tags";
@use "gallery";
```

Add `@use "post-content" as *;` after the other `@use` lines so the mixin is in scope. After the edit those lines read:

```scss
@use "vars" as *;
@use "media-queries" as *;
@use "cards";
@use "tags";
@use "gallery";
@use "post-content" as *;
```

- [ ] **Step 2: Delete `article p { padding: .7em 0; }`**

Inside the `article { ... }` block in `global.scss`, this line currently exists (around line 109):

```scss
article {
  margin: 2em 0;
  p { padding: .7em 0; }
  .title {
```

Delete only the `p { padding: .7em 0; }` line. After the edit:

```scss
article {
  margin: 2em 0;
  .title {
```

- [ ] **Step 3: Delete the inner `.post img { ... }` block**

Inside the same `article { ... }` block, this rule currently exists (around line 133):

```scss
  .post { img { max-width: 100%; height: auto; display: block; margin: .5em auto; } }
  // Lightbox affordance: body images carry data-pswp-src when the
  // PhotoSwipe handler will open them in a lightbox. Show the
  // zoom-in cursor so users know the click does something.
  .post img[data-pswp-src] { cursor: zoom-in; }
```

Delete only the first line (`.post { img { ... } }`). **Keep** the comment and the `.post img[data-pswp-src] { cursor: zoom-in; }` line — they are out of scope for this convergence.

After the edit:

```scss
  // Lightbox affordance: body images carry data-pswp-src when the
  // PhotoSwipe handler will open them in a lightbox. Show the
  // zoom-in cursor so users know the click does something.
  .post img[data-pswp-src] { cursor: zoom-in; }
```

- [ ] **Step 4: Add `.post { @include post-typography; }` inside the `article` block**

Add this rule inside the existing `article { ... }` block, positioned after the `.meta { ... }` block and before the `.post img[data-pswp-src]` line (i.e. where the deleted `.post { img { ... } }` rule used to be):

```scss
  .post { @include post-typography; }
```

The relevant region of `article { ... }` now reads:

```scss
article {
  margin: 2em 0;
  .title {
    // ... unchanged ...
  }

  .meta {
    // ... unchanged ...
  }

  .post { @include post-typography; }
  // Lightbox affordance: body images carry data-pswp-src when the
  // PhotoSwipe handler will open them in a lightbox. Show the
  // zoom-in cursor so users know the click does something.
  .post img[data-pswp-src] { cursor: zoom-in; }

  .divider {
    // ... unchanged ...
  }
  // ... .divider:before/.after unchanged ...
}
```

Note: SCSS nesting means `article { .post { @include post-typography; } }` compiles to `article .post { ... }` and the inner `& p` from the mixin compiles to `article .post p`. This is the specificity guarantee the spec requires.

- [ ] **Step 5: Build + typecheck**

Run: `pnpm typecheck`

Expected: no errors.

Run: `pnpm build`

Expected: build succeeds. If SCSS fails to compile (e.g. partial name mismatch or unresolved mixin), the build will fail loudly with the file + line.

- [ ] **Step 6: Run unit tests**

Run: `pnpm test`

Expected: all existing tests pass. None of them depend on visual styling; they cover markdown parsing, image resolution, sanitization. A failure here means something unrelated regressed — investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/styles/global.scss
git commit -m "feat(styles): converge published post typography on shared mixin

Delete article p { padding: .7em 0 } and the inner .post img rule;
apply the shared post-typography mixin under article .post. Removes
the compounding paragraph-padding + line-height: 2em that produced
the 'odd breakline' rhythm on published posts."
```

---

## Task 3: Wire the mixin into the post editor and preview

**Files:**
- Modify: `src/components/PostForm.astro`

- [ ] **Step 1: Replace per-element rules under `.milkdown-host :global(.ProseMirror)`**

In `src/components/PostForm.astro`, the scoped `<style>` block currently has this run of rules (lines ~348–377):

```scss
  .milkdown-host :global(.ProseMirror) {
    max-width: 720px; margin: 0 auto;
    padding: 32px 20px 96px;
    min-height: 100%;
    outline: none;
    font-size: 17px;
    line-height: 1.7;
    color: var(--fg);
    box-sizing: border-box;
  }
  .milkdown-host :global(.ProseMirror p) { margin: 0 0 16px; }
  .milkdown-host :global(.ProseMirror h1) { font-size: 28px; font-weight: 700; margin: 28px 0 12px; letter-spacing: -0.015em; }
  .milkdown-host :global(.ProseMirror h2) { font-size: 22px; font-weight: 700; margin: 24px 0 10px; letter-spacing: -0.01em; }
  .milkdown-host :global(.ProseMirror h3) { font-size: 18px; font-weight: 600; margin: 20px 0 8px; }
  .milkdown-host :global(.ProseMirror blockquote) {
    margin: 16px 0; padding: 2px 0 2px 18px;
    border-left: 3px solid var(--border-strong);
    color: var(--muted);
  }
  .milkdown-host :global(.ProseMirror ul),
  .milkdown-host :global(.ProseMirror ol) {
    margin: 0 0 16px; padding-left: 24px;
  }
  .milkdown-host :global(.ProseMirror li) { margin: 4px 0; }
  .milkdown-host :global(.ProseMirror a) {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }
```

Replace it with:

```scss
  .milkdown-host :global(.ProseMirror) {
    max-width: 720px; margin: 0 auto;
    padding: 32px 20px 96px;
    min-height: 100%;
    outline: none;
    color: var(--fg);
    box-sizing: border-box;
    @include post-typography;
  }
  .milkdown-host :global(.ProseMirror a) {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }
```

Notes:
- `font-size: 17px` and `line-height: 1.7` are removed from the host rule because the mixin sets them.
- The `a { ... }` rule is **kept** because link styling is explicitly out of scope (per spec Non-goals).
- The mixin emits `& p`, `& h1`, `& h2`, `& h3`, `& blockquote`, `& ul`, `& ol`, `& li`, `& img`, `& picture` under the `.milkdown-host :global(.ProseMirror)` scope. Nested `&` inside an Astro scoped block + `:global()` parent is fully supported by Dart Sass — it compiles to `.milkdown-host :global(.ProseMirror) p` etc.

- [ ] **Step 2: Add the `@use` at the top of the `<style>` block**

Astro `<style lang="scss">` blocks accept `@use` at their top. Find the start of the `<style>` block in `PostForm.astro` and add the use directive at the very top (before any rules):

```scss
@use "../styles/post-content" as *;
```

If the file uses `<style>` (not `<style lang="scss">`), it must be `<style lang="scss">` for the mixin to work. Check the opening `<style ...>` tag — Astro's scoped style blocks default to CSS unless told otherwise. Adjust the tag if needed:

Before: `<style>`
After: `<style lang="scss">`

- [ ] **Step 3: Replace per-element rules in `.preview-area`**

The same scoped `<style>` block has this run (lines ~419–440):

```scss
  .preview-area {
    flex: 1;
    padding: 32px 20px 96px;
    max-width: 720px; margin: 0 auto; width: 100%;
    line-height: 1.7; font-size: 17px;
    color: var(--fg);
    overflow-y: auto;
  }
  .preview-area :global(picture),
  .preview-area :global(img) {
    max-width: 100%; height: auto; border-radius: 4px; display: block;
    margin: 16px auto;
  }
  .preview-area :global(h1) { font-size: 28px; font-weight: 700; margin: 28px 0 12px; letter-spacing: -0.015em; }
  .preview-area :global(h2) { font-size: 22px; font-weight: 700; margin: 24px 0 10px; letter-spacing: -0.01em; }
  .preview-area :global(h3) { font-size: 18px; font-weight: 600; margin: 20px 0 8px; }
  .preview-area :global(p)  { margin: 0 0 16px; }
  .preview-area :global(blockquote) {
    margin: 16px 0; padding: 2px 0 2px 18px;
    border-left: 3px solid var(--border-strong);
    color: var(--muted);
  }
  .preview-placeholder { color: var(--muted-2); font-size: 14px; }
```

Replace the entire `.preview-area { ... }` and the trailing per-element selectors (`picture`/`img`/`h1`/`h2`/`h3`/`p`/`blockquote`) with this single block, **but keep `.preview-placeholder`**:

```scss
  .preview-area {
    flex: 1;
    padding: 32px 20px 96px;
    max-width: 720px; margin: 0 auto; width: 100%;
    color: var(--fg);
    overflow-y: auto;
    @include post-typography;

    // The preview surface renders the same HTML pipeline as the
    // published post, including `marked.parse` -> sanitize. The
    // mixin's `& img`/`& picture` rule covers margins + max-width;
    // border-radius is a preview-only affordance (no equivalent on
    // published, which doesn't round images) and stays here.
    :global(picture),
    :global(img) {
      border-radius: 4px;
    }
  }
  .preview-placeholder { color: var(--muted-2); font-size: 14px; }
```

Notes:
- `font-size: 17px` and `line-height: 1.7` removed from `.preview-area` because the mixin sets them.
- `border-radius: 4px` on preview images is preserved as an editor-only affordance (published surface intentionally does not round images per current behavior).
- The mixin's nested `& img`/`& picture` and the separate `:global(picture)/:global(img) { border-radius: 4px }` rule combine via CSS cascade — the mixin provides margin/max-width/height/display, the inner rule adds the radius.

- [ ] **Step 4: Verify no other typographic rules remain**

Scan `PostForm.astro` for any remaining selectors targeting body typography inside `.milkdown-host` or `.preview-area` other than what the spec preserves:

- **Keep**: `.milkdown-host` host rule (flex/background/overflow), Crepe `.milkdown-image-block` overrides, Crepe chrome `display: none !important` block, `.milkdown-host :global(.ProseMirror a)` link rule, the `.preview-area :global(picture)/img { border-radius }` rule.
- **Should be removed by Steps 1 and 3**: `.ProseMirror p`, `.ProseMirror h1/h2/h3`, `.ProseMirror blockquote`, `.ProseMirror ul/ol/li`, `.preview-area :global(p/h1/h2/h3/blockquote/img/picture margin rule)`.

If anything in the second list still exists, delete it now. Do not delete anything in the first list.

- [ ] **Step 5: Build + typecheck**

Run: `pnpm typecheck`

Expected: no errors.

Run: `pnpm build`

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/PostForm.astro
git commit -m "feat(editor): converge post editor + preview on shared mixin

Replace duplicated per-element rules in PostForm with @include
post-typography. Editor, preview, and published post now share
one canonical typographic system. Link rule preserved out of scope."
```

---

## Task 4: Wire the mixin into the page editor

**Files:**
- Modify: `src/components/PageForm.astro`

- [ ] **Step 1: Add the `@use` at the top of the `<style>` block**

Same as Task 3 Step 2 but for `PageForm.astro`. At the top of the scoped `<style>` block (and confirm the tag is `<style lang="scss">`):

```scss
@use "../styles/post-content" as *;
```

- [ ] **Step 2: Replace per-element rules under `.milkdown-host :global(.ProseMirror)`**

In `PageForm.astro` the scoped `<style>` block currently has (lines ~105–123):

```scss
  .milkdown-host :global(.ProseMirror) {
    max-width: 720px; margin: 0 auto;
    padding: 32px 20px 96px;
    min-height: 100%;
    outline: none;
    font-size: 17px;
    line-height: 1.7;
    color: var(--fg);
    box-sizing: border-box;
  }
  .milkdown-host :global(.ProseMirror p) { margin: 0 0 16px; }
  .milkdown-host :global(.ProseMirror h1) { font-size: 28px; font-weight: 700; margin: 28px 0 12px; letter-spacing: -0.015em; }
  .milkdown-host :global(.ProseMirror h2) { font-size: 22px; font-weight: 700; margin: 24px 0 10px; }
  .milkdown-host :global(.ProseMirror h3) { font-size: 18px; font-weight: 600; margin: 20px 0 8px; }
  .milkdown-host :global(.ProseMirror a) {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
```

Replace it with:

```scss
  .milkdown-host :global(.ProseMirror) {
    max-width: 720px; margin: 0 auto;
    padding: 32px 20px 96px;
    min-height: 100%;
    outline: none;
    color: var(--fg);
    box-sizing: border-box;
    @include post-typography;
  }
  .milkdown-host :global(.ProseMirror a) {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
```

Notes:
- `font-size`/`line-height` come from the mixin now.
- The link rule is preserved (out of scope).
- This file did **not** previously define `blockquote`/`ul`/`ol`/`li` rules — that was a drift bug between PostForm and PageForm. After this change, the page editor inherits the same blockquote/list typography as the post editor via the mixin. This is intentional and fixes the cross-editor inconsistency.

- [ ] **Step 3: Verify no other typographic rules remain**

In `PageForm.astro`, after the edit, the **kept** items are: the `.milkdown-host` host rule (flex/background/overflow), the Crepe `.milkdown-image-block` overrides (note this file includes `border-radius: 4px` on the inner `img` — keep it), the chrome `display: none !important` block, and the `.ProseMirror a` link rule.

There should be no remaining `.ProseMirror p`, `.ProseMirror h1/h2/h3`, or any new `.ProseMirror blockquote/ul/ol/li` rules. If any exist, remove them.

- [ ] **Step 4: Build + typecheck**

Run: `pnpm typecheck`

Expected: no errors.

Run: `pnpm build`

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/PageForm.astro
git commit -m "feat(editor): converge page editor on shared typography mixin

Replace per-element rules in PageForm with @include post-typography.
Also fixes editor drift: page editor previously lacked blockquote
and list rules entirely; mixin restores parity with post editor."
```

---

## Task 5: Manual verification + final test pass

**Files:** none modified

This task verifies the convergence holds across all five surfaces. Per the spec, no visual test harness exists or is being added; verification is by running the app and checking visually.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: all unit tests pass. These cover markdown/sanitize/image-resolution code paths that were untouched.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: no errors.

- [ ] **Step 3: Start the dev server**

Run: `pnpm dev`

Expected: server starts, no SCSS or Astro errors in the terminal. Note the URL (typically `http://localhost:4321`).

- [ ] **Step 4: Verify the post editor + preview**

In a browser, navigate to `/admin/new`. Compose a post body containing all of the following:

- Three paragraphs of plain text
- One H2 heading
- One H3 heading
- One blockquote (single line is fine)
- One bulleted list (3 items)
- One ordered list (3 items)
- One inline image (upload via the editor's image flow)

Then toggle the Preview pane. Confirm:

- Paragraph rhythm is identical between editor and preview. No paragraph in the preview should be visibly taller or shorter than in the editor.
- H2 and H3 sizes match between editor and preview.
- Blockquote shows a left border (not a dashed box) in both editor and preview, with identical indentation.
- Bulleted and ordered lists have identical indentation and `li` spacing in both editor and preview.
- The image renders centered with the same vertical margin (16px) in both surfaces.

If any of these visibly differ between editor and preview, the bug is in PostForm. Re-check Task 3.

- [ ] **Step 5: Verify the published post**

Save and publish the post (or open the rendered route directly). Confirm the same visual checks pass on the public URL:

- Paragraph rhythm matches what you saw in the editor. No "odd breakline" / double-gap feel between paragraphs.
- H2/H3 sizes match the editor.
- Blockquote shows the left border (not the old dashed-box-with-background look).
- Lists indent the same.
- Body image margin is 16px top/bottom and the image is centered.
- Lightbox still works: clicking the image opens PhotoSwipe (cursor should be `zoom-in` on hover).
- The post title (above the body) is still the smaller `1.15em` font — it should NOT have changed size.

If the published post still shows a dashed-box blockquote or compounding paragraph gaps, the bug is in `global.scss`. Re-check Task 2.

- [ ] **Step 6: Verify a Page round-trip**

Navigate to the admin page editor (e.g. `/admin/pages/new` or whatever route `PageForm.astro` is wired to — check `src/pages/admin/pages/` if uncertain). Compose a page with the same content set as Step 4. Save + publish, then view the public page at its `/<slug>` URL.

Confirm: page editor, page published surface, and post editor all show identical typography for the same input.

- [ ] **Step 7: Check the LCP image / picture behavior is intact**

On a published post that contains an image (use a fresh one from Step 5 if needed), view the page source or DevTools and confirm:

- The first body image is wrapped in a `<picture>` with multiple `<source>` elements (the responsive `<picture>` is still being emitted).
- The first image carries `data-pswp-src` (lightbox affordance intact).
- The cursor changes to `zoom-in` on hover.

If any of these regressed, it would indicate accidental deletion of layout/sanitize logic — none of the tasks should have touched those paths, so this is a sanity check.

- [ ] **Step 8: Stop the dev server, run the full build once more**

Stop `pnpm dev` (Ctrl-C). Then:

Run: `pnpm build`

Expected: build completes successfully. This catches any production-only SCSS issue that the dev server might mask.

- [ ] **Step 9: Final commit (only if any cleanup needed)**

If Steps 4–7 surfaced no issues, no commit needed for this task — the verification work is non-code. If they did surface issues, fix them now and commit:

```bash
git add <files>
git commit -m "fix(styles): <specific issue> uncovered during convergence verification"
```

---

## Self-Review Summary (filled in by author)

**Spec coverage:**
- Goal items 1–5 (PostLayout `.post`, PageLayout `.post`, PostForm ProseMirror, PageForm ProseMirror, PostForm preview-area) — covered by Tasks 2, 3, 4.
- Non-goals — none touched by any task; explicit reminders inline (lightbox cursor preserved in Task 2 Step 3; `.preview-placeholder` and `.milkdown-image-block` preserved in Task 3 Step 4 and Task 4 Step 3; link rule preserved in Tasks 3 & 4).
- Canonical values — encoded verbatim in the mixin (Task 1).
- Specificity / nested-`&` requirement — Task 1 emits with `&`; consumers nest via Astro scoped + `:global()` nesting.
- Width — unchanged (tasks do not touch `@mixin page` or the `max-width: 720px` rules).
- Rollback — single mixin file is the single revert point.

**Placeholder scan:** Steps either contain full code blocks or specify exact files + commands. No "TODO", no "implement later", no "similar to Task N" shorthand.

**Type consistency:** Mixin name `post-typography` used consistently across Tasks 1–4. Partial path `../styles/post-content` used consistently in Tasks 3 and 4. Selector forms (`article .post`, `.milkdown-host :global(.ProseMirror)`, `.preview-area`) consistent with spec call-site list.
