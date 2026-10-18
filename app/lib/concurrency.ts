/**
 * Small concurrency helpers for loaders and actions that fan out over a list.
 *
 * Both are deliberately plain: no queue, no retry, no shared state.
 */

/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight.
 *
 * Results come back in input order. The first rejection rejects the whole call
 * and no further items are started (calls already in flight run to completion;
 * nothing cancels them). A non-positive or non-finite `limit` is treated as 1
 * rather than hanging. A callback that throws synchronously rejects like one
 * that returns a rejected promise.
 *
 * Use it where an unbounded `Promise.all` over user-sized data would issue one
 * in-process API call (or one D1 query) per item all at once.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const lanes = Math.min(items.length, Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, worker));
  return results;
}

export interface SettledOptions<T> {
  /** Returned when the call rejects, throws, or exceeds `timeoutMs`. */
  fallback: T;
  /** Names the call in the warning; keep it short and free of ids or user data. */
  label: string;
  /** Give up waiting after this many milliseconds. Omit to wait for the call. */
  timeoutMs?: number;
}

/**
 * Await a best-effort read: any failure becomes `fallback`, and is reported.
 *
 * Notes that matter:
 * - The timeout only stops WAITING. It does not cancel the call: a D1 query or
 *   an in-process API request that has started keeps running (and keeps being
 *   billed) after the fallback was returned. A late rejection is swallowed.
 * - `fn` is invoked inside the helper's own `try`, so a typed client that throws
 *   synchronously (rather than returning a rejected promise) is also a fallback.
 * - Never use it for data that decides a status code, header or redirect: a
 *   fallback there is a wrong answer, not a degraded one.
 */
export async function settled<T>(fn: () => Promise<T>, opts: SettledOptions<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = Promise.resolve().then(fn);
    // Observed here so a rejection that arrives after the timeout won is not unhandled.
    call.catch(() => undefined);
    if (opts.timeoutMs === undefined) return await call;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
    });
    return await Promise.race([call, timeout]);
  } catch (error) {
    console.warn(`[settled] ${opts.label} fell back: ${error instanceof Error ? error.message : String(error)}`);
    return opts.fallback;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
