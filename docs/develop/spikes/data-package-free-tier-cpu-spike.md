# Spike: free-tier CPU budget for the data-package read API

> A spike's throwaway probe code is disposable; its verdict is not. The local
> probe used below was never committed — its result is recorded here so the
> conclusion is reproducible without leaving a dead script in the tree.

**Verdict: DEFERRED — not honestly measurable without production CPU telemetry.**
Keep the conservative page ceilings in `pageCeilings`
(`server/lib/data-package/read-metadata.ts`): 48 rows / 96 KiB on the Workers
free tier, 1000 rows / 4 MiB on paid. Do not derive a local-to-Workers CPU
factor from the numbers below.

## Question

What is the largest keyset page the export read endpoint
(`GET /api/admin/data-package/jobs/:id/tables/:table/rows`) can return while
staying safely inside the Cloudflare Workers free-tier CPU budget (10 ms per
request)? The page size trades request count against per-request CPU, so it
should be set from a real measurement, not a guess.

## Why DEFERRED

1. **Local miniflare does not enforce the CPU ceiling.** A throwaway probe ran a
   worker that busy-waits ~150 ms (well over 10 ms) constructed with
   `new Miniflare({ limits: { cpu_ms: 10 }, modules: true, ... })` on the pinned
   `miniflare@4`. It returned `200` for both `cpu_ms=10` and `cpu_ms=100`. The
   config value is validated and forwarded, but no local enforcement was
   observed — so "does a page read get killed at 10 ms" cannot be answered here.
2. **A Workers-to-local CPU factor needs a Workers-side number.** Cloudflare
   publishes no page-size, batch-size or CPU-conversion guidance. Any ratio
   computed from local timings alone has no production operand and is therefore
   a guess. The only sound source is the deployed Worker's own CPU-per-request
   metric.
3. **CPU enforcement has headroom, but that is not a design budget.** Field
   observations show free-tier requests occasionally passing well above 10 ms
   while others are killed near it. Enforcement varies with distance from the
   ceiling; target the published figure with margin rather than relying on the
   slack.

## Unlock condition and method

Once the API is deployed somewhere its per-request CPU time can be observed:

1. Keep the current 48-row / 96 KiB ceiling and run a real export of a
   representative tenant.
2. From Workers observability, record CPU time and `meta.rows_read` per page —
   the widest `blobColumns` table is the worst case, plus one narrow table.
3. Replay the identical page-read workload locally with the same row shapes and
   keyset query, and compare several samples rather than one.
4. If the 48-row page fits the budget with margin (target ≤5 ms CPU), keep it.
   Only if it does not, lower `maxPageRows` in `pageCeilings` and re-run the
   read-service tests. Apply the same method to import batch sizes when that
   path is added.

## Current decision

Keep the conservative constants. A page read is one small keyset query (48 rows,
≤96 KiB), and the paid tier has a 30 s default CPU budget, so deferring the
measurement does not block correctness. The verification debt is recorded here
rather than hidden in an assumed CPU factor.
