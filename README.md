# rusty shutter

Astro blog at [lhzhang.com](https://lhzhang.com).

## Develop

```bash
pnpm install
pnpm dev          # local server at http://localhost:4321
pnpm build        # static build to dist/
pnpm preview      # serve dist/ locally
```

## Stack

- Astro 5 with Content Collections (132 posts in `src/content/posts/`)
- SCSS via Vite (`src/styles/`)
- PhotoSwipe v5 for the post-image lightbox (bundled from npm)
- RSS via `@astrojs/rss` at `/atom.xml`
- Sitemap via `@astrojs/sitemap`

## Deploy (Cloudflare Pages)

- Framework preset: Astro
- Build command: `pnpm build`
- Output directory: `dist`
- Node version: pinned via `.nvmrc` (22.12.0)
- Custom domain: configured in CF Pages dashboard

## Layout

```
src/
├── content/posts/   132 markdown posts, frontmatter: title, date, tags, guid
├── pages/           index, archive, tags, about, 404, atom.xml + [year]/[month]/[day]/[slug]
├── layouts/         BaseLayout, PostLayout, PageLayout
├── components/      Header, Footer, PostCard, TagChips
├── scripts/         home-filter.ts (tag chips), lightbox.ts (PhotoSwipe)
├── styles/          global.scss, _vars, _media-queries, _cards, _tags
├── utils/           post-url, extract (cover/description from markdown body), adjacent, tags
└── remark/          first-image, description (post-detail-only enrichment via remarkPluginFrontmatter)
public/
├── media/           legacy /media/files/YYYY/MM/DD/*.jpg image URLs preserved 1:1
└── _headers         Cloudflare caching rules
```

## Post URL contract

Permalink format `/YYYY/MM/DD/slug.html` is preserved from the Jekyll era. RSS subscriber IDs (`<guid>`) carry over the original `urn:uuid:...` from `guid:` frontmatter.

## New post

Create `src/content/posts/YYYY-MM-DD-slug.md`:

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

The first image in the body becomes the homepage card cover. The first paragraph becomes the card description.
