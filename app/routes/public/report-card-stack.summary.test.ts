// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loader } from '../../../app/routes/public/report-card-stack';
import { createLoadContext } from '~/lib/load-context';

type LoaderArgs = Parameters<typeof loader>[0];

// A real, EMPTY load context rather than `{} as any`. It is the same thing the
// worker hands a loader with no env bound, so `getApiUrl()` still falls back to
// http://localhost:8788 and the brand/report fetches still take the stubbed
// path below — but the shape is now the one the loader actually declares, so a
// change to LoaderArgs shows up here instead of being absorbed by the cast.
const loaderArgs = (url: string): LoaderArgs => ({
  params: { tenant: 't', id: 'i' },
  request: new Request(url),
  url: new URL(url),
  pattern: '/report-view/:tenant/:id',
  context: createLoadContext(),
});

beforeEach(() => {
  // initialFilter is derived purely from the request URL; the loader's
  // brand/report fetches are irrelevant to it. Stub fetch to fail fast so the
  // loader takes its graceful-default path hermetically — no real request.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no API in unit test')));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('report-card-stack loader summary mode', () => {
  it('defaults initialFilter to "summary" when ?summary=1', async () => {
    // Not `const res: any` — the loader's two return paths both `satisfies
    // LoaderResult`, so `res.initialFilter` is a typed read. Under `any` it was
    // not: `res.initialFilterr` would have compiled and asserted undefined.
    const res = await loader(loaderArgs('https://x/report-view/t/i?summary=1'));
    expect(res.initialFilter).toBe('summary');
  });
  it('defaults initialFilter to "all" otherwise', async () => {
    const res = await loader(loaderArgs('https://x/report-view/t/i'));
    expect(res.initialFilter).toBe('all');
  });
});
