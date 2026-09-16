/**
 * Building report URLs from the current ones.
 *
 * Every control on the reports page changes exactly one parameter and copies
 * the rest through verbatim. That is what makes the behaviour we want
 * structural rather than something to remember: the class picker writes only
 * `classId`, so it *cannot* disturb the dates, and the date form writes only
 * `from`/`to`, so it cannot disturb the class.
 *
 * Pure module — imported by both server and client components.
 */

export type ReportParams = Record<string, string | undefined>;

/**
 * Parameters that describe *this* page view rather than the query behind it,
 * and so must not survive a click. `trimmed` explains that the range the user
 * asked for was capped; carrying it forward would leave that notice on screen
 * long after it stopped being true.
 */
const TRANSIENT_PARAMS = new Set(['trimmed']);

/**
 * The current parameters with `patch` applied. Keys set to undefined are
 * dropped, so a control can clear a parameter as well as set one.
 *
 * Transient keys are dropped unless `patch` sets them explicitly, which is
 * what keeps every control — including the header class picker, which copies
 * the whole query string — from propagating them.
 */
export function withParams(current: ReportParams, patch: ReportParams): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value === undefined || value === '') continue;
    if (TRANSIENT_PARAMS.has(key) && !(key in patch)) continue;
    next.set(key, value);
  }

  // Stable ordering keeps hrefs comparable and the URL bar from shuffling.
  next.sort();
  return next.toString();
}

export function reportHref(current: ReportParams, patch: ReportParams): string {
  const query = withParams(current, patch);
  return query ? `/reports?${query}` : '/reports';
}
