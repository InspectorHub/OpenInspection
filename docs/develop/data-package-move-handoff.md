# Data-package move: E2E and performance handoff

This page hands off the **verification harness** for moving a company between
two deployments with a data package. It is for an operator or maintainer who
needs to re-run or extend the checks, not a customer guide (that is
[`operate/move-to-self-host.md`](../operate/move-to-self-host.md)).

Everything here is engine-repo tooling. The desktop-app flow is exercised in
the app repo's `e2e-electron/data-package-move.spec.ts`. Nothing in this page
runs in the default CI suite: the dual-instance E2E needs two local engines and
the performance numbers are measurements, not gates.

## What exists

| Artifact | Purpose | Automated? |
|---|---|---|
| `tests/e2e/data-package-move.spec.ts` | Two-instance API E2E: set up an owner on each engine, preflight/apply into the target, prove isolation, undo. | Only under `playwright.move.config.ts` with `MOVE_E2E=1`. |
| `playwright.move.config.ts` | Starts source (`:8787`, `.wrangler/move-source`) and target (`:8789`, `.wrangler/move-target`) with separate D1/R2 state. | No shared `globalSetup`; each instance seeds itself. |
| `scripts/generate-move-fixture.mjs` | Builds a large, self-consistent format-1 package (rows across 5 tables, media volumes, signed-agreement shards, excluded classes) from a seed. | Run by hand; output verified by `verify-data-package.mjs`. |
| `scripts/measure-data-package-move.mjs` | Times preflight → plan → batches → media → archive → undo against a running target. Honest table; no deadline assertion. | Run by hand against two live instances. |
| `docs/operate/move-to-self-host.md` | Operator-facing end-to-end flow. | — |

## Run the dual-instance E2E

```bash
npm ci
npm run build -w @inspectorhub/data-package   # the spec imports the format encoders
npm run test:e2e:move
```

The npm script builds the engine once before Playwright starts two `wrangler dev` instances:

- source `http://127.0.0.1:8787`, persisting to `.wrangler/move-source`
- target `http://127.0.0.1:8789`, persisting to `.wrangler/move-target`

The spec creates an owner (`owner@move-test.com` / `MoveOwner123!`, setup code
`000000`) on each instance independently, assembles a small contacts-only
package with the same encoders the exporter uses, preflights and applies it into
the target, then loops the revert until `done`. It asserts the target's contact
count rises by exactly two after apply and returns to zero after undo. Because
the two instances have separate storage, this also proves a restore writes only
into the target.

To re-run cleanly, delete `.wrangler/move-source` and `.wrangler/move-target`
first — setup returns 409 on a workspace that already has an owner, and the
harness treats that as fatal rather than silently reusing stale state.

`playwright.move.config.ts` is deliberately excluded from the default suite:
`playwright.config.ts` shares one worker and one D1 and cannot host a second
instance. The `lint:e2e-coverage` gate still counts the spec as owned (via the
`MOVE_E2E` switch it reads from the config), so adding a spec here does not
create an orphan.

## Generate a large fixture

```bash
npm run build -w @inspectorhub/data-package
node scripts/generate-move-fixture.mjs --out .tmp/move-large \
  --rows 20000 --media 200 --media-bytes 4096 --signed 25 --seed 1
node scripts/verify-data-package.mjs .tmp/move-large
```

The generator is deterministic for a given `--seed`: two runs with the same
options produce byte-identical packages, so a timing change is a real change
and not fixture drift. It contains only synthetic plaintext. The offline
verifier must report all checks passing before the fixture is trusted; a
package that runs zero checks is a failure, never a pass.

Coverage of the fixture: five tables with paid/unpaid and dated rows, one signed
agreement shard with a mix of completed and pending envelopes and rotating-key
style hashes, media split across numbered volumes, and the three excluded
classes (`withheld_secret`, `external_media`, `mode_bound`).

## Measure a restore

Start two instances (the E2E config's `webServer` commands are a template), then
obtain an owner bearer on the target (log in through the app or use a native
OAuth token). Supply that bearer and the owner password; the script mints a
**fresh** step-up token before each privileged call:

- `data-export-start` — required to create the import job (for both directions)
- `data-import-apply` — required for each batch/media/archive write
- `data-import-revert` — required for each undo step

Step-up is obtained by POSTing `{ "action": "...", "password": "..." }` to
`/api/auth/step-up` with the owner bearer. For a session JWT the single-use
token comes back in the `__Host-step_up` Set-Cookie (a native OAuth bearer gets
it in `data.token`); it is valid for five minutes and is consumed on first use,
so the script mints a new one per call rather than reusing one.

```bash
TARGET_URL=http://127.0.0.1:8789 \
TARGET_BEARER=<owner bearer> \
OWNER_PASSWORD=<owner password> \
node scripts/measure-data-package-move.mjs --fixture .tmp/move-large --batch 1000
```

The script reads the generated package, applies rows in the referential tiers
returned by `GET .../import/plan`, uploads media from the volumes, stores the
evidence archive (refusing to call an unverified archive a success), then loops
the revert (reporting any row deletion errors). It prints a per-phase timing
table and a total. It never logs in, never prints a secret, and reads only files
under `--fixture`. Add `--no-revert` to measure the restore without the undo.

**Free-tier honesty.** The D1 daily write allowance may cap a large import
within one day. A run that stops with "stopped for today" is a recorded result,
not a failed test: resume on a later day or use a paid plan. The harness does
not assert a wall-clock deadline on a shared machine.

## Matrix the harness does not cover automatically

The following are owner-verified by walking the **desktop app** against the two
instances in Chrome/Electron; they are recorded here as a checklist, not as
assertions:

- [ ] Light and dark theme, and a narrow (phone) width, on the leave and arrive
      wizard screens (the app repo's `data-package-visual.local.spec.ts` drives
      the real window; a person must still look at each screenshot).
- [ ] Multi-signer signed agreement with a rotating key: the destination shows
      the read-only archive, `verifyEvidenceChainDetailed` reports zero problems,
      and no live signing table row is created.
- [ ] A report gated before the move (agreement or payment outstanding) is
      still gated after — the gate is carried over, not re-evaluated.
- [ ] A client report link, a `/v/:token` link from an old PDF, and a signing
      link each behave per the deployment-mode matrix after cut-over.
- [ ] Killing the desktop app mid-import and reopening resumes without
      duplicating rows; applying the same package twice creates nothing new.
- [ ] A hostile package (path traversal entry, bad digest, newer format, ZIP64)
      is refused at local preflight with a clear message and nothing is sent.
- [ ] Undo deletes every imported row and photo including edits made since the
      import, and the irreversible confirmation is explicit.
- [ ] The import sends no email, text message or webhook.

Record what you actually saw (and the two-instance IDs / fixture seed) in the
PR that lands a change in this area — a green harness is not evidence that a
person looked at the screen.
