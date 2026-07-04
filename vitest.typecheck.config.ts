import { defineConfig } from 'vitest/config';

/**
 * Type-only test project (tests-reorg Task 6a, Decision 1).
 *
 * `expectTypeOf(...)` is a runtime no-op under plain `vitest run` — nothing
 * ever executes the type check, so a regression in the asserted type is
 * invisible (green-while-broken). This project runs NO runtime tests
 * (`test.include` is empty); it exclusively type-checks `tests/**\/*.spec-d.ts`
 * via `vitest --typecheck`, which shells out to `tsc` against
 * tsconfig.tests-typecheck.json and reports a failure for every
 * `expectTypeOf`/`assertType` assertion tsc can't satisfy.
 */
export default defineConfig({
  test: {
    include: [],
    typecheck: {
      enabled: true,
      include: ['tests/**/*.spec-d.ts'],
      tsconfig: './tsconfig.tests-typecheck.json',
    },
  },
});
