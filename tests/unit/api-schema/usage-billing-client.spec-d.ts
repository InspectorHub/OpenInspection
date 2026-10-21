import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { UsageApi } from '../../../server/api/usage';
import type { BillingApi } from '../../../server/api/billing';

type UsageClient = ReturnType<typeof hc<UsageApi>>;
type BillingClient = ReturnType<typeof hc<BillingApi>>;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). Both routers register a single GET /summary whose 200 response
// declares no body schema, so only the shape of the client (path segments and methods) can be pinned.
describe('UsageApi and BillingApi clients (one GET /summary each)', () => {
    it('UsageApi exposes only GET summary', () => {
        expectTypeOf<keyof UsageClient>().toEqualTypeOf<'summary'>();
        expectTypeOf<Keys<UsageClient['summary']>>().toEqualTypeOf<'$get'>();
    });

    it('BillingApi exposes only GET summary', () => {
        expectTypeOf<keyof BillingClient>().toEqualTypeOf<'summary'>();
        expectTypeOf<Keys<BillingClient['summary']>>().toEqualTypeOf<'$get'>();
    });

    it('neither exposes a write or another path', () => {
        // @ts-expect-error usage is read-only
        type NoPost = UsageClient['summary']['$post'];
        expectTypeOf<NoPost>().toBeAny();
        // @ts-expect-error billing has no other path
        type Missing = BillingClient['portal'];
        expectTypeOf<Missing>().toBeAny();
    });
});
