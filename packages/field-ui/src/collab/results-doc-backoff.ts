/** The reconnect backoff of `connectResultsDoc` (re-exported from `results-doc-connection`). */

/** First reconnect delay (ms); doubles each attempt up to RECONNECT_MAX_MS — kept short so a cold DO self-heals before the user notices. */
const RECONNECT_BASE_MS = 400;
/** Backoff ceiling (ms): attempts never wait longer than this between reopens. */
const RECONNECT_MAX_MS = 30_000;

/** Compute the exponential backoff delay for the Nth (0-based) reconnect attempt. */
export function reconnectDelayMs(attempt: number): number {
    const exp = RECONNECT_BASE_MS * Math.pow(2, Math.max(0, attempt));
    return Math.min(exp, RECONNECT_MAX_MS);
}
