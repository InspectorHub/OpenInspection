import { defineConfig } from 'vitest/config';

/**
 * The live half of the contract suite — the questions only the real API answers.
 *
 * Separate from `vitest.contract.config.ts` because the two have opposite
 * operating requirements. The offline half is pure, parallel, and runs for
 * every contributor in CI. This one writes to a real company over the network,
 * needs credentials CI does not have, and must not run four files at once
 * against an API that rate-limits per company.
 *
 * `fileParallelism: false` is therefore a requirement, not a tuning choice, and
 * the timeout is generous because the unit of work is an Intuit round trip
 * rather than a function call.
 *
 * There is no retry. A flaky live contract spec is information — either the
 * connection is stale or Intuit changed something — and swallowing it under a
 * retry would turn the one lane that can see the wire into another lane that
 * reports what we expect.
 */
export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/contract/**/*.live.spec.ts'],
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
        retry: 0,
    },
});
