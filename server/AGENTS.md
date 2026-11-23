# Server instructions

Read the root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md)
before changing API or service behavior.

- Define request handlers with `Context<HonoConfig>` so Worker bindings and
  middleware variables remain typed.
- Mount API routes through the app in `server/index.ts`; do not bypass its
  middleware ordering or the app-level `notFound` response.
- Keep database access in Drizzle and schema-first migrations. For joined D1
  reads, project only the columns the caller needs; a result set is limited to
  100 columns.
- Scope tenant reads and writes from verified request context.
- Put validation schemas in `server/lib/validations/` and update API references
  when a request or response contract changes.
- Put server tests in `tests/unit/<domain>/`; use `tests/workers/` only when the
  test needs real workerd semantics.
