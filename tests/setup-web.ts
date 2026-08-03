import { afterEach, beforeEach } from 'vitest';

// jest-dom matchers. The reason is failure MESSAGES, not brevity:
// `expect(el.disabled).toBe(true)` fails with "expected false to be true",
// which names neither the element nor the reason. `toBeDisabled()` prints the
// element it was handed.
//
// Loaded only where there is a DOM to match against. This file runs for every
// spec in the suite, and since the suite defaults to the node environment (see
// vitest.config.ts) most of them have no element to assert on — importing the
// matchers there would pull the package and its dependencies into 136 specs
// that cannot use them. A spec that opts into happy-dom gets them; one that did
// not ask for a browser was never going to call toBeDisabled().
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

/**
 * Hermeticity guard for the web-unit suite (happy-dom).
 *
 * `app/lib/api.server.ts` `getApiUrl()` falls back to `http://localhost:8788`
 * when neither `API_URL` nor the CF binding is set, so a co-located loader/
 * action (or component effect) test that neither sets `API_URL` nor stubs
 * `fetch` fires a REAL request. In the unit env it ECONNREFUSEs and the BFF's
 * graceful-degradation `catch` swallows it — the test passes green while only
 * ever exercising the error path, and stderr fills with
 * `AggregateError: ECONNREFUSED …:8788` noise.
 *
 * This guard blocks every real network call (rejecting fast, so nothing hangs
 * or leaks to the network) and, when a call was made *within* a test, fails
 * that test in `afterEach`. A test that legitimately exercises fetch must stub
 * it (`vi.stubGlobal('fetch', …)`); a stub replaces `globalThis.fetch`, so this
 * guard is not even invoked for hermetic tests.
 *
 * To enumerate existing offenders, temporarily add a
 * `console.error(new Error().stack)` in the wrapper — the call-time stack names
 * the originating `.test` file (fire-and-forget effects land outside afterEach,
 * so afterEach alone under-reports them).
 */
let leaked: string[] = [];

beforeEach(() => {
  leaked = [];
});

globalThis.fetch = ((input: unknown, _init?: unknown) => {
  const url =
    typeof input === 'string'
      ? input
      : (input as { url?: string } | undefined)?.url ?? String(input);
  leaked.push(url);
  return Promise.reject(new Error(`[hermetic-guard] real network call blocked: ${url}`));
}) as typeof fetch;

afterEach(() => {
  if (leaked.length === 0) return;
  const urls = [...new Set(leaked)].join(', ');
  leaked = [];
  throw new Error(
    `Hermeticity: this web-unit test made a real network call to ${urls}. ` +
      `Stub fetch or the API (e.g. vi.stubGlobal('fetch', …)) — see tests/setup-web.ts.`,
  );
});
