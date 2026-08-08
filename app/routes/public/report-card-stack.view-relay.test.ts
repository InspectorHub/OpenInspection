// @vitest-environment node
/**
 * OI #271 — the report page loader must relay the OUTER request's shape.
 *
 * The delivery-confirmation counter decides whether a render was a human
 * opening the report (`server/lib/report-views.ts`). Two of its signals — the
 * HTTP method, and the `Purpose` / `Sec-Purpose` prefetch hints — only exist on
 * the request the browser (or the mail-security scanner) actually made. The
 * loader's call into the in-process API is a fresh GET built by hono/client, so
 * a filter that reads them off THAT request is testable, green, and useless:
 * nothing hostile ever talks to `/api/public/report` directly.
 *
 * Reverting the relay makes every assertion below fail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RouterContextProvider } from 'react-router';
import { cloudflareContext } from '../../../app/lib/load-context';
import { loader } from '../../../app/routes/public/report-card-stack';

let seen: Request[] = [];

/**
 * A load context carrying an in-process API binding, which is what the worker
 * entry injects in production — so the loader takes its real path and we see
 * the Request it actually builds.
 */
function ctxWithApiWorker() {
    const provider = new RouterContextProvider();
    provider.set(cloudflareContext, {
        env: {
            API_WORKER: {
                fetch: async (req: Request) => {
                    seen.push(req);
                    // The loader tolerates a failed report fetch and returns
                    // defaults; all we care about is what it SENT.
                    return new Response('{}', { status: 500 });
                },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        ctx: undefined,
    });
    return provider;
}

beforeEach(() => { seen = []; });

/** The outgoing request for the report DATA route (not the brand lookup). */
function reportCall() {
    return seen.find((r) => r.url.includes('/api/public/report/'));
}

async function run(init?: RequestInit) {
    await loader({
        params: { tenant: 't', id: 'i' },
        request: new Request('https://x/report-view/t/i?token=tok', init),
        context: ctxWithApiWorker(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
}

describe('report-card-stack loader: request-shape relay (OI #271)', () => {
    it('relays the outer method as x-oi-client-method', async () => {
        await run({ method: 'HEAD' });
        expect(reportCall()?.headers.get('x-oi-client-method')).toBe('HEAD');
    });

    it('relays a plain GET as GET', async () => {
        await run();
        expect(reportCall()?.headers.get('x-oi-client-method')).toBe('GET');
    });

    it('relays the Purpose and Sec-Purpose prefetch hints', async () => {
        await run({ headers: { purpose: 'prefetch', 'sec-purpose': 'prefetch;prerender' } });
        const call = reportCall();
        expect(call?.headers.get('purpose')).toBe('prefetch');
        expect(call?.headers.get('sec-purpose')).toBe('prefetch;prerender');
    });

    it('sends no prefetch hints when the browser sent none', async () => {
        await run();
        const call = reportCall();
        expect(call?.headers.get('purpose')).toBeNull();
        expect(call?.headers.get('sec-purpose')).toBeNull();
    });
});
