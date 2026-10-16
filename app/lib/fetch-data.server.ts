/**
 * The `data` of an in-process API call, or null when the call failed or answered
 * something unreadable. Reading the body inside the same promise as the call is
 * what lets a loader put every read in one `Promise.all` wave instead of waiting
 * on each response before starting to read the next.
 */
export async function fetchData<T>(
  request: Promise<{ ok: boolean; json: () => Promise<unknown> }>,
): Promise<T | null> {
  try {
    const res = await request;
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { data?: T } | null;
    return body?.data ?? null;
  } catch {
    return null;
  }
}
