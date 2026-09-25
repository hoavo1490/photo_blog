const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 photos · Jun 2026". Uses UTC so the label doesn't shift with the
 *  Worker's locale, matching post-url.ts. */
export function fmtAlbumMeta(photoCount: number, createdAt: Date): string {
  const photos = `${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`;
  return `${photos} · ${MONTHS[createdAt.getUTCMonth()]} ${createdAt.getUTCFullYear()}`;
}
