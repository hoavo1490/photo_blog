// Pure formatters for the editor's status row chips (date / tags /
// cover). Stays free of DOM access so the same code can render on the
// server (initial paint) and re-render on the client when the author
// edits a chip in place.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Display text for the date chip.
 *  - `null` / empty -> "+ date" (call-to-action when unset)
 *  - matches today -> "today"
 *  - same calendar year as today -> "Mar 4"
 *  - older -> "Mar 4, 2024"
 *  Inputs are `YYYY-MM-DD` strings (the form's date input format) so the
 *  formatter has no timezone ambiguity. */
export function formatDateChip(dateISO: string | null, todayISO: string): string {
  if (!dateISO) return '+ date';
  if (dateISO === todayISO) return 'today';
  const [y, m, d] = dateISO.split('-').map((s) => parseInt(s, 10));
  const [ty] = todayISO.split('-').map((s) => parseInt(s, 10));
  const month = MONTH_SHORT[m - 1];
  return y === ty ? `${month} ${d}` : `${month} ${d}, ${y}`;
}

/** Display text for the tags chip.
 *  Accepts either a list (the canonical shape) or a comma-separated
 *  string (the form input's storage shape). Blank entries are dropped. */
export function formatTagsChip(tags: ReadonlyArray<string> | string): string {
  const list = typeof tags === 'string' ? tags.split(',') : tags;
  const clean = list.map((t) => t.trim()).filter((t) => t.length > 0);
  if (clean.length === 0) return '+ tags';
  return clean.map((t) => `#${t}`).join(' ');
}
