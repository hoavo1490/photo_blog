---
title: Post Typography Convergence
date: 2026-06-20
status: approved
---

# Post Typography Convergence

## Problem

Authored markdown renders on three surfaces — the Crepe editor, the in-form preview, and the published post/page — and each uses a different typographic system. Authors compose against one rhythm and readers see another. The published surface in particular has compounded paragraph spacing (`padding: .7em 0` *plus* `line-height: 2em`) that produces an "odd breakline" feel absent from the editor.

## Goal

One canonical typographic system for rendered markdown body content, applied identically to:

1. `<section class="post">` on the published Post page (`PostLayout.astro`)
2. `<section class="post">` on the published Page page (`PageLayout.astro`)
3. `.milkdown-host .ProseMirror` inside the post editor (`PostForm.astro`)
4. `.milkdown-host .ProseMirror` inside the page editor (`PageForm.astro`)
5. `.preview-area` in the post editor (`PostForm.astro`)

Header, footer, site nav, listings, post title chrome (`article .title h1`), meta line, divider, and global `body { font-size: 14px }` are **not** part of this convergence. They remain as-is.

## Non-goals

- No changes to markdown parsing (`marked`), the Crepe schema, the `image:<uuid>` token contract, or `sanitize-html` allowlist.
- No changes to the responsive width mixin `@mixin page` (300/350/400/750 breakpoints).
- No changes to lightbox, `data-pswp-src`, the responsive `<picture>` element, or LCP image emission.
- No changes to Crepe inline chrome hiding rules or the `.milkdown-image-block` centering overrides.
- No changes to the post title `article .title h1` (1.15em). The body-H1 / title-H1 asymmetry is intentional.

## Approach

Introduce a single SCSS mixin `post-typography` in a new partial `src/styles/_post-content.scss`. The mixin defines all rules for body text, paragraphs, headings, blockquotes, lists, and images. Three call sites `@use` the partial and `@include` the mixin under their respective scope selector.

This keeps one source of truth without forcing a shared class name onto Crepe's runtime-generated DOM, which Astro's scoped styles cannot reach without `:global()` anyway.

### Canonical values

```
font-size:       17px
line-height:     1.7
color:           inherits from context (var(--fg) in editor, default in published)

p                margin: 0 0 16px;        (no top/bottom padding)
h1               28px / 700 / margin: 28px 0 12px / letter-spacing: -0.015em
h2               22px / 700 / margin: 24px 0 10px / letter-spacing: -0.01em
h3               18px / 600 / margin: 20px 0 8px
blockquote       margin: 16px 0; padding: 2px 0 2px 18px;
                 border-left: 3px solid (muted); color: muted
                 (no background, no dashed border, no font-size reduction)
ul, ol           margin: 0 0 16px; padding-left: 24px;
li               margin: 4px 0; (no .2em padding)
img, picture     max-width: 100%; height: auto; display: block;
                 margin: 16px auto; (auto centers; no border-radius change)
```

### Call sites

```scss
// src/styles/global.scss
article .post { @include post-typography; }

// src/components/PostForm.astro (scoped style block)
.milkdown-host :global(.ProseMirror) { @include post-typography; }
.preview-area                         { @include post-typography; }

// src/components/PageForm.astro (scoped style block)
.milkdown-host :global(.ProseMirror) { @include post-typography; }
```

### Specificity / leakage

The global rule `article p { padding: .7em 0; }` (global.scss line 109) is the source of the compounding breakline. Approach: **delete that rule outright**. There is no remaining consumer of `article p` outside `.post` — the post title and meta sections do not contain `<p>` elements (`<section class="title"><h1>` and `<section class="meta"><span>...`). The mixin's `.post p` selector has the same specificity as `article p` but is strictly nested and wins for body content.

Similarly: the global `li { padding: .2em 0 }` is used by `.listing-item` styling but listings explicitly zero that out (`ul.listing li { padding: 0 }`). The mixin overrides it inside `.post` only.

The global `blockquote { background: #f8f8f8; padding: 0 1em; border: 1px dashed; font-size: 13px; line-height: 1.6 }` only fires inside published posts (no other surface uses raw blockquotes). The mixin's `.post blockquote` is more specific and replaces every property.

### Image rules

`PostLayout` published images get rewritten by `rewriteImageTokens` into `<picture>` elements with `data-pswp-src`. The existing global rule `article .post img[data-pswp-src] { cursor: zoom-in }` stays — the mixin does not touch `cursor`. Margins and max-width unify.

`PostForm` editor images live inside `.milkdown-image-block` and already have explicit centering/sizing rules (lines ~385–400). Those Crepe-specific overrides stay; they target `.milkdown-image-block`, not `img`, so they do not collide with the mixin's `img` rule.

`PostForm` preview area renders the same HTML as the published post (same `marked.parse` pipeline). The mixin handles both `img` and `picture`.

## Width

Editor and preview keep `max-width: 720px` (fixed). Published post keeps the responsive `@mixin page` (300/350/400/750). The 30px desktop delta is not a typography concern and is invisible at reading distances. Not changed.

## File-level changes

1. **New**: `src/styles/_post-content.scss` — defines `@mixin post-typography`.
2. **Modified**: `src/styles/global.scss`
   - `@use "post-content" as *;` at top
   - Delete `article p { padding: .7em 0; }` (line 109)
   - Add `article .post { @include post-typography; }` as a sibling rule inside the `article` block, placed **after** the existing `.post { img { ... } }` rule and the `.post img[data-pswp-src]` cursor rule so the mixin's `img` margins resolve in source order without overriding the lightbox cursor.
3. **Modified**: `src/components/PostForm.astro`
   - Replace the inline body/paragraph/heading/blockquote/list rules in the `.milkdown-host` and `.preview-area` blocks with `@include post-typography;` (under each scope selector). Keep the Crepe-specific image-block overrides, chrome-hiding rules, max-width, padding, and color tokens.
4. **Modified**: `src/components/PageForm.astro`
   - Same substitution as PostForm for `.milkdown-host`. (No preview area.)
5. **Untouched**: `src/layouts/PostLayout.astro`, `src/layouts/PageLayout.astro`, `BaseLayout.astro`, lightbox, sanitize-html, markdown pipeline.

## Testing

No existing visual/CSS test harness in `src/scripts/*.unit.test.ts` or `src/lib/*.unit.test.ts` covers rendered post styling. Per the user's constraint, do **not** add a visual test suite. Verification is manual + dev-server, per the steps below. Run existing `pnpm test` and `pnpm typecheck` to confirm no regressions in unit-tested code paths (markdown parsing, image resolution, sanitization).

## Manual verification

1. `pnpm dev`, open `/admin/new`.
2. Compose: 3 paragraphs + H2 + H3 + blockquote + bulleted list + ordered list + one image.
3. Toggle Preview — paragraph rhythm, heading sizes, blockquote bar, list indents, image margins must match the editor exactly.
4. Publish (or open the rendered route) — same rhythm must appear on the public post.
5. Repeat for a Page via `/admin/pages` round-trip.
6. Compare side-by-side: open the editor in one tab and the published post in another at the same viewport width. Body block heights and visual paragraph breaks should align.

## Rollback

If any surface looks broken, the mixin is the single place to revert. `git revert` on the convergence commit restores all three surfaces simultaneously.
