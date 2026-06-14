#!/usr/bin/env bash
# Backfill responsive image variants for existing images.
#
# For each row in `images` with empty `variant_widths`:
#   1. Download original from R2 (via public URL).
#   2. Resize to 400/800/1200 widths with `sips` (macOS built-in,
#      Lanczos-quality resampler).
#   3. Upload each variant to R2 next to the original at
#      `<key>.<W>w.jpg`.
#   4. Set `variant_widths = {400, 800, 1200}` in the DB.
#
# Variants larger than the original are skipped (sips won't upscale).
#
# Requires: psql, sips, pnpm (for wrangler), wrangler logged in to the
# CF account that owns the bucket.
#
# Usage:
#   DATABASE_URL='...' R2_DEV_BASE='https://pub-XXX.r2.dev' \
#     R2_BUCKET='riovv-media' \
#     scripts/backfill-image-variants.sh
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required}"
: "${R2_DEV_BASE:?R2_DEV_BASE required}"
: "${R2_BUCKET:?R2_BUCKET required (e.g. riovv-media)}"

WIDTHS=(400 800 1200)
TMPDIR_LOCAL=$(mktemp -d)
trap "rm -rf '$TMPDIR_LOCAL'" EXIT

echo "Listing images without variants..."
ROWS=$(psql "$DATABASE_URL" -t -A -F$'\t' -c \
  "SELECT id, r2_key FROM images WHERE COALESCE(array_length(variant_widths,1),0)=0;")

if [ -z "$ROWS" ]; then echo "Nothing to backfill."; exit 0; fi

PROCESSED=0
while IFS=$'\t' read -r id key; do
  [ -z "$key" ] && continue
  echo
  echo "→ $key"
  ORIG="$TMPDIR_LOCAL/orig.jpg"
  curl -sf "$R2_DEV_BASE/$key" -o "$ORIG" || { echo "  download failed"; continue; }
  ORIG_WIDTH=$(sips -g pixelWidth "$ORIG" | awk '/pixelWidth/ {print $2}')
  echo "  original width: $ORIG_WIDTH"

  GENERATED=()
  for W in "${WIDTHS[@]}"; do
    if [ "$W" -ge "$ORIG_WIDTH" ]; then
      echo "  skip ${W}w (>= original)"
      continue
    fi
    OUT="$TMPDIR_LOCAL/${W}.jpg"
    sips --setProperty formatOptions 85 -s format jpeg --resampleWidth "$W" "$ORIG" --out "$OUT" >/dev/null
    # Strip the trailing extension, append .${W}w.jpg
    VARIANT_KEY="${key%.*}.${W}w.jpg"
    echo "  upload $VARIANT_KEY ($(stat -f%z "$OUT") bytes)"
    pnpm exec wrangler r2 object put "${R2_BUCKET}/${VARIANT_KEY}" \
      --file "$OUT" --content-type image/jpeg --remote >/dev/null 2>&1
    GENERATED+=("$W")
  done

  if [ ${#GENERATED[@]} -gt 0 ]; then
    WIDTHS_PG="{$(IFS=,; echo "${GENERATED[*]}")}"
    psql "$DATABASE_URL" -c \
      "UPDATE images SET variant_widths = '${WIDTHS_PG}'::INTEGER[] WHERE id = '${id}';" >/dev/null
    echo "  variant_widths = ${WIDTHS_PG}"
    PROCESSED=$((PROCESSED+1))
  fi
done <<< "$ROWS"

echo
echo "Backfilled $PROCESSED images."
