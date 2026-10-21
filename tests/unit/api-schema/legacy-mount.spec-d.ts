import { describe, it, expectTypeOf } from 'vitest';
import type { hc } from 'hono/client';
import type { ApiOf, LegacyMounted } from '../../../server/lib/api-schema';
import type totpRoutes from '../../../server/api/auth/totp';
import type icsLinkRoutes from '../../../server/api/calendar-ics-links';

type ClientOfChain<T extends import('hono').Hono<any, any, any>> = ReturnType<typeof hc<T>>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only. A child that is still a chain is mounted with `legacyMounted(prefix, router)`; its schema is the
// router's own, so the client built from a parts list that holds it must expose exactly what the chain's client does.
describe('legacy mounts', () => {
    it('a lone legacy mount at the root has the chain client of that router', () => {
        type Mounted = ApiOf<readonly [LegacyMounted<'/', typeof totpRoutes>]>;
        expectTypeOf<Keys<ClientOfChain<Mounted>>>().toEqualTypeOf<Keys<ClientOfChain<typeof totpRoutes>>>();
        expectTypeOf<Keys<ClientOfChain<Mounted>>>().not.toBeNever();
    });

    it('a legacy mount under a prefix moves every path under it', () => {
        type Under = ApiOf<readonly [LegacyMounted<'/ics', typeof icsLinkRoutes>]>;
        expectTypeOf<Keys<ClientOfChain<Under>>>().toEqualTypeOf<'ics'>();
        expectTypeOf<Keys<ClientOfChain<Under>>>().not.toEqualTypeOf<Keys<ClientOfChain<typeof icsLinkRoutes>>>();
    });
});
