import { describe, it, expect } from 'vitest';
import { unwrapResultsResponse } from '~/lib/results';

/**
 * B-17 regression: GET /api/inspections/:id/results returns
 * `{ success, data: { results: <map> } }` (server/api/inspections.ts
 * getResultsRoute), but the inspection-edit + form-renderer loaders
 * unwrapped `body.data.data || body.data` — one level short — so every
 * persisted rating rendered as unrated after a reload ("0/40 rated"
 * while the row sat in D1).
 */
describe('unwrapResultsResponse', () => {
  const map = {
    '_default:s_roof:i_roof_cover': { rating: 'DEF', rating_v: 3 },
    'i_flashing': { notes: 'legacy unkeyed entry' },
  };

  it('unwraps the live endpoint shape { data: { results: map } }', () => {
    expect(unwrapResultsResponse({ success: true, data: { results: map } })).toEqual(map);
  });

  it('passes through a direct map under data (legacy shape)', () => {
    expect(unwrapResultsResponse({ success: true, data: map })).toEqual(map);
  });

  it('unwraps the double-nested { data: { data: map } } shape', () => {
    expect(unwrapResultsResponse({ data: { data: map } })).toEqual(map);
  });

  it('returns {} for empty/missing payloads', () => {
    expect(unwrapResultsResponse(undefined)).toEqual({});
    expect(unwrapResultsResponse(null)).toEqual({});
    expect(unwrapResultsResponse({})).toEqual({});
    expect(unwrapResultsResponse({ success: true, data: {} })).toEqual({});
    expect(unwrapResultsResponse({ success: true, data: { results: {} } })).toEqual({});
  });

  it('does not mistake a non-object results value for a wrapper', () => {
    const weird = { results: 'not-a-map', '_default:s:i': { rating: 'SAT' } };
    expect(unwrapResultsResponse({ data: weird })).toEqual(weird);
  });
});
