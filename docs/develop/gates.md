# Quality gates

Beyond `tsc`, `eslint` and the test suites, this repository runs a set of small
conformance checks — the gates. They catch the class of defect that type checking
and unit tests structurally cannot: a rule that spans files, a convention that
only matters at a boundary, a claim in a comment that the code stopped honouring.

This page explains how they are wired and why. For *which* gate runs at which
point in the workflow, see [testing.md](./testing.md).

## The registry is the list

`scripts/lib/gate-registry.mjs` is the single declaration of every gate. An entry
names the script, the label a reader sees, the command that fixes a failure, and
the rung that pays for it:

```js
{ key: 'ds', label: 'DS token conformance', script: 'check-ds-tokens.mjs',
  fix: 'npm run lint:ds', rung: PRECOMMIT }
```

Two rungs:

- **`PRECOMMIT`** — every commit. Adding a gate here costs every commit anyone
  makes, so the bar is high: it should be fast, and it should catch something
  that is expensive to discover later.
- **`PUSH`** — the full `npm run lint`, which is what runs before a push and what
  CI's verify job runs. A push-rung run includes everything at pre-commit; a
  pre-commit run does not include push.

`scripts/run-gates.mjs` executes them. It imports each gate into **one node
process** rather than spawning `npm run` per gate.

## Why one process, and what the real argument is

The obvious argument is speed, and it is the weaker one. It is also easy to
overstate, which happened here: an early estimate of "110 seconds of process
startup against 9 seconds of checking" was measured and came back as **43 seconds
for the whole push-rung run** on an idle machine. Worse for the argument, the
per-spawn cost is a *Windows* cost — roughly 2.3 s locally against about 0.15 s
on Linux, so CI pays 14–19 seconds for the same set and never had the problem.

⚠️ **Record free RAM alongside any timing you take here.** Measurements on a
developer machine move by 2–3× under load, so a before/after pair taken at
different times means nothing.

The argument that actually justifies the design is **short-circuiting**. A chain
of `npm run a && npm run b && npm run c` stops at the first failure, so each
broken gate hides every gate behind it and costs a whole round trip to reveal the
next one. Measured on one pull request: a run died at gate 12, and the run 17
minutes later died at gate 42. Fixing the twelfth is what exposed the
forty-second.

The runner has no `&&`. It runs every gate regardless of what failed, and reports
every violation in one pass.

## The gate that guards the gates

Once `npm run lint` stops enumerating gates by name, a new `lint:*` script can be
added to `package.json`, registered nowhere, and **run on no rung at all** — green
forever, checking nothing.

`scripts/check-gate-registry.mjs` closes that. It compares the `lint:*` scripts
that exist against the registry and fails on a gate that belongs to neither the
registry nor a declared exclusion list. The exclusions are aggregates and the two
checks that must keep their own process; each is named in `UNREGISTERED` with its
reason, so an exclusion is a decision somebody wrote down rather than an
omission nobody noticed.

## Results are cached on their inputs

`scripts/lib/gate-stamp.mjs` stamps a gate's result against a hash of what it
read, so running a gate by hand and then letting the hook run it again costs
almost nothing the second time. A cache hit prints `<gate>: cached (…)`, which
means *inputs unchanged* — not *skipped*.

Failing runs are never cached, and any flag (`--update`) bypasses the cache.
`GATE_CACHE=0` disables it entirely.

## Writing a gate

Two conventions matter more than the checking logic.

**Print both numbers.** A gate must report how much it examined as well as how
much it found. A run that scanned zero files and found zero problems prints the
same reassuring zero as a clean repository, and this project has been misled by
exactly that more than once. Make an empty scan a *failure*, and say so in the
output.

**Self-test the detector.** A gate that cannot demonstrate it still detects
anything is a gate that passes because its scan broke. Several gates here carry
fixtures that must flag and fixtures that must not, run on every invocation, and
refuse to report on the repository if their own fixtures come back wrong. The
must-not-flag half matters as much as the other: a detector tightened until it
catches everything catches noise, and the exemption it grows is never reviewed.

Two smaller rules follow from how the runner works:

- Call `process.exit()` on failure, not `process.exitCode`. The runner traps
  `process.exit` and turns it into a result; a script that only sets
  `process.exitCode` is reported as a pass.
- An entry-point guard (`import.meta.url === process.argv[1]`) is fine. The
  runner sets `process.argv[1]` to the script path for exactly this reason.

## Memory, honestly

`.githooks/pre-commit` exports a `NODE_OPTIONS` heap cap. It bounds the build
behind the bundle-size gate, the duplicate-code check, and eslint when it is not
invoked through its own script.

⚠️ **It does not bound `tsc`.** The type-check scripts pass an explicit
`--max-old-space-size` on the command line, and an explicit flag beats
`NODE_OPTIONS`. That number cannot simply be lowered either: CI runs cold with no
incremental build info present and fails below it.

So the honest statement is that a single pre-commit can reach several gigabytes,
and two running at once can exhaust a developer machine. The cap does not prevent
that — **serialising the commits does.** If you are running more than one working
copy of this repository, commit in one at a time.

## The PR verification record (`pr-readiness`)

CI-green is not a review. Every pull request body carries a `## Verification`
block, and a separate check (`.github/workflows/pr-readiness.yml`, job
`pr-readiness`) reads it. The PR template pre-fills the block with
placeholders the check rejects until you edit them.

```
## Verification
Code review: <who or what reviewed, 3+ words> — open findings: 0
Chrome: /<route> — light: ok, dark: ok — <what was seen>
```

- The reviewer must be independent (not "self" or "author") and open findings must be exactly `0`.
- If a UI file changed (anything under `app/` (plus `public/`, `messages/` and `packages/shared-ui/` in the engine; `app/content/` and `public/` in the portal); `.tsx/.css/.html/.svg/.png/.json/.ico/.woff*` under `server/` or `packages/`; `index.html`; the tailwind and vite config. Tests, `__mocks__/`, `*.stories.*`, `server/data/` and `server/generated/` do not count; for a renamed file the OLD path counts too), a `Chrome:` line is required: `Chrome: /route — light: ok, dark: ok — <what was seen>`. The route starts with `/`; the literal tokens `light: ok` and `dark: ok` (any case, any order, separated by comma, semicolon or space) must both be there; the observation after the last dash is at least 15 characters. Any other value (`not checked`, `skipped`, `pending`, anything) fails. `dark: n/a` is accepted only with a reason of at least 4 words in parentheses, e.g. `dark: n/a (this view has no dark theme styling at all)`. With no UI file changed, write `Chrome: n/a — no UI files changed`; the checker compares that claim with the PR's real file list and fails if UI files changed. The tokens are a written assertion by the author: the check makes a missing or evasive record impossible, not a false one. A line that carries `light: ok` and also says in words that it was not checked is outside what a text check can police.
- No `TBD`, `TODO`, `<...>` leftovers, or a bare "looks fine" / "lgtm".
- **A PR stays a draft until the block is true.** A draft always fails the check, by design.

Run it locally before merging:

```bash
npm run pr:merge-check -- --pr <number> --repo InspectorHub/OpenInspection
```

It prints PASS/FAIL per rule and `N rules checked, M failed`, and exits 1 on any failure.

The check is only a gate once it is required: **add `pr-readiness` to the required status checks in the repository ruleset** (Settings, Rules, the `main` ruleset, Require status checks). A workflow that is not required is advisory.

Formatting is forgiving (bold, backticks, list/quote/number prefixes, `--` or `:` as the route separator). Only the template tokens `<reviewer>`, `<n>`, `<route>`, `<who...>`, `<what was seen...>`, plus `TBD` and `TODO`, count as unfilled placeholders. Every `Code review:` and every `Chrome:` line must be valid. After `open findings: 0` only `(none)`, `(zero)`, `(all fixed)` or `(nothing left)` may follow. A failing rule prints a worked example. A quoted or indented `Code review:` line is accepted: the checker reads text, so formatting cannot make the record more or less true. A PR that reports zero changed files cannot claim `Chrome: n/a`.

**What it cannot do.** The record is self-attested text. The reviewer rule is an honour check: it rejects the words self, myself, author, me, own and same in the reviewer text, but cannot know who reviewed. It makes a missing record loud and verifies the UI-vs-n/a claim against the file list; it cannot prove a review or a browser check actually happened. The commit-message `Chrome:` record (`lint:chrome-record`) is a separate, earlier rung.

**Who judges the checker.** The workflow runs on `pull_request_target` and checks out only the base branch, so a PR cannot edit `scripts/pr-readiness.mjs` and pass its own check; it also means changes to `scripts/pr-readiness.mjs` and `.github/workflows/pr-readiness.yml` take effect only after merge and need a human diff review. The repository has no CODEOWNERS file, so this is a review convention, not an enforced one.

## Key files

| file | what it is |
|---|---|
| `scripts/lib/gate-registry.mjs` | every gate, its rung, and its fix command |
| `scripts/run-gates.mjs` | the runner — one process, no short-circuit |
| `scripts/check-gate-registry.mjs` | fails when a `lint:*` script is registered nowhere |
| `scripts/lib/gate-stamp.mjs` | input-hash caching |
| `.githooks/pre-commit` | the pre-commit rung |
| `scripts/pr-readiness.mjs` | the PR verification-record check (workflow and `npm run pr:merge-check`) |
