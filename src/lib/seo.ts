// Centralized SEO helpers. Anything that emits structured data, canonical
// URLs, or social metadata goes through here so changes to the brand graph
// happen in one place. Pure functions — no I/O — so layouts can call them
// from the frontmatter section without extra await chains.
//
// On canonical URLs: a Cloudflare Worker may receive the same request via
// the workers.dev preview host AND via the production custom domain. If we
// emit a different canonical for each, Google may index both and split
// link equity. resolveCanonicalOrigin() pins the canonical to the tenant's
// configured custom domain whenever one is set, falling back to the
// request's host only for tenants that don't have one yet.

import { defaultAuthor, defaultSiteName } from '../data/nav';

export interface TenantLike {
  name?: string | null;
  customDomain?: string | null;
}

/** Returns the origin (`https://...`) that should appear in canonical and
 *  Open Graph URL tags. Prefer the tenant's customDomain so workers.dev
 *  preview traffic doesn't pollute the index with duplicate URLs. */
export function resolveCanonicalOrigin(tenant: TenantLike | null | undefined, requestUrl: URL): string {
  if (tenant?.customDomain) return `https://${tenant.customDomain}`;
  return requestUrl.origin;
}

/** Build a canonical URL from the configured origin + the request path. */
export function resolveCanonicalUrl(tenant: TenantLike | null | undefined, requestUrl: URL): string {
  return `${resolveCanonicalOrigin(tenant, requestUrl)}${requestUrl.pathname}`;
}

export interface SocialLink {
  /** Public profile URL — feeds Schema.org Person.sameAs. */
  url: string;
}

/** Author identity used in BlogPosting.author and the WebSite Person node.
 *  sameAs links connect this entity to its public profiles so Google can
 *  resolve it to a single Knowledge Graph entity. */
export interface AuthorProfile {
  name: string;
  url?: string;
  sameAs?: string[];
}

export const defaultAuthorProfile: AuthorProfile = {
  name: defaultAuthor,
  // sameAs links connect this Person entity to the author's public
  // profiles so Google can resolve it to a single Knowledge Graph
  // node. Add more URLs as new canonical profiles come online.
  sameAs: [
    'https://www.instagram.com/rio.ro161/',
  ],
};

/** JSON-LD WebSite node. Emit on the homepage. The potentialAction lets
 *  Google offer a Sitelinks Search Box when query intent matches the
 *  brand; it's harmless when search isn't wired up yet because Google
 *  fetches the URL template only on click. */
export function buildWebSiteJsonLd(args: {
  siteUrl: string;
  siteName: string;
  description: string;
  inLanguage: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${args.siteUrl}#website`,
    url: args.siteUrl,
    name: args.siteName,
    description: args.description,
    inLanguage: args.inLanguage,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${args.siteUrl}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Person node for the site author. */
export function buildPersonJsonLd(siteUrl: string, profile: AuthorProfile) {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${siteUrl}#author`,
    name: profile.name,
  };
  if (profile.url) node.url = profile.url;
  if (profile.sameAs && profile.sameAs.length) node.sameAs = profile.sameAs;
  return node;
}

/** BreadcrumbList for a post page. Items map to the path segments:
 *  Home → Year → Post title. */
export function buildPostBreadcrumbJsonLd(args: {
  siteUrl: string;
  year: string;
  postTitle: string;
  postUrl: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: defaultSiteName, item: `${args.siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: args.year, item: `${args.siteUrl}/archive#${args.year}` },
      { '@type': 'ListItem', position: 3, name: args.postTitle, item: args.postUrl },
    ],
  };
}

/** Wrap multiple JSON-LD nodes into a single @graph document. Google
 *  parses @graph and resolves cross-node @id references, so emitting one
 *  graph block is cleaner than multiple <script type="application/ld+json">
 *  tags. */
export function asGraph(nodes: unknown[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.map((n) => {
      const copy = { ...(n as Record<string, unknown>) };
      delete copy['@context'];
      return copy;
    }),
  };
}

export { defaultSiteName, defaultAuthor };
