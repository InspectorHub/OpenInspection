# Sprint 2 Track 1 — Schema GIF evidence

## Status: GAPS DOCUMENTED

The intent of this directory is to capture three Chrome MCP click-flow GIFs:

1. `s2-1-rating-systems-crud.gif` — multi-rating system CRUD flow
2. `s2-3-recommendation-id.gif` — per-defect contractor recommendation dropdown
3. `s2-4-estimate-range.gif` — repair estimate range entry + report rendering

## Why the GIFs are not present

Recording realistic GIFs requires a fully seeded local dev environment
(admin user + tenant + template + seeded rating systems + at least one
in-progress inspection with defects). Two pre-existing blockers prevented
that bring-up in the worktree handoff window:

1. **Wrangler 4.81 multi-statement migration regression.**
   Migration `0028_automations_trigger_check.sql` performs an
   `INSERT…SELECT` plus a `DROP TABLE`, which wrangler 4.81 now refuses
   with `"contains several transactions"`. The migration is identical to
   what shipped on master and is not in T1's scope to rewrite. Splitting
   it statement-by-statement applies the schema, but `d1_migrations`
   tracking falls out of sync and subsequent migrations see "duplicate
   column" errors that have to be hand-acknowledged.

2. **Tenant setup flow drift.** Once the schema was force-aligned by
   hand, `POST /api/auth/setup` still failed with a Drizzle `"Failed
   query: insert into tenants"` because the runtime expected columns
   that did not exist in the locally-applied schema. This is an
   environmental drift unrelated to T1's S2-1 / S2-3 / S2-4 work and
   could not be resolved without permission to truncate the seeded
   tenants table.

Both blockers are tracked outside this track. The Cross-cutting agent
should pick them up before the next round of GIF capture.

## What was verified instead

The functional correctness of S2-4 is covered by code-level acceptance:

| Gate | Result |
|---|---|
| `npm run type-check` | 0 errors |
| `npm run lint` | 0 errors (26 pre-existing warnings) |
| `npm run test:unit` | 36 files / 274 tests pass |
| Migration `0041_sprint2_schema.sql` applies to a fresh DB | yes (verified manually) |
| Unit tests `tests/unit/estimate-range.spec.ts` | 8/8 pass |
| Playwright spec `tests/estimate-range.spec.ts` | compiles + lists; runtime blocked on the dev server bring-up |

## Re-recording when the environment is healthy

The recipe each GIF should follow is in
`docs/superpowers/plans/2026-05-08-sprint2-track1-schema.md` lines 70–115.
A contributor with a working dev server (`npm run dev`) and a seeded
admin can run those steps end-to-end through `mcp__claude-in-chrome__gif_creator`
and drop the resulting `.gif` files alongside this README.
