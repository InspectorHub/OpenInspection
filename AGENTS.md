# Agent instructions for OpenInspection

This repository is the public OpenInspection engine. Keep all source, comments,
documentation, commit messages and user-facing text in English. Do not add private
business strategy or customer-specific context.

[`CLAUDE.md`](CLAUDE.md) remains the canonical app-facing agent document. Read it
for the full architecture, security rules, database policy, and current
repository constraints. This file is a concise convention-based entry point;
directory-specific notes are in [`server/AGENTS.md`](server/AGENTS.md) and
[`app/AGENTS.md`](app/AGENTS.md). The documentation index is
[`docs/README.md`](docs/README.md).

## Commands and gates

- Install dependencies with `npm install`.
- Run the app with `npm run dev`; build with `npm run build`.
- Put API/service tests in `tests/unit/<domain>/`; put web tests beside the
  component under `app/`; use `tests/workers/` for behavior that needs workerd.
  See [`docs/develop/testing.md`](docs/develop/testing.md).
- Run the focused test while iterating. The commit hook handles its registered
  pre-commit checks. CI runs the full lint, tests, type checks and build; run the
  repo's documented full checks before proposing a PR.
- Run `npm run lint:english` before publishing public changes; English-only is
  checked in CI.

## Changes and documentation

- If a change matches a rule in [`docs/impact-map.json`](docs/impact-map.json),
  update a listed document in the same commit and add `Docs: docs/path.md` to
  the commit message. If no documentation change is appropriate, explain why:
  `Docs: n/a — <specific reason>`.
- Generated references are not hand-edited. Use the generator named in the
  document and run its `:check` command.
- Add or update a test that demonstrates changed behavior. A passing test proves
  only the behavior it exercises; compare important claims with the real code
  path and keep positive and negative controls for custom checkers.

## Boundaries

- Worker code uses Web APIs, not Node.js APIs.
- Use Drizzle for database access; avoid raw SQL outside the established
  migration, seed and test-fixture paths.
- Scope tenant data using the tenant identifier established by verified request
  context, never a client-supplied identifier.
- Use the shared submit-latch patterns for writes and the shared modal
  components for confirmation. Do not use `window.confirm`.
- Keep tokens and credentials out of source, tests, logs and generated docs.

## Pull requests

Use the repository PR template and contribution guide. Summarize the behavior,
tests, and documentation impact. Never commit secrets or generated local state.
