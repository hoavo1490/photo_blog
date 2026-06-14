# riovv

Rio's blog and photo gallery at [riovv.com](https://riovv.com), with the editor at [admin.riovv.com](https://admin.riovv.com). One Astro 6 SSR Worker serves both, backed by Neon Postgres for content and Cloudflare R2 for images. Multi-tenant from day one, but with only Rio's site populated initially.

See [DEPLOY.md](./DEPLOY.md) for first-time setup (Neon + R2 + GitHub OAuth + Cloudflare Workers Builds).

## Develop

```bash
pnpm install
pnpm dev            # workerd on http://localhost:4321
pnpm test           # 214 tests (unit + DB integration + R2 Miniflare)
pnpm typecheck      # astro check + tsc --noEmit
pnpm build          # production build to dist/
```

`pnpm dev` runs against real workerd via the `@astrojs/cloudflare` adapter v13. Local DB needs `DATABASE_URL` in `.dev.vars` pointing at either a Neon branch or a local Postgres. Tests use in-process PGLite (no external DB or Docker needed).

## Stack

- **Astro 6** + `@astrojs/cloudflare` v13 — SSR on Cloudflare Workers (`output: 'server'`)
- **Neon Postgres** via `@neondatabase/serverless` HTTP driver
- **Cloudflare R2** for image storage (binding: `PHOTOS`)
- **PhotoSwipe v5** for the post-image lightbox (bundled, not CDN)
- **Vitest 4** + `@cloudflare/vitest-pool-workers` + PGLite for tests
- **GitHub OAuth** (scope `read:user user:email`) → server-side sessions table

## Architecture (one-Worker, two-host model)

```
riovv.com          → public read site (year-grouped card grid, post detail with lightbox)
admin.riovv.com    → authenticated editor (post list, new/edit forms, image upload)
                     ↓
                  middleware routes by host:
                     ↓
              ┌──────────────┴──────────────┐
              │                             │
          public branch                admin branch
        - resolve tenant by host    - require session cookie or
        - 301 from historic host      bounce to /login
        - edge-cache anonymous GETs - mutations: POST /admin/api/*
        - render from DB
```

Defense in depth: every DB write takes `siteId` and verifies it explicitly. Posts/images/tags repos enforce site scoping. The middleware exposes `Astro.locals.db`, `Astro.locals.tenant`, `Astro.locals.session` to every route.

## Repo layout

```
/
├── astro.config.mjs           Astro 6 + adapter v13
├── wrangler.jsonc             ASSETS + R2 binding + vars
├── vitest.config.ts           two projects: unit (Node) + workers (Miniflare)
├── migrations/0001_init.sql   schema: users, sites, site_members, posts,
│                              tags, post_tags, images, sessions,
│                              site_domain_history + indexes/triggers
├── scripts/
│   ├── migrate.mjs            psql-based migration runner
│   └── seed-rio.mjs           idempotent first-tenant seed
├── DEPLOY.md                  step-by-step prod setup
├── public/                    favicon.ico + _headers
└── src/
    ├── middleware.ts          host → tenant + cookie → session + edge cache
    ├── env.d.ts               App.Locals shape
    ├── lib/
    │   ├── slug.ts, post-url.ts, markdown.ts, render.ts      (pure helpers)
    │   ├── db/                                                (SqlDriver + 6 repos)
    │   ├── r2/images.ts                                       (R2 + key + dims)
    │   ├── auth/{oauth,session-cookie,login-flow}.ts          (GitHub OAuth + sessions)
    │   └── middleware/{route-mode,cache,tenant}.ts            (request classification)
    ├── components/{Header,Footer,PostCard,PostForm}.astro
    ├── layouts/{Base,Post,Page,Admin}Layout.astro
    ├── pages/
    │   ├── index.astro                       public year-grouped card grid
    │   ├── archive.astro, tags.astro, tags/[tag].astro, about.astro, 404.astro
    │   ├── [year]/[month]/[day]/[slug].astro public post detail
    │   ├── atom.xml.ts, sitemap.xml.ts       RSS + sitemap (DB-backed)
    │   ├── login.astro, auth/callback.ts, logout.ts
    │   └── admin/
    │       ├── index.astro, new.astro, edit/[id].astro
    │       └── api/{save,delete,upload}.ts
    ├── scripts/lightbox.ts    PhotoSwipe wrapper for post pages
    └── styles/                 SCSS — global, _vars, _media-queries, _cards, _tags
```

## Post URL contract

`/YYYY/MM/DD/slug.html`. Stable across timezones (UTC components). RSS at `/atom.xml`. Sitemap at `/sitemap.xml`.

## Image storage

Body markdown references images via tokens: `![alt](image:<uuid>)`. A render-time pass resolves them to public R2 URLs via the `images` table. Keys are content-hashed (`<siteId>/<YYYY>/<MM>/<DD>/<hash>-<filename>`) so re-uploading the same bytes deduplicates and cached URLs stay immutable.

## Testing

- Pure helpers: Node pool, Vitest unit tests
- DB layer: Node pool against in-process PGLite (the full schema, no mocks)
- R2 layer: Workers pool against Miniflare R2
- Auth: Node pool with a hand-rolled GitHub OAuth fake (`tests/fakes/`)

```bash
pnpm test           # both projects
pnpm test:unit      # Node only
pnpm test:workers   # workerd only
```

## License

Personal project; not currently open-source. Ask before forking.
