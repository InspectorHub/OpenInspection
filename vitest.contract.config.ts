import { defineConfig } from 'vitest/config';

/**
 * The contract suite — our payloads against a third party's own description of
 * its API.
 *
 * Its own config rather than a corner of `vitest.api.config.ts` because the two
 * suites answer different questions and fail for different reasons. A unit spec
 * asks "does this code do what we intended"; a contract spec asks "is what we
 * intended what the other side accepts". When one of these goes red the fix is
 * usually to change our code to match Intuit, not to change the assertion.
 *
 * `*.contract.spec.ts` is the OFFLINE half: it reads Intuit's vendored XSDs and
 * touches no network, so it runs in CI for every contributor. The live half
 * (`*.live.spec.ts`, sandbox credentials required) is a separate config over
 * the same directory — the same arrangement `tests/e2e/` already uses for its
 * seeded and integration variants.
 *
 * No aliases and no stubs: everything under test here is pure. If a spec in
 * this directory ever needs `cloudflare:workers` stubbed, it is not a contract
 * spec and belongs in `tests/unit/qbo/`.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/contract/**/*.contract.spec.ts'],
    },
});
