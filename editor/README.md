# riovv editor

Mobile-first writing app for the [riovv.com](https://riovv.com) blog. Phase 1: single-tenant. Architected for SaaS expansion (Phase 2: multi-tenant via D1, Phase 3: custom domains via Cloudflare for SaaS).

Deployed at [editor.riovv.com](https://editor.riovv.com).

## How it works

1. Sign in with GitHub (OAuth, `repo` scope)
2. List, create, edit, delete posts — each operation commits markdown to the blog repo via GitHub API
3. Upload images — committed to `public/media/files/YYYY/MM/DD/` in the same repo
4. Cloudflare Pages auto-rebuilds the public blog on commit. New post is live in ~30s.

Content stays in markdown in git. No DB.

## Setup (first time)

### 1. Create a GitHub OAuth App

Go to https://github.com/settings/developers → New OAuth App.

- **Application name**: riovv editor
- **Homepage URL**: `https://editor.riovv.com`
- **Authorization callback URL**: `https://editor.riovv.com/auth/callback`

(For local dev, register a second app or update the same one to `http://localhost:4321/auth/callback`.)

Copy the **Client ID** and generate a **Client Secret**.

### 2. Configure env vars

Copy `.env.example` to `.env` (local) and fill in. For Cloudflare, set the same vars in the Pages project's **Environment Variables** dashboard (mark `*_SECRET` as encrypted).

```bash
GITHUB_OWNER=hoavo1490
GITHUB_REPO=blog
GITHUB_BRANCH=astro-migration   # or main, once cut
CONTENT_PATH=src/content/posts
MEDIA_PATH=public/media/files

GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
ALLOWED_USERS=hoavo1490          # comma-separated GitHub logins
SESSION_SECRET=$(openssl rand -hex 32)
COOKIE_DOMAIN=editor.riovv.com   # blank for local
```

### 3. Run locally

```bash
cd editor
pnpm install
pnpm dev          # http://localhost:4321
```

### 4. Deploy to Cloudflare Pages

Create a second CF Pages project (separate from the blog):

- Framework preset: Astro
- Build command: `pnpm build`
- Build output: `dist`
- Root directory: `editor`
- Node version: 22.12.0 (via `NODE_VERSION` env or `.nvmrc`)
- Compatibility flags: `nodejs_compat` (required for Octokit, jose)
- Custom domain: `editor.riovv.com`

Set all the env vars from step 2 in the project's Environment Variables (mark secrets as encrypted).

## Architecture

```
editor/
├── src/
│   ├── middleware.ts          auth guard (redirects to /login if no session)
│   ├── layouts/
│   │   └── EditorLayout.astro  mobile-first chrome, safe-area aware
│   ├── pages/
│   │   ├── index.astro         post list
│   │   ├── login.astro         OAuth init
│   │   ├── new.astro
│   │   ├── edit/[slug].astro
│   │   ├── auth/callback.ts    OAuth callback → encrypted session cookie
│   │   ├── logout.ts
│   │   └── api/
│   │       ├── save.ts         POST → commit markdown
│   │       ├── delete.ts       POST → commit deletion
│   │       └── upload.ts       POST base64 image → commit
│   ├── components/
│   │   └── PostForm.astro      form + client-side handlers
│   └── lib/
│       ├── config.ts           env-driven tenant + oauth config
│       ├── auth.ts             jose AES-GCM session cookies
│       ├── github.ts           Octokit wrappers (list/read/write/delete)
│       └── post.ts             gray-matter parse/serialize, slugify, uuid
```

## SaaS-readiness notes

Phase 1 (this) ships single-tenant via env config. The code paths that touch
tenancy already accept a `TenantConfig` object — Phase 2 will resolve that
from a D1 lookup keyed by the session user, with zero changes elsewhere:

```ts
// Phase 1
const t = tenant(env);

// Phase 2 (sketch)
const t = await tenantFromSession(env, session.userId);
```

ALLOWED_USERS in env is the Phase 1 access control. Phase 2 replaces it with
a `users` table (D1). Phase 3 adds Stripe + Cloudflare for SaaS custom domain
routing.

## Mobile UX choices

- `viewport-fit=cover` + `env(safe-area-inset-*)` for iOS notch
- `font-size: 16px` on inputs (prevents iOS auto-zoom on focus)
- 44px minimum touch targets
- Sticky bottom save bar with safe-area padding
- Native file input with `accept="image/*" capture="environment"` — taps offer Camera, Photo Library, Files
- Plain `<textarea>` for the body (mobile-native autocomplete, no editor library overhead)

## Known limitations (Phase 1)

- Renaming a post (changing date or title in edit mode) keeps the original
  filename to avoid the rename+commit dance. New posts pick fresh slugs.
- No draft state — posts are public the moment you save.
- No preview — open the blog's `pnpm dev` separately to see rendered output.
- No image deletion UI — images committed to the repo persist; delete via
  GitHub UI or local git rm if needed.
- Single user (configured via `ALLOWED_USERS`).
