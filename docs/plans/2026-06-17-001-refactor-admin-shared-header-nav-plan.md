---
title: "refactor: Admin shared header with nav tabs and consistent toolbar icons"
type: refactor
status: active
date: 2026-06-17
---

# refactor: Admin shared header with nav tabs and consistent toolbar icons

## Overview

Replace the per-page admin chrome with a single shared two-row header used by all three dashboard screens (posts, albums, about). Add a tab bar so the user can navigate between sections without relying on ad-hoc back-links. Fix the formatting toolbar to use an outline SVG icon for the image button (matching bold/italic/quote/list/link) and add a visible label/tooltip to the preview button.

---

## Problem Frame

The admin currently has:
- A plain `AdminLayout` that renders a one-row header (title + user) on list/form pages, but is hidden (`bare=true`) inside editors
- No persistent tab navigation — moving between posts, albums, and about requires remembering URLs or clicking scattered back-links
- A formatting toolbar where the image button uses an emoji (`🖼`) while all other buttons use styled text or emoji that are more consistent — the emoji breaks the visual rhythm
- A preview button (`👁`) with no visible label, making its purpose opaque to new users

The goal is one shared header component that all three dashboard screens (`/admin`, `/admin/gallery`, `/admin/about`) mount via `AdminLayout`, providing both identity and navigation at a glance.

---

## Requirements Trace

- R1. Header row 1: "hoavv editor" identity on left, `{session.githubLogin} · sign out` on right
- R2. Header row 2: tab bar (posts / albums / about) on left, active tab highlighted with dark color + solid underline, inactive tabs muted; row separated from row 1 by a thin divider
- R3. Header row 2 right side: primary action button whose label is "+ new post" on posts, "+ new album" on albums, hidden on about
- R4. The header is defined once (in `AdminLayout` or a dedicated component) — dashboard pages pass only the active tab and action handler
- R5. Image toolbar button replaced with an outline SVG icon from the same visual family as the other buttons
- R6. Preview toolbar button gains a visible label or `title` tooltip so its purpose is clear

---

## Scope Boundaries

- Does not touch post/page/album editors (`PostForm`, `PageForm`, `AlbumForm`) except to update the toolbar buttons (R5, R6)
- Does not change any API routes or data fetching
- Does not change the `bare` editor mode (editors keep their own full-screen chrome)
- No changes to public-facing pages or `BaseLayout`
- No changes to the about editor itself — only the dashboard index pages use the shared header

---

## Context & Research

### Relevant Code and Patterns

- `src/layouts/AdminLayout.astro` — current layout with `.app-header`, CSS vars (--border, --fg, --muted, --accent, --accent-fg). The `bare` prop already hides the header for full-screen editors. Tab nav will extend the non-bare header.
- `src/pages/admin/index.astro` — posts dashboard; currently renders its own "+ new" and "Edit about" buttons inline
- `src/pages/admin/gallery/index.astro` — albums dashboard; currently renders its own "+ new album" and "← Posts" links
- `src/pages/admin/about.astro` — about page editor; opens `PageForm` inside a bare layout (no dashboard view)
- `src/components/PostForm.astro` lines 133–145 — toolbar with emoji image `🖼` and emoji preview `👁`
- `src/components/PageForm.astro` lines 37–48 — same toolbar pattern, also missing preview button

### External References

- SVG icon for image: a simple outline frame/image icon (rectangle + mountain + sun) — consistent with `<strong>B</strong>` and `<em>I</em>` text-mark style; can be an inline `<svg>` or background icon. The link emoji for "link" (`🔗`) is already an emoji but at small sizes in a button context an inline SVG is more reliable cross-platform.

---

## Key Technical Decisions

- **Where the nav lives:** Extend `AdminLayout.astro` — add `activeTab` and `actionHref`/`actionLabel` props. All three dashboard pages pass them; editors continue using `bare=true`. This avoids a new file while keeping the layout as the single source of truth for admin chrome.
- **Tab activation pattern:** Pass `activeTab: 'posts' | 'albums' | 'about'` as a prop; the layout renders class differences (`active` / inactive) server-side. No JS needed.
- **Action button visibility:** Pass `actionHref` and `actionLabel` as optional props; the layout renders the button only when both are provided. About dashboard passes neither.
- **Toolbar icons:** Use inline SVG for image button. The other "buttons" (`❝`, `•`, `🔗`) are already in the same zone visually — keeping them as-is is acceptable, but the `🖼` emoji stands out on some platforms. Replace with a consistent inline SVG. Preview gets a text label "Preview" alongside the eye icon, or a `title` attribute update, plus `aria-label`.
- **About "dashboard":** `/admin/about` currently opens `PageForm` directly (no list view). The tab links to `/admin/about`, which continues to open the editor. The shared header's "about" tab simply navigates to that URL.

---

## Implementation Units

- [x] U1. **Extend `AdminLayout` with two-row header (identity + nav tabs + action button)**

**Goal:** Replace the single-row `.app-header` with a two-row structure. Row 1: identity. Row 2: tabs + action button. The row 2 divider separates the two rows.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `src/layouts/AdminLayout.astro`

**Approach:**
- Add props: `activeTab?: 'posts' | 'albums' | 'about'`, `actionHref?: string`, `actionLabel?: string`
- Row 1 (`.app-header-identity`): identical to current `.app-header` — "hoavv editor" h1 on left, `{session.githubLogin} · sign out` on right
- Row 2 (`.app-header-nav`): flex row with `justify-content: space-between`; left side is three `<a>` tab links; right side is conditional action `<a role="button">`. A `border-bottom: 1px solid var(--border)` on `.app-header-nav` provides the row divider
- Active tab style: `color: var(--fg); font-weight: 600; border-bottom: 2px solid var(--fg); margin-bottom: -1px` (sits flush against the row's bottom border)
- Inactive tab style: `color: var(--muted)`
- Action button: `class="primary"` inline anchor styled as existing "+ new" buttons
- When `activeTab` is not provided (non-dashboard pages using `bare=false`), fall back to current single-row behavior (or render row 2 without active state)
- Wrap both rows in a single sticky `<header>` with `position: sticky; top: 0; z-index: 10; background: var(--bg-elev); border-bottom: 1px solid var(--border)`

**Patterns to follow:**
- Existing `.app-header` CSS in `AdminLayout.astro`
- Inline style or scoped `<style>` — layout already uses both; prefer `<style is:global>` for the new classes to stay consistent with existing pattern

**Test scenarios:**
- Test expectation: none — purely static server-rendered HTML, no behavioral logic

**Verification:**
- `AdminLayout` renders a two-row header when `activeTab` is supplied
- Row 2 shows the active tab with dark text + underline; other tabs are muted
- Action button appears when `actionHref` + `actionLabel` are supplied; absent otherwise
- `bare=true` still suppresses both rows (editors unaffected)

---

- [x] U2. **Update posts dashboard to use shared header**

**Goal:** Remove the inline "+ new" / "Edit about" controls from `/admin/index.astro` and pass `activeTab="posts"` with the new-post action to `AdminLayout`.

**Requirements:** R2, R3, R4

**Dependencies:** U1

**Files:**
- Modify: `src/pages/admin/index.astro`

**Approach:**
- Pass `activeTab="posts"` `actionHref="/admin/new"` `actionLabel="+ new post"` to `<AdminLayout>`
- Remove the inline action row (the `<div style="display: flex; align-items: center; justify-content: space-between; ...">` that holds the "Edit about" and "+ new" buttons)
- Keep the posts count `<h2>` or move it inside the list header if desired; the "+ new" and "Edit about" are now handled by the shared header

**Patterns to follow:**
- Current `AdminLayout` prop usage in `src/pages/admin/index.astro`

**Test scenarios:**
- Test expectation: none — server-rendered, no logic changes

**Verification:**
- Posts dashboard shows shared header with "posts" tab active
- "+ new post" action button renders in row 2 right
- "Edit about" is accessible via the "about" tab in the nav (no separate button needed)
- Existing post list renders correctly below the header

---

- [x] U3. **Update albums dashboard to use shared header**

**Goal:** Remove inline back-link and "+ new album" from `/admin/gallery/index.astro`; pass `activeTab="albums"` with new-album action.

**Requirements:** R2, R3, R4

**Dependencies:** U1

**Files:**
- Modify: `src/pages/admin/gallery/index.astro`

**Approach:**
- Pass `activeTab="albums"` `actionHref="/admin/gallery/new"` `actionLabel="+ new album"` to `<AdminLayout>`
- Remove the existing inline action row (the "← Posts" back-link and "+ new album" button)
- Albums list content remains unchanged below the header

**Patterns to follow:**
- Same as U2

**Test scenarios:**
- Test expectation: none — server-rendered

**Verification:**
- Albums dashboard shows shared header with "albums" tab active
- "+ new album" action button in row 2 right
- "posts" and "about" tabs navigate correctly

---

- [x] U4. **Update about page to use shared header (no action button)**

**Goal:** Make `/admin/about.astro` participate in the shared header with the "about" tab active and no action button.

**Requirements:** R2, R3, R4

**Dependencies:** U1

**Files:**
- Modify: `src/pages/admin/about.astro`

**Approach:**
- `/admin/about.astro` currently uses `bare=true` because it renders `PageForm` which ships its own header
- Two options: (a) keep `bare=true` for the full editor and accept that the about tab navigates straight to the full-screen editor without a dashboard-style list header, or (b) add a thin wrapper around `PageForm` that is not bare
- **Decision:** Keep `bare=true` — the about editor is already full-screen and adding a second sticky header above `PageForm`'s own header would be redundant. The "about" tab in the nav should link to `/admin/about`; the active-tab highlight still appears because the tab link resolves to the current URL, but the two-row header itself is not rendered (bare mode). This is acceptable since about has no list view.
- No changes needed to `about.astro` itself; the tab link in `AdminLayout` points to `/admin/about` and the active state relies on URL matching

**Test scenarios:**
- Test expectation: none

**Verification:**
- Navigating to `/admin/about` via the "about" tab works
- About editor renders as full-screen (unaffected by layout changes)
- Posts and albums dashboards still show "about" tab in muted state (not active)

---

- [x] U5. **Replace emoji image button with inline SVG in PostForm and PageForm toolbars**

**Goal:** Swap the `🖼` emoji in the image-upload `<label>` for a consistent outline SVG icon. Update preview button with label/tooltip.

**Requirements:** R5, R6

**Dependencies:** None (independent of U1–U4)

**Files:**
- Modify: `src/components/PostForm.astro`
- Modify: `src/components/PageForm.astro`

**Approach:**
- Image button: Replace `<span>🖼</span>` inside the `<label class="tb tb-image">` with an inline `<svg>` — outline rectangle (image frame) with a small mountain/peak inside, stroke-based, `width="18" height="18"`, `viewBox="0 0 18 18"`, `stroke="currentColor"`, `fill="none"`, `stroke-width="1.5"`. This matches the visual weight of the `<strong>B</strong>` and `<em>I</em>` text-based buttons
- Preview button (PostForm only — PageForm lacks the preview toggle): Add `aria-label="Preview"` and update `title="Toggle preview"`. Optionally add a short visible text label `<span class="tb-label">Preview</span>` after the icon, styled as `font-size: 11px; margin-left: 2px`. Keep the eye emoji or replace with an outline SVG eye — either is acceptable; the key requirement is the label
- `PageForm` does not have a preview button, so R6 only applies to `PostForm`

**Patterns to follow:**
- Existing `.tb` button sizing (40×40px) and `stroke="currentColor"` pattern if SVGs are used elsewhere in the codebase; otherwise follow the inline style of existing toolbar buttons

**Test scenarios:**
- Test expectation: none — visual/markup change only, image upload handler is unchanged

**Verification:**
- Image button renders an outline SVG icon, not an emoji, at toolbar button size
- Preview button has a visible label ("Preview") or a clear `title` tooltip in both desktop and mobile contexts
- Clicking the image button still triggers the file picker (the `<label for>` / wrapping label relationship is preserved)
- Clicking preview still toggles the preview pane (no JS changes needed)

---

## System-Wide Impact

- **Interaction graph:** Only `AdminLayout.astro` and three dashboard pages are structurally changed. Editors (`PostForm`, `PageForm`, `AlbumForm`) are unchanged except toolbar markup in U5.
- **Error propagation:** No new error surfaces introduced.
- **State lifecycle risks:** None — all changes are static server-rendered HTML.
- **API surface parity:** No API changes.
- **Integration coverage:** Navigation between tabs uses plain `<a>` hrefs — no client-side routing.
- **Unchanged invariants:** `bare=true` behavior is preserved; editors continue to own their own chrome.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| About editor (`bare=true`) makes the "about" tab active state hard to display | Accepted: the about tab in row 2 can be styled active via URL-match logic at the dashboard level, or simply noted as "tab navigates to editor" without an active indicator in bare mode |
| SVG icon size mismatch with text-based toolbar buttons | Set explicit `width`/`height` on the SVG and vertically center via `display: flex; align-items: center` on the `<label>` |
| Tab bar overflow on narrow mobile screens | Use `overflow-x: auto` on the tab container; tabs are 3 short words so overflow is unlikely |

---

## Sources & References

- Related code: `src/layouts/AdminLayout.astro`
- Related code: `src/pages/admin/index.astro`
- Related code: `src/pages/admin/gallery/index.astro`
- Related code: `src/pages/admin/about.astro`
- Related code: `src/components/PostForm.astro` lines 133–145
- Related code: `src/components/PageForm.astro` lines 37–48
