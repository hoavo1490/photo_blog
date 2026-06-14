# Deploying riovv-app

A one-Worker Astro 6 SSR deployment to Cloudflare. Public site and admin
editor live in the same Worker; the middleware routes by hostname.

## Prerequisites

- Cloudflare account (Workers Free or Paid)
- Neon account (Free tier is enough to start)
- GitHub account with admin rights on the content repo
- `psql` and `node` available locally
- DNS for `riovv.com` and `admin.riovv.com` managed by Cloudflare (custom domains)

## 1. Create the Postgres database (Neon)

1. https://console.neon.tech → New Project → name it `riovv`
2. Copy the **Pooled connection** string (the `-pooler` host with `sslmode=require`). Looks like:
   ```
   postgresql://riovv_owner:***@ep-foo-bar-pooler.us-east-2.aws.neon.tech/riovv?sslmode=require
   ```
3. Apply the schema:
   ```bash
   cd app
   DATABASE_URL='<paste from step 2>' node scripts/migrate.mjs
   ```
4. Seed Rio's user + site (idempotent):
   ```bash
   RIO_GITHUB_ID='<get from https://api.github.com/users/hoavo1490>' \
   DATABASE_URL='<same as above>' \
   node scripts/seed-rio.mjs
   ```

## 2. Create the R2 bucket

1. Cloudflare dashboard → R2 → Create bucket → name it `riovv-media`
2. (Optional, deferred) Settings → Custom Domains → connect `media.riovv.com` for public delivery
3. Settings → Public access → enable for the bucket OR enable the `*.r2.dev` URL (development only)
4. Note the dev URL (e.g. `https://pub-abc123.r2.dev`) — use this for `R2_DEV_BASE` until you set up the custom domain

## 3. Register a GitHub OAuth App

1. https://github.com/settings/developers → New OAuth App
2. Application name: `riovv editor`
3. Homepage URL: `https://admin.riovv.com`
4. Authorization callback URL: `https://admin.riovv.com/auth/callback`
5. Copy Client ID + generate Client Secret

## 4. Deploy the Worker

Connect this repo to Workers Builds via the dashboard:

1. Workers & Pages → Create → Connect to Git → choose `hoavo1490/photo_blog`
2. Project name: `riovv-app`
3. Production branch: `main`
4. Build settings:
   - Framework preset: **Astro**
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - **Root directory: `app`**
5. Custom domains:
   - Add `riovv.com`
   - Add `admin.riovv.com`

### Environment variables (Settings → Variables and Secrets)

Plain variables:

```
ADMIN_HOST      = admin.riovv.com
R2_DEV_BASE     = https://pub-<id>.r2.dev          (from R2 step above)
R2_PUBLIC_BASE  = https://media.riovv.com          (optional, after custom domain set)
```

Secrets (encrypted — do NOT commit):

```
DATABASE_URL                = <Neon pooler URL with sslmode=require>
GITHUB_OAUTH_CLIENT_ID      = <from step 3>
GITHUB_OAUTH_CLIENT_SECRET  = <from step 3>
ALLOWED_USERS               = hoavo1490
COOKIE_DOMAIN               = riovv.com
```

`COOKIE_DOMAIN=riovv.com` makes the session cookie valid on both
`admin.riovv.com` and `riovv.com`, so the public site can detect logged-in
state (used to skip the edge cache for authenticated views).

## 5. Verify

After the first deploy succeeds:

1. Hit `https://admin.riovv.com` → bounces to `/login`
2. Sign in via GitHub → lands on `/admin` with empty post list
3. Tap **+ new** → write a post → upload a photo → save
4. Visit `https://riovv.com` → see the post on the home grid
5. Click the card → post detail with photo lightbox

## 6. Test data integrity

- Two GitHub accounts? Add the second to `ALLOWED_USERS`, sign in,
  confirm they can't write to a site they're not a member of (403
  expected from `/admin/api/save`).

## Local development

```bash
cd app
pnpm install
pnpm dev   # workerd on http://localhost:4321
```

For local dev:
- Run a local Neon proxy or use the production DB with a `.dev.vars` file
- R2 bindings auto-mock under wrangler dev (uses a local filesystem)
- GitHub OAuth callback for localhost: register a second OAuth App
  with callback `http://localhost:4321/auth/callback`

`pnpm test` runs the 214-test suite (unit + workers + integration).
PGLite is in-memory; no external DB needed for tests.

## Rollback

The previous Jekyll-era code (`blog/`, `editor/` directories at repo root)
is still present until Phase 9 cleanup. To revert:

1. CF Pages → riovv-app → Pause Deployments
2. Re-point DNS to whatever served the previous version
3. Old branch `jekyll-final` has the pre-rewrite state if needed

## Costs at small scale

- Neon Free: 0.5 GB storage, 190 compute hours/mo. Plenty for hundreds
  of posts and tens of friends.
- R2 Free: 10 GB storage, 1M class A ops/mo, 10M class B ops/mo. Egress
  free.
- Workers Free: 100k req/day. Public-page edge cache (60s TTL) keeps you
  well under this for a personal blog.

All free tiers; no card required to start.
