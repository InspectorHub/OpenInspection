/**
 * Unwrap the inspection-results map from API response bodies.
 *
 * The live endpoint (GET /api/inspections/:id/results) responds with
 * `{ success, data: { results: <map> } }`. Older callers guessed at
 * `{ data: { data: <map> } }` or `{ data: <map> }`, which silently
 * yielded a wrapper object instead of the map — every persisted rating
 * then rendered as unrated after a reload (B-17). Centralising the
 * unwrap keeps all loaders agreeing with the server contract while
 * tolerating the legacy shapes.
 */
export function unwrapResultsResponse(
  body: unknown,
): Record<string, Record<string, unknown>> {
  if (!body || typeof body !== 'object') return {};
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return {};

  const d = data as Record<string, unknown>;
  // Live endpoint shape: { data: { results: map } }
  if (d.results && typeof d.results === 'object') {
    return d.results as Record<string, Record<string, unknown>>;
  }
  // Double-nested legacy shape: { data: { data: map } }
  if (d.data && typeof d.data === 'object') {
    return d.data as Record<string, Record<string, unknown>>;
  }
  // Direct map under data
  return d as Record<string, Record<string, unknown>>;
}
