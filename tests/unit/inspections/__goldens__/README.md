These files are the dashboard's response as the code produced it BEFORE its reads were reorganised
for fewer round trips (upstream main fc308568, `server/` untouched). They are a reference, not an
assertion about what the response ought to be.

How they were made: a separate worktree at fc308568, with only `dashboard-equivalence.spec.ts`,
`tests/unit/helpers/dashboard-fixture.ts` copied in, then

    GOLDEN_GENERATE=1 npx vitest run --config vitest.api.config.ts tests/unit/inspections/dashboard-equivalence.spec.ts

Do NOT regenerate them with `vitest -u` or by running the spec on the current code: that would make the
comparison agree with itself. A missing file fails the spec; recording needs GOLDEN_GENERATE=1 and the
old code. If the fixture changes, regenerate in such a worktree and say so in the commit.
