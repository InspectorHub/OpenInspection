/**
 * Server-side resolution of the `?from=&to=` window both metrics endpoints take.
 *
 * The frontend already normalises the range before it puts it in the URL, but
 * the endpoints are public API (and MCP tools), so they cannot assume that. The
 * rules match `app/lib/metrics-range.ts` deliberately: resolve rather than
 * reject, swap a reversed pair, and cap the span — `/api/analytics/findings-heatmap`
 * reads every result envelope inside the window, so an unbounded range is a
 * denial-of-service with extra steps.
 *
 * Civil-date strings throughout. `inspections.date` is a civil date column and
 * these bounds are compared against it as strings, so converting to instants
 * anywhere in here would only introduce a zone the comparison does not have.
 */

export interface MetricsWindow {
    from: string;
    to:   string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 366 * 5;
const DEFAULT_SPAN_MONTHS = 3;

function parse(date: string | undefined): number | null {
    if (!date || !DATE_RE.test(date)) return null;
    const [y, m, d] = date.split('-').map(Number);
    const ms = Date.UTC(y, m - 1, d, 12);
    return fmt(ms) === date ? ms : null;
}

function fmt(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Resolve the query pair into a concrete window.
 *
 * `now` is injectable so the behaviour is testable without freezing the clock.
 * Server "today" is the UTC calendar day: the endpoint has no viewer zone, and
 * the frontend supplies explicit dates computed in the viewer's zone precisely
 * so this default is never what a signed-in reader sees.
 */
export function resolveMetricsWindow(
    query: { from?: string | undefined; to?: string | undefined },
    now: Date = new Date(),
): MetricsWindow {
    const toMs = parse(query.to) ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
    const fromMs = parse(query.from)
        ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - DEFAULT_SPAN_MONTHS, now.getUTCDate(), 12);

    const [lo, hi] = fromMs <= toMs ? [fromMs, toMs] : [toMs, fromMs];
    const span = Math.round((hi - lo) / 86_400_000);
    return {
        from: fmt(span > MAX_SPAN_DAYS ? hi - MAX_SPAN_DAYS * 86_400_000 : lo),
        to:   fmt(hi),
    };
}

/**
 * `inspections.date` holds either a bare civil date (`2026-07-29`) or a full
 * ISO instant (`2026-07-29T07:40:07.055Z`) depending on how the row was
 * created. String comparison handles the first correctly and the second only if
 * the upper bound sorts after every instant on that day — `2026-07-29` sorts
 * BEFORE `2026-07-29T07:40`, which would silently drop every inspection created
 * today. Appending the high sentinel makes the inclusive bound actually
 * inclusive for both shapes.
 */
export function inclusiveUpperBound(to: string): string {
    return `${to}T99`;
}
