/**
 * Invariants for the conformance-gate registry.
 *
 * The registry is the only place that says which gates exist and which rung
 * runs them, so a typo here is a gate that silently never runs. These tests
 * are the reason a typo cannot be silent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Gate = { key: string; label: string; script?: string; fix: string; rung: string; args?: string[] };

let SCRIPT_GATES: Gate[];
let DUP_GATE: Gate;
let UNREGISTERED: Map<string, string>;
let PRECOMMIT: string;
let PUSH: string;
let scripts: Record<string, string>;
let ROOT: string;

beforeAll(async () => {
    // Resolved from cwd and then ASSERTED. The relative-from-`import.meta.dirname`
    // form this was drafted with resolved to `D:\` under vitest, and the only
    // symptom was `Cannot find module D:\scripts\lib\gate-registry.mjs` — a
    // wrong root wearing the costume of a missing file. Checking for
    // package.json makes the root itself the thing that fails.
    ROOT = process.cwd();
    expect(
        existsSync(path.join(ROOT, 'package.json')),
        `ROOT resolved to ${ROOT}, which has no package.json — the suite is not running from the repo root`,
    ).toBe(true);
    const url = pathToFileURL(path.join(ROOT, 'scripts/lib/gate-registry.mjs')).href;
    // @vite-ignore — load the .mjs natively; vitest's transform cannot process it.
    ({ SCRIPT_GATES, DUP_GATE, UNREGISTERED, PRECOMMIT, PUSH } = await import(/* @vite-ignore */ url));
    scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
});

describe('gate registry', () => {
    it('gives every gate a known rung', () => {
        for (const g of [...SCRIPT_GATES, DUP_GATE]) {
            expect([PRECOMMIT, PUSH], `${g.key} has rung "${g.rung}"`).toContain(g.rung);
        }
    });

    it('has unique keys', () => {
        const keys = [...SCRIPT_GATES, DUP_GATE].map((g) => g.key);
        expect(keys.length, `duplicate key in ${keys.join(',')}`).toBe(new Set(keys).size);
    });

    it('points every gate at a script file that exists', () => {
        for (const g of SCRIPT_GATES) {
            expect(existsSync(path.join(ROOT, 'scripts', g.script!)), `missing scripts/${g.script}`).toBe(true);
        }
    });

    it('points every gate fix at a real npm script', () => {
        for (const g of [...SCRIPT_GATES, DUP_GATE]) {
            const name = g.fix.replace(/^npm run /, '');
            expect(scripts[name], `${g.key}.fix names "${name}", which package.json does not define`).toBeDefined();
        }
    });

    it('keeps the precommit rung to exactly the gates pre-commit ran before consolidation', () => {
        // Locked deliberately: pre-commit is the fastest rung and the one every
        // commit pays. Adding a gate here is a cost decision, so it has to be
        // made by editing this list, not by forgetting to set a rung.
        const EXPECTED_PRECOMMIT = [
            'ds', 'contrast', 'svg', 'migrefs', 'filesize', 'tz', 'idempotency',
            'extcollide', 'price', 'zerotrack', 'aiclass', 'teststsconfig',
            'submitguard', 'seedsql', 'dup',
            // Added 2026-08-18 with the coverage gate, and this edit is the
            // decision the lock exists to force. It earns pre-commit on the
            // same argument as the price and tracking gates: what it catches is
            // a `lint:*` script ARRIVING with no rung, which is cheapest to
            // answer while the line is being typed and is invisible by
            // construction afterwards. Cost is two file reads and a set
            // difference — measured, the rung went 15 gates to 16 and stayed
            // at 6s.
            'gateregistry',
            // Added 2026-08-23 with the Chrome-record judge, and this edit is
            // again the decision the lock exists to force. What runs here is
            // ONLY `--self-test`: the judge scored against its own 30 labelled
            // examples. The judging itself is commit-msg, not this rung.
            //
            // It earns pre-commit on the same argument as `gateregistry`
            // above: what it catches is the judge silently disagreeing with
            // its own fixtures, which is invisible by construction — a broken
            // judge reports PASS on everything, so nothing downstream goes red
            // and the gate reads as green on the day it stopped working.
            // Cost is one node start and 30 string matches, no file walk.
            'chromerecord',
            // Added 2026-08-23 with the private-review gate, and this is the
            // third time the lock has done its job in one day.
            //
            // It earns pre-commit on an argument none of the others can make:
            // what it catches goes into a PUBLIC repository's permanent
            // history. Every other gate here protects something a later commit
            // can still fix. This one protects something that, once pushed,
            // cannot be fixed at all — a force-push does not reach a clone, a
            // fork, or anyone who already read it. The window in which the
            // repair is a one-line edit closes when the commit is created.
            // Measured at 0.67s over 3,605 files, so the rung costs nothing.
            'privatereview',
            // Added 2026-08-24 with the agent-terms route classification, and
            // the lock caught it: the gate was registered at this rung without
            // this entry, so `npm run test:unit` went red on a tree whose
            // pre-commit hook and pre-push hook were both green. That is the
            // lock working, not failing — this rung is the one place where
            // joining is supposed to cost an argument.
            //
            // It earns pre-commit on the family argument: what it catches is a
            // route added with no classification row, and an unclassified route
            // is simply absent from the exemption reckoning. Nothing goes red;
            // the gate that decides whether an agent must accept the terms just
            // answers nothing for that path. A green run that means less than
            // it looks like — the same shape as `gateregistry` and
            // `chromerecord` above.
            //
            // It is not hypothetical. When this gate was designed the plan
            // named five unclassified routes; the real universe was 25, and the
            // preference routes mount from `server/api/agent.ts` rather than
            // `server/index.ts`, so a parser reading only the index would have
            // reported a clean run over 20 routes and missed five in silence.
            // Cost: parses ~12 source files with the TypeScript parser,
            // single-digit milliseconds in the shared process.
            'agenttermsclass',
            // Added 2026-08-25 with the tenant_configs split, and the lock did
            // its job again: registered at this rung without this entry, so the
            // full run went red on a tree whose pre-commit hook was green.
            //
            // It earns pre-commit on a different argument from the others. This
            // one does not catch a green run that means less than it looks
            // like — it catches a change that CANNOT WORK, and catches it at the
            // only moment the fix is cheap. D1 refuses a CREATE TABLE above 100
            // columns, and what crosses that line is always one person adding
            // one column. At the push rung the schema, the migration and the
            // hand-maintained inline DDL have all already been written against
            // a shape the database will not accept, and if it reaches a
            // deployed table the only way back is an expand-migrate-contract
            // sequence spanning several deploys.
            //
            // Not hypothetical: tenant_configs hit exactly 100 and the next
            // column could not be added at all. Nothing in the tree noticed —
            // db:check compares schema against migrations and is equally happy
            // with 101 in both. Cost: reads the schema directory, ~40ms.
            'columnceiling',
            // Added 2026-08-31, and NOT with the gate it names: `itemkeyparity`
            // joined the rung on 2026-08-29 without this entry, so this spec had
            // been red on the branch ever since while every pre-commit and
            // pre-push hook stayed green. That is the third time the lock has
            // caught exactly this, and the second where the red outlived the
            // commit that caused it — a full `test:unit` is the only thing that
            // runs it, and this branch had not had one.
            //
            // The argument is the one its registry entry already makes, quoted
            // rather than re-invented: what it catches IS a keystroke — a key
            // added to `TemplateItem` and not added to the six mirrors that
            // strip it, never serialize it, or simply do not read it, none of
            // which errors. The damage lands the moment the commit exists, and
            // the author is the only person who will ever know which of the
            // seven they meant to change. Six files, six parsers, milliseconds.
            'itemkeyparity',
            // Added 2026-08-30 with the raw-NUL gate, and the lock did its job
            // a fourth time: registered at this rung without this entry, so the
            // full run went red on a tree whose pre-commit and pre-push hooks
            // were both green.
            //
            // It earns pre-commit on `privatereview`'s argument, which no other
            // gate here can make: THE REPAIR STOPS BEING FREE THE MOMENT THE
            // COMMIT EXISTS. A single NUL byte makes a whole file binary to git
            // grep, ripgrep and every diff, and fixing the file does not fix
            // its history — the commit that introduced it still shows
            // `Bin 6576 -> 6577 bytes` with no line-level diff, forever, and so
            // does every `git log -p` and `git blame` that crosses it. Caught
            // before the commit it is one character; caught after, the fix
            // repairs the working tree and leaves the record unreadable.
            //
            // It is also invisible by construction, which is why nothing else
            // reports it: the file compiles, behaves identically and passes
            // every other gate here. Three arrived independently in unrelated
            // subsystems and the oldest went unnoticed for months.
            // Cost: one `git ls-files` and an indexOf per file — 0.33s over
            // 3,940 files, measured three times.
            'rawnul',
        ].sort();
        const actual = [...SCRIPT_GATES, DUP_GATE].filter((g) => g.rung === PRECOMMIT).map((g) => g.key).sort();
        expect(actual).toEqual(EXPECTED_PRECOMMIT);
    });

    it('registers every node-script gate the lint chain used to invoke', () => {
        // Before consolidation `npm run lint` chained these by hand. The chain is
        // the historical source of truth for what the full run covered, so it is
        // what the registry is checked against — not a list retyped from memory.
        // Verified 2026-08-19 against package.json: this is exactly `lint` and
        // exactly `lint:gates-full`, same members, same order. `lint:docs-markers`
        // left the list when the user-guide prose left this repository — the
        // marker gate went with the files it reads.
        const CHAINED_NODE_GATES = [
            'lint:ds', 'lint:contrast', 'lint:svg', 'lint:erasure', 'lint:retention',
            'lint:retention-policy', 'lint:processing-stores', 'lint:platform-defaults',
            'lint:non-translatable', 'lint:migrefs', 'lint:migchain', 'lint:english',
            'lint:filesize', 'lint:dup', 'lint:tenant-scope', 'lint:status-literals',
            'lint:capability-decl', 'lint:capability-readers', 'lint:mode-disguises',
            'lint:price-capability', 'lint:zero-tracking', 'lint:ai-classification',
            'lint:provider-helpers', 'lint:notification-dispatch', 'lint:tests',
            'lint:tests-tsconfig', 'lint:test-imports', 'lint:deadcode', 'lint:timestamps',
            'lint:tz', 'lint:idempotency', 'lint:ext-collisions', 'lint:i18n',
            'lint:i18n-catalog', 'lint:i18n-glossary', 'lint:naming', 'lint:agent-routes',
            'lint:submit-guard', 'lint:doclinks', 'lint:seed-sql',
            'lint:schema-doc', 'lint:verification-copy', 'lint:fabricated-names',
            'lint:sigcompare', 'lint:signature-dynamics', 'lint:sms-gate-args',
            'lint:messaging-rules',
        ];
        const registered = new Set([...SCRIPT_GATES, DUP_GATE].map((g) => g.fix.replace(/^npm run /, '')));
        const missing = CHAINED_NODE_GATES.filter((n) => !registered.has(n));
        expect(
            missing,
            `${missing.length} of ${CHAINED_NODE_GATES.length} chained gates are unregistered: ${missing.join(', ')}`,
        ).toEqual([]);
        expect(CHAINED_NODE_GATES.length).toBe(47);
    });

    it('passes --check to the schema-doc gate, which is a generator by default', () => {
        const schemaDoc = SCRIPT_GATES.find((g) => g.script === 'gen-schema-doc.mjs');
        expect(schemaDoc, 'gen-schema-doc.mjs is not registered').toBeDefined();
        // Without --check this script WRITES docs/reference/database-schema.md.
        // A gate that rewrites the file it is checking always passes.
        expect(schemaDoc!.args).toEqual(['--check']);
    });

    it('runs the copy-policy gates against the repository, not against their own fixtures', () => {
        // Both copy gates accept `--self-test`: they score their patterns against
        // a labelled must-flag / must-not-flag list, print "self-test OK" and
        // exit 0 WITHOUT reading a single catalogue. That is a useful mode and a
        // dangerous registration — registered with those args, the gate passes
        // forever while looking at nothing, which is this repository's oldest
        // failure shape.
        //
        // The shape is not hypothetical here: `chromerecord` a few rows above is
        // registered exactly that way, deliberately, so the pattern is sitting
        // in the same file waiting to be copied onto a gate whose whole value is
        // the scan. This locks the two that must never take it.
        for (const key of ['verificationcopy', 'endorsementcopy']) {
            const gate = SCRIPT_GATES.find((g) => g.key === key);
            expect(gate, `${key} is not registered`).toBeDefined();
            expect(
                gate!.args,
                `${key} is registered with args ${JSON.stringify(gate!.args)} — a copy gate that runs `
                + 'its self-test instead of its scan reports a clean catalogue it never opened',
            ).toBeUndefined();
            expect(gate!.rung, `${key} should stay on the push rung`).toBe(PUSH);
        }
    });

    it('summarises a run with both numbers, not just the failures', async () => {
        // A runner that prints only failures reads as "all clear" on the day it
        // silently ran nothing. The summary has to state how many gates ran.
        const { execFileSync } = await import('node:child_process');
        const out = execFileSync(process.execPath, ['scripts/run-gates.mjs', '--only', 'ds'], {
            cwd: ROOT, encoding: 'utf8',
        });
        expect(out).toMatch(/gates: 1 selected of \d+/);
        expect(out).toMatch(/1 passed · 0 failed · \d+ not selected/);
    });

    it('REFUSES a selection that matches no gate, instead of reporting a clean run', async () => {
        // Measured before this existed: `--only nonexistent-gate` exited 0 with
        // NO output at all. A typo in the hook would have read as "gates
        // passed" — the emptiest possible false green, and the one this repo
        // has met most often. Zero selected is a failure, never a pass.
        const { execFileSync } = await import('node:child_process');
        let code = 0;
        let out = '';
        try {
            out = execFileSync(process.execPath, ['scripts/run-gates.mjs', '--only', 'nonexistent-gate'], {
                cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            const e = err as { status?: number; stdout?: string; stderr?: string };
            code = e.status ?? 0;
            out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        expect(code, 'selecting zero gates must not exit 0').not.toBe(0);
        expect(out).toMatch(/0 selected/);
    });

    it('accounts for every lint:* script in package.json', () => {
        const lintScripts = Object.keys(scripts).filter((k) => k.startsWith('lint:'));
        const registered = new Set([...SCRIPT_GATES, DUP_GATE].map((g) => g.fix.replace(/^npm run /, '')));
        const excluded = [...UNREGISTERED.keys()].filter((k) => k.startsWith('lint:'));
        const orphans = lintScripts.filter((k) => !registered.has(k) && !UNREGISTERED.has(k));
        expect(
            orphans,
            `${orphans.length} of ${lintScripts.length} lint:* scripts run on no rung and have no exclusion reason: ${orphans.join(', ')}`,
        ).toEqual([]);
        // Both numbers, always — an assertion that only fires on drift is one
        // nobody can check on the day it is green.
        expect(registered.size + excluded.length).toBe(lintScripts.length);
    });

    it('does not carry exclusion reasons for scripts that no longer exist', () => {
        const stale = [...UNREGISTERED.keys()].filter((k) => !(k in scripts));
        expect(stale, `UNREGISTERED names ${stale.join(', ')}, absent from package.json`).toEqual([]);
    });

    it('carries a reason for every npm script it deliberately does NOT register', () => {
        // An exclusion with no reason is indistinguishable from an oversight,
        // and this map is the only thing standing between "we chose not to run
        // it" and "nobody noticed it stopped running".
        expect(UNREGISTERED.size, 'no exclusions recorded — the map exists to be non-empty').toBeGreaterThan(0);
        for (const [name, reason] of UNREGISTERED) {
            expect(scripts[name], `UNREGISTERED names "${name}", which package.json does not define`).toBeDefined();
            expect(String(reason).trim().length, `${name} is excluded with an empty reason`).toBeGreaterThan(10);
        }
    });
});
