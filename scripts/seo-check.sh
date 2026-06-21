#!/usr/bin/env bash
# Smoke-tests the SEO surface of a deployed instance. Pass the base URL
# as the first argument; defaults to https://hoavv.com.
#
# Each check prints PASS/FAIL plus a one-line reason. Exit status is the
# count of failures, so CI / git pre-push can wire this in directly.
#
# Usage:
#   ./scripts/seo-check.sh                       # tests hoavv.com
#   ./scripts/seo-check.sh https://staging.x.dev # tests a specific origin
#   POST_URL=/2026/06/21/foo ./scripts/seo-check.sh
#       # override which post the post-specific checks hit

set -uo pipefail

BASE="${1:-https://hoavv.com}"
POST_URL_PATH="${POST_URL:-}"

fail=0
pass_count=0
fail_count=0

# Pretty colors when the terminal supports them.
if [[ -t 1 ]]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; X=$'\033[0m'
else
  G=''; R=''; Y=''; D=''; X=''
fi

pass() { echo "  ${G}✓${X} $1"; pass_count=$((pass_count + 1)); }
warn() { echo "  ${Y}!${X} $1"; }
fail() { echo "  ${R}✗${X} $1"; fail_count=$((fail_count + 1)); fail=$((fail + 1)); }

section() { echo; echo "${D}── $1 ──${X}"; }

# Pick the first published post URL from the sitemap if none was passed,
# so the post-specific checks always have a real target.
discover_post() {
  local sitemap
  sitemap=$(curl -fsSL "$BASE/sitemap.xml" 2>/dev/null) || return 1
  # First <loc> that looks like a dated post path.
  echo "$sitemap" \
    | grep -oE '<loc>[^<]+/[0-9]{4}/[0-9]{2}/[0-9]{2}/[^<]+</loc>' \
    | head -n1 \
    | sed -E 's|<loc>([^<]+)</loc>|\1|'
}

if [[ -z "$POST_URL_PATH" ]]; then
  POST_URL_FULL=$(discover_post || true)
  POST_URL_PATH="${POST_URL_FULL#$BASE}"
else
  POST_URL_FULL="${BASE}${POST_URL_PATH}"
fi

if [[ -z "$POST_URL_FULL" ]]; then
  echo "${R}Couldn't find a post URL in $BASE/sitemap.xml — post-level checks will be skipped.${X}"
fi

# ─── 1. Artifact endpoints ────────────────────────────────────────────
section "Artifacts"

sitemap=$(curl -fsSL "$BASE/sitemap.xml") || sitemap=""
if [[ -z "$sitemap" ]]; then
  fail "sitemap.xml — not reachable"
else
  pass "sitemap.xml reachable"
  grep -q 'xmlns:image=' <<<"$sitemap" \
    && pass "sitemap declares xmlns:image (Google Images extension)" \
    || fail "sitemap missing xmlns:image namespace"
  grep -q '/gallery' <<<"$sitemap" \
    && pass "sitemap includes /gallery" \
    || fail "sitemap missing /gallery"
  grep -q '<image:loc>' <<<"$sitemap" \
    && pass "sitemap emits <image:loc> for posts" \
    || warn "sitemap has no <image:loc> entries (no posts have covers?)"
fi

rss=$(curl -fsSL "$BASE/atom.xml") || rss=""
if [[ -z "$rss" ]]; then
  fail "atom.xml — not reachable"
else
  pass "atom.xml reachable"
  grep -q 'atom:link.*rel="self"' <<<"$rss" \
    && pass "atom.xml has <atom:link rel=\"self\">" \
    || fail "atom.xml missing <atom:link rel=\"self\">"
  grep -q '<content:encoded>' <<<"$rss" \
    && pass "atom.xml emits <content:encoded>" \
    || fail "atom.xml missing <content:encoded>"
  grep -q '<language>vi-VN</language>' <<<"$rss" \
    && pass "atom.xml declares <language>vi-VN</language>" \
    || fail "atom.xml missing <language>"
fi

llms=$(curl -fsSL "$BASE/llms.txt") || llms=""
if [[ -n "$llms" ]] && grep -q '^# ' <<<"$llms"; then
  pass "llms.txt reachable + starts with H1"
else
  fail "llms.txt not reachable or malformed"
fi

robots=$(curl -fsSL "$BASE/robots.txt") || robots=""
if grep -q '^LLM-Content:' <<<"$robots"; then
  pass "robots.txt has LLM-Content: hint"
else
  fail "robots.txt missing LLM-Content directive"
fi
if grep -q '^Sitemap:' <<<"$robots"; then
  pass "robots.txt has Sitemap: directive"
else
  fail "robots.txt missing Sitemap directive"
fi

key=$(curl -fsSL "$BASE/indexnow-key.txt") || key=""
if [[ -n "$key" && ${#key} -ge 8 && ${#key} -le 128 ]]; then
  pass "indexnow-key.txt serves a valid-length key (len=${#key})"
elif [[ -z "$key" ]]; then
  warn "indexnow-key.txt 404 — set INDEXNOW_KEY in Cloudflare to enable IndexNow"
else
  fail "indexnow-key.txt content doesn't look like a valid key"
fi

# ─── 2. Post-level structure ──────────────────────────────────────────
section "Post HTML ($POST_URL_FULL)"

if [[ -n "$POST_URL_FULL" ]]; then
  # Fetch headers + body in one call so we can inspect cache-control too.
  raw=$(curl -fsSL -D - "$POST_URL_FULL" 2>/dev/null) || raw=""
  if [[ -z "$raw" ]]; then
    fail "post URL — not reachable"
  else
    # Split headers/body on the first blank line.
    headers="${raw%%$'\r\n\r\n'*}"
    body="${raw#*$'\r\n\r\n'}"

    # Cache-Control: expect max-age=300 + stale-while-revalidate.
    cc=$(grep -i '^cache-control:' <<<"$headers" | head -n1 | tr -d '\r')
    if [[ "$cc" == *"max-age=300"* && "$cc" == *"stale-while-revalidate"* ]]; then
      pass "Cache-Control has max-age=300 + stale-while-revalidate"
    elif [[ -n "$cc" ]]; then
      warn "Cache-Control present but not the round-2 shape: $cc"
    else
      fail "Cache-Control header missing"
    fi

    # Canonical: must match BASE host, not a workers.dev preview.
    canonical=$(grep -oE '<link[^>]*rel="canonical"[^>]*>' <<<"$body" | head -n1)
    base_host="${BASE#https://}"; base_host="${base_host#http://}"; base_host="${base_host%%/*}"
    if [[ "$canonical" == *"$base_host"* ]]; then
      pass "canonical points at $base_host"
    elif [[ -n "$canonical" ]]; then
      fail "canonical doesn't reference $base_host — found: $canonical"
    else
      fail "no <link rel=\"canonical\"> tag"
    fi

    # Single <h1> per page.
    h1_count=$(grep -oE '<h1[> ]' <<<"$body" | wc -l | tr -d ' ')
    if [[ "$h1_count" == "1" ]]; then
      pass "exactly 1 <h1> on the page"
    else
      fail "expected 1 <h1>, found $h1_count"
    fi

    # Body heading shift: body markdown `# X` should now render as <h2>.
    # We can't introspect markdown here; instead check that the page has
    # at least one <h2> (the post we inserted YouTube embeds into has prose),
    # or warn when it doesn't.
    if grep -q '<h2[> ]' <<<"$body"; then
      pass "body emits <h2> headings (renderer shift active)"
    else
      warn "no <h2> in body — either the post has no markdown headings or the renderer regressed"
    fi

    # JSON-LD: BlogPosting + BreadcrumbList.
    json_ld=$(grep -oE '<script[^>]*type="application/ld\+json"[^>]*>[^<]+</script>' <<<"$body" | head -n1)
    if [[ "$json_ld" == *"BlogPosting"* ]]; then
      pass "JSON-LD has BlogPosting"
    else
      fail "JSON-LD missing BlogPosting"
    fi
    if [[ "$json_ld" == *"BreadcrumbList"* ]]; then
      pass "JSON-LD has BreadcrumbList"
    else
      fail "JSON-LD missing BreadcrumbList"
    fi

    # OG image + Twitter card.
    grep -q 'property="og:image"' <<<"$body" \
      && pass "og:image present" \
      || warn "og:image missing (post without a cover?)"
    grep -q 'name="twitter:card"' <<<"$body" \
      && pass "twitter:card present" \
      || fail "twitter:card missing"

    # Related posts strip.
    grep -q 'class="related"\|aria-labelledby="related-heading"' <<<"$body" \
      && pass "related-posts <aside> rendered" \
      || warn "no related <aside> (post may have unique tags)"

    # Visible breadcrumb nav.
    grep -q 'class="breadcrumb"' <<<"$body" \
      && pass "visible breadcrumb nav rendered" \
      || fail "visible breadcrumb nav missing"
  fi
else
  warn "Skipping post-level checks (no post URL available)"
fi

# ─── 3. Homepage structure ────────────────────────────────────────────
section "Homepage HTML ($BASE/)"

home=$(curl -fsSL "$BASE/" 2>/dev/null) || home=""
if [[ -z "$home" ]]; then
  fail "homepage not reachable"
else
  pass "homepage reachable"
  # The Person + WebSite JSON-LD only render on the homepage.
  if grep -q '"@type":"WebSite"' <<<"$home" || grep -q '"@type": "WebSite"' <<<"$home"; then
    pass "homepage JSON-LD has WebSite node"
  else
    fail "homepage JSON-LD missing WebSite node"
  fi
  if grep -q '"@type":"Person"' <<<"$home" || grep -q '"@type": "Person"' <<<"$home"; then
    pass "homepage JSON-LD has Person node"
  else
    fail "homepage JSON-LD missing Person node"
  fi
  if grep -q 'instagram.com/rio.ro161' <<<"$home"; then
    pass "Person.sameAs links Instagram profile"
  else
    warn "Instagram URL not found in homepage HTML"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────
section "Summary"
echo "  ${G}${pass_count} passed${X}    ${R}${fail_count} failed${X}"

exit "$fail"
