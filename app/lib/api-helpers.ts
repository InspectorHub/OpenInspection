/**
 * Legacy API response helpers — kept as a fallback utility but no longer used
 * by standard route loaders. All routes now use the standardized API response
 * format directly: `{ success: true, data: [...] }` or `{ success: true, data: {...} }`.
 */

/**
 * Safely extract an array from an API response body.
 * Handles: { data: [...] }, { data: { items: [...] } }, { data: { contacts: [...] } }, etc.
 * Falls back to empty array if the response doesn't contain array data.
 */
export function extractArray(body: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;

  // Try { data: [...] }
  if (Array.isArray(obj.data)) return obj.data;

  // Try { data: { <key>: [...] } } for each provided key
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
    // Try common keys
    for (const key of ["items", "rows", "results", "list"]) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
  }

  return [];
}

/**
 * Safely extract a stats/summary object from an API response.
 */
export function extractObject(body: unknown, key?: string): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const obj = body as Record<string, unknown>;
  if (key && obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (data[key] && typeof data[key] === "object") return data[key] as Record<string, unknown>;
  }
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
    return obj.data as Record<string, unknown>;
  }
  return {};
}
