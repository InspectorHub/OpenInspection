/**
 * A `fetch` test double whose RECORDED CALLS are typed.
 *
 * WHY A HELPER. The specs for the outbound REST clients
 * (`server/lib/messaging/twilio.ts`, `telnyx-rest-client.ts`,
 * `server/lib/email/providers/resend.ts`) all assert on the request that was
 * made, so they all read `fetchMock.mock.calls[0]`. Written as
 * `vi.fn(async () => new Response(...))` the mock's parameter list is EMPTY, so
 * vitest types each recorded call as the tuple `[]` — `const [url, init] =
 * calls[0]` is then TS2493 ("length 0 has no element at index 0") and every
 * subsequent `init.headers` is TS18048. That is ~110 diagnostics across five
 * specs, none of which is a real defect: the calls really do carry two
 * arguments, the zero-arg implementation just never said so.
 *
 * Declaring the parameters here fixes all of them at once, with no assertion:
 * `vi.fn` infers the call signature from the implementation's declared type, so
 * `mock.calls` becomes `[string, RequestInit][]` by inference rather than by
 * cast. An implementation that ignores both arguments still satisfies it.
 *
 * ⚠️ `init` IS DECLARED REQUIRED, NOT OPTIONAL, and that is a claim about the
 * code under test: every `fetch(...)` in the three clients above passes an init
 * (twilio.ts, telnyx-rest-client.ts and the Resend provider each build one
 * unconditionally). Optional would be more faithful to `fetch` itself but would
 * make every `init.method` an error whose only fix is `!` — trading 110 honest
 * diagnostics for 50 suppressions. If a client ever starts calling `fetch(url)`
 * bare, the spec that reads `init` throws `Cannot read properties of undefined`
 * on the very next line, which is the loud failure this file prefers over a
 * silent `undefined`.
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';

/** What the clients under test actually invoke. */
export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

/** A `vi.fn()` whose `.mock.calls` entries are `[string, RequestInit]`. */
export type RecordingFetch = Mock<FetchImpl>;

/**
 * Build a recording `fetch` double. Pass the implementation the spec wants —
 * it may ignore either argument.
 */
export function recordingFetch(impl: FetchImpl): RecordingFetch {
    return vi.fn(impl);
}

/**
 * The overwhelmingly common case: one canned JSON response, then assert on what
 * was sent. Stubs the global and hands back the recorder.
 */
export function stubFetchJson(status: number, body: unknown, headers?: Record<string, string>): RecordingFetch {
    const mock = recordingFetch(async () => new Response(JSON.stringify(body), { status, headers }));
    vi.stubGlobal('fetch', mock);
    return mock;
}
