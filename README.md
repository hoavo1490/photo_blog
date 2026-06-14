# riovv

Rio's blog at [riovv.com](https://riovv.com). Built on Astro, deployed to Cloudflare Pages.

## Repo layout

```
/                 the public blog (Astro static)
└── editor/       the writing app (Astro on Cloudflare Workers) — mobile-first CMS
```

## Develop the public blog

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static build to dist/
pnpm preview      # serve dist/ locally
```

## Stack

- Astro 5 + Content Collections (`src/content/posts/*.md`)
- SCSS via Vite
- PhotoSwipe v5 for the post-image lightbox
- RSS via `@astrojs/rss` at `/atom.xml`
- Sitemap via `@astrojs/sitemap`

## Deploy (Cloudflare Pages)

- Framework preset: Astro
- Build command: `pnpm build`
- Output directory: `dist`
- Node version: pinned via `.nvmrc` (22.12.0)
- Custom domain: `riovv.com` configured in CF Pages dashboard

## Layout

```
src/
├── content/posts/   markdown posts, frontmatter: title, date, tags, guid, optional cover
├── pages/           index, archive, tags, about, 404, atom.xml + [year]/[month]/[day]/[slug]
├── layouts/         BaseLayout, PostLayout, PageLayout
├── components/      Header, Footer, PostCard
├── scripts/         lightbox.ts (PhotoSwipe wrapper)
├── styles/          global.scss + _vars, _media-queries, _cards, _tags
├── utils/           post-url, extract, adjacent, tags
└── remark/          first-image, description
public/
├── media/           image assets, /media/files/YYYY/MM/DD/*.jpg
└── _headers         Cloudflare caching rules
```

## Post URL contract

Permalink format `/YYYY/MM/DD/slug.html`. RSS items use the `urn:uuid:...` from frontmatter `guid:` so subscribers don't see duplicates if the format ever changes.

## Writing posts

The recommended way is the editor app at [editor.riovv.com](https://editor.riovv.com). See `editor/README.md`.

For manual creation, add `src/content/posts/YYYY-MM-DD-slug.md`:

```yaml
---
title: My post title
date: 2026-06-14
tags:
  - photography
guid: 'urn:uuid:GENERATE-WITH-uuidgen'
---

content here
```

The first image in the body becomes the homepage card cover; the first paragraph becomes the card description.
