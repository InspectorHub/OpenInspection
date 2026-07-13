/**
 * Run `worker` over `items` with at most `limit` in flight at once, returning
 * results in INPUT ORDER (result[i] corresponds to items[i]). The worker should
 * return a result object rather than throw for expected failures; if it does
 * throw, the rejection propagates (callers that want partial success must catch
 * inside the worker).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  let cursor = 0;
  const runnerCount = Math.min(limit, items.length);

  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: runnerCount }, () => runner()));

  return results;
}
