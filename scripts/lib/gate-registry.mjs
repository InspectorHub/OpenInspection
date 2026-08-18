/**
 * The conformance-gate registry.
 *
 * One list, no side effects: the runner imports it to run gates, the
 * gate-registry gate imports it to prove nothing fell out of the chain, and the
 * spec imports it to check its invariants. Keeping it separate from
 * `run-gates.mjs` is what lets those other two consumers read it without
 * running every gate as an import side effect.
 *
 * `rung` says which ladder rung pays for the gate:
 *   PRECOMMIT — every commit. Adding one here costs every commit in the repo,
 *               so each entry below carries the argument for why it earns that.
 *   PUSH      — the full `npm run lint`, i.e. pre-push and CI's verify job.
 * A run at PUSH includes everything at PRECOMMIT; a run at PRECOMMIT does not
 * include PUSH.
 */
export const PRECOMMIT = 'precommit';
export const PUSH = 'push';

/** Gates that are plain node scripts in this repo. */
export const SCRIPT_GATES = [
    { key: 'ds', label: 'DS token conformance', script: 'check-ds-tokens.mjs', fix: 'npm run lint:ds', rung: PRECOMMIT },
    { key: 'contrast', label: 'Small-text WCAG AA contrast', script: 'check-contrast.mjs', fix: 'npm run lint:contrast', rung: PRECOMMIT },
    { key: 'svg', label: 'SVG dimensions', script: 'check-svg-dimensions.mjs', fix: 'npm run lint:svg', rung: PRECOMMIT },
    { key: 'migrefs', label: 'Migration-reference hygiene', script: 'check-migration-refs.mjs', fix: 'npm run lint:migrefs', rung: PRECOMMIT },
    { key: 'filesize', label: 'Large-file ratchet', script: 'check-file-size.mjs', fix: 'npm run lint:filesize', rung: PRECOMMIT },
    { key: 'tz', label: 'Calendar timezone-safety', script: 'check-tz-safety.mjs', fix: 'npm run lint:tz', rung: PRECOMMIT },
    { key: 'idempotency', label: 'Mutating-route retry safety', script: 'check-idempotency-coverage.mjs', fix: 'npm run lint:idempotency', rung: PRECOMMIT },
    // Pre-commit and not CI because a collision is created at exactly one moment
    // -- when a file is added or renamed -- and this is the rung that sees that
    // moment. It is also the rung where the fix is free: renaming a file nobody
    // has pulled yet costs nothing, renaming one after it lands costs everyone a
    // merge. An fs walk of ~2765 files, no parsing; among the cheapest here.
    { key: 'extcollide', label: 'Extension collisions (files invisible to tsc)', script: 'check-extension-collisions.mjs', fix: 'npm run lint:ext-collisions', rung: PRECOMMIT },
    // Belongs at pre-commit rather than CI: what it catches is a CAPABILITY
    // being added -- a money column, a money field on the inspection record, a
    // money input on a new screen. By the time CI sees one it is written and
    // argued for. ~0.1s inside this shared process.
    { key: 'price', label: 'Price capability inventory', script: 'check-price-capability.mjs', fix: 'npm run lint:price-capability', rung: PRECOMMIT },
    // Here for the same reason as the price gate: what it catches is a
    // CAPABILITY arriving -- a beacon, an analytics global, a pixel. By the time
    // CI sees one it is written and argued for, and "we already ship no
    // tracking" is much easier to hold than "please remove the tracking you
    // added". Costs ~0.8s (it reads ~976 client files), against ~0.1s for the
    // price gate -- the most expensive entry in this set, and still small next
    // to the eslint and tsc steps around it.
    { key: 'zerotrack', label: 'Zero client-side tracking', script: 'check-zero-tracking.mjs', fix: 'npm run lint:zero-tracking', rung: PRECOMMIT },
    // Third entry with the same justification, and the clearest case of it: what
    // it catches is an AI capability arriving with nobody having said what kind
    // of statement it produces, or reaching a model without going through the
    // one method that asks. The compiler already refuses an unclassified prompt;
    // this covers the second route to a provider, which no type can see. 0.4s,
    // between the price gate and the tracking gate.
    { key: 'aiclass', label: 'AI output classification', script: 'check-ai-classification.mjs', fix: 'npm run lint:ai-classification', rung: PRECOMMIT },
    // Two file reads and a set comparison -- the cheapest gate in this list by an
    // order of magnitude, and the one whose failure is most easily argued away
    // later. It belongs at pre-commit for the same reason the price and tracking
    // gates do: what it catches is a spec being written OFF the type-check, and
    // the moment to question that is while the line is being typed.
    { key: 'teststsconfig', label: 'tests tsconfig exclude ratchet', script: 'check-tests-tsconfig.mjs', fix: 'npm run lint:tests-tsconfig', rung: PRECOMMIT },
    // Pre-commit for the same reason as the price, tracking and AI gates: what it
    // catches is a raw `fetcher.submit` ARRIVING -- an unguarded mutation with no
    // idempotency key and no pending affordance. That is cheapest to argue about
    // while the line is being typed, and by the time CI sees one it is written.
    // An fs walk of ~680 client files with two regexes; comparable to the
    // tracking gate.
    { key: 'submitguard', label: 'Client submit-guard coverage', script: 'check-submit-guard.mjs', fix: 'npm run lint:submit-guard', rung: PRECOMMIT },
    // Pre-commit rather than CI, and for a reason the gates above do not share:
    // a seeder that nothing runs automatically has NO other rung. The CLI
    // self-host setup script is invoked by hand, months apart, so CI would never
    // report it — it rots until a human hits the error. The demo PCA seeder was
    // the same story and ended worse: twelve of its column names had drifted
    // away from the schema, its first INSERT could not run, and nobody found out
    // for months. It has since been retired into `tests/seed-fixtures.ts`, which
    // e2e globalSetup does run. That one still fails a rung LATE — several
    // minutes and one push after the mistake was typed — which is why this gate
    // reads it here instead.
    // Reads 31 files with two regexes.
    { key: 'seedsql', label: 'Seed SQL vs schema', script: 'check-seed-sql.mjs', fix: 'npm run lint:seed-sql', rung: PRECOMMIT },
    // The gate that guards this list. At PRECOMMIT because what it catches is a
    // `lint:*` script ARRIVING with no rung — cheapest to answer while the line
    // is being typed, and the check is two file reads and a set difference.
    { key: 'gateregistry', label: 'Gate-registry coverage', script: 'check-gate-registry.mjs', fix: 'npm run lint:gate-registry', rung: PRECOMMIT },

    // ---- PUSH rung -------------------------------------------------------
    // The 33 gates `npm run lint` used to chain with `&&`. Generated from
    // package.json rather than retyped, and pinned by the spec against that
    // same chain — the chain is the historical record of what the full run
    // covered, and a list typed from memory is how one quietly falls out.
    //
    // They sit at PUSH, not PRECOMMIT: each was in the pre-push/CI run before
    // this change and none of them was in the hook. Moving one down a rung is
    // a cost decision for every commit in the repo and belongs in its own
    // change, with the argument written beside it like the entries above.
    { key: 'erasure', label: 'lint:erasure', script: 'check-erasure-manifest.mjs', fix: 'npm run lint:erasure', rung: PUSH },
    { key: 'retention', label: 'lint:retention', script: 'check-retention-manifest.mjs', fix: 'npm run lint:retention', rung: PUSH },
    { key: 'retentionpolicy', label: 'lint:retention-policy', script: 'check-retention-policy.mjs', fix: 'npm run lint:retention-policy', rung: PUSH },
    { key: 'processingstores', label: 'lint:processing-stores', script: 'check-processing-stores.mjs', fix: 'npm run lint:processing-stores', rung: PUSH },
    { key: 'platformdefaults', label: 'lint:platform-defaults', script: 'check-platform-defaults.mjs', fix: 'npm run lint:platform-defaults', rung: PUSH },
    { key: 'nontranslatable', label: 'lint:non-translatable', script: 'check-non-translatable.mjs', fix: 'npm run lint:non-translatable', rung: PUSH },
    { key: 'migchain', label: 'lint:migchain', script: 'check-migration-chain.mjs', fix: 'npm run lint:migchain', rung: PUSH },
    { key: 'english', label: 'lint:english', script: 'check-english-only.mjs', fix: 'npm run lint:english', rung: PUSH },
    { key: 'tenantscope', label: 'lint:tenant-scope', script: 'check-tenant-scoping.mjs', fix: 'npm run lint:tenant-scope', rung: PUSH },
    { key: 'statusliterals', label: 'lint:status-literals', script: 'check-status-literals.mjs', fix: 'npm run lint:status-literals', rung: PUSH },
    { key: 'capabilitydecl', label: 'lint:capability-decl', script: 'check-capability-declarations.mjs', fix: 'npm run lint:capability-decl', rung: PUSH },
    { key: 'capabilityreaders', label: 'lint:capability-readers', script: 'check-capability-readers.mjs', fix: 'npm run lint:capability-readers', rung: PUSH },
    { key: 'modedisguises', label: 'lint:mode-disguises', script: 'check-mode-disguises.mjs', fix: 'npm run lint:mode-disguises', rung: PUSH },
    { key: 'providerhelpers', label: 'lint:provider-helpers', script: 'check-provider-helpers.mjs', fix: 'npm run lint:provider-helpers', rung: PUSH },
    { key: 'notificationdispatch', label: 'lint:notification-dispatch', script: 'check-notification-dispatch.mjs', fix: 'npm run lint:notification-dispatch', rung: PUSH },
    { key: 'tests', label: 'lint:tests', script: 'check-test-layout.mjs', fix: 'npm run lint:tests', rung: PUSH },
    { key: 'testimports', label: 'lint:test-imports', script: 'check-test-imports.mjs', fix: 'npm run lint:test-imports', rung: PUSH },
    { key: 'deadcode', label: 'lint:deadcode', script: 'check-deadcode.mjs', fix: 'npm run lint:deadcode', rung: PUSH },
    { key: 'timestamps', label: 'lint:timestamps', script: 'check-timestamps.mjs', fix: 'npm run lint:timestamps', rung: PUSH },
    { key: 'i18n', label: 'lint:i18n', script: 'check-i18n.mjs', fix: 'npm run lint:i18n', rung: PUSH },
    { key: 'i18ncatalog', label: 'lint:i18n-catalog', script: 'check-i18n-catalog.mjs', fix: 'npm run lint:i18n-catalog', rung: PUSH },
    { key: 'i18nglossary', label: 'lint:i18n-glossary', script: 'check-i18n-glossary.mjs', fix: 'npm run lint:i18n-glossary', rung: PUSH },
    { key: 'naming', label: 'lint:naming', script: 'check-naming.mjs', fix: 'npm run lint:naming', rung: PUSH },
    { key: 'agentroutes', label: 'lint:agent-routes', script: 'check-agent-routes.mjs', fix: 'npm run lint:agent-routes', rung: PUSH },
    { key: 'doclinks', label: 'lint:doclinks', script: 'check-doc-links.mjs', fix: 'npm run lint:doclinks', rung: PUSH },
    { key: 'docsmarkers', label: 'lint:docs-markers', script: 'check-docs-shots.mjs', fix: 'npm run lint:docs-markers', rung: PUSH },
    { key: 'schemadoc', label: 'lint:schema-doc', script: 'gen-schema-doc.mjs', fix: 'npm run lint:schema-doc', rung: PUSH, args: ['--check'] },
    { key: 'verificationcopy', label: 'lint:verification-copy', script: 'check-verification-copy.mjs', fix: 'npm run lint:verification-copy', rung: PUSH },
    { key: 'fabricatednames', label: 'lint:fabricated-names', script: 'check-fabricated-names.mjs', fix: 'npm run lint:fabricated-names', rung: PUSH },
    { key: 'sigcompare', label: 'lint:sigcompare', script: 'check-signature-compare.mjs', fix: 'npm run lint:sigcompare', rung: PUSH },
    { key: 'signaturedynamics', label: 'lint:signature-dynamics', script: 'check-signature-dynamics.mjs', fix: 'npm run lint:signature-dynamics', rung: PUSH },
    { key: 'smsgateargs', label: 'lint:sms-gate-args', script: 'check-sms-gate-args.mjs', fix: 'npm run lint:sms-gate-args', rung: PUSH },
    { key: 'messagingrules', label: 'lint:messaging-rules', script: 'check-messaging-rules.mjs', fix: 'npm run lint:messaging-rules', rung: PUSH },
];

export const DUP_GATE = { key: 'dup', label: 'Duplicate-code ceiling', fix: 'npm run lint:dup', rung: PRECOMMIT };

/**
 * npm scripts that are deliberately NOT gates, each with the reason.
 *
 * The registry is about to become the only thing that decides what runs, which
 * creates a new way to fail silently: add a `lint:*` script, register it
 * nowhere, and it is green forever because nothing ever calls it. The gate that
 * closes that (Task 4) needs somewhere to look up "this one is excluded on
 * purpose" — and an exclusion with no reason is indistinguishable from an
 * oversight, which is why the value is prose and not `true`.
 */
export const UNREGISTERED = new Map([
    ['lint:gates', 'the pre-commit rung entry point, not a gate'],
    ['lint:gates-full', 'the push rung entry point, not a gate'],
    ['lint:fix', 'eslint --fix; a mutation, not a check'],
    ['lint:eslint', 'eslint keeps its own process — it needs the type-aware program and a 12 GB heap, which is not something to import into a shared runner'],
    ['lint:advisories', 'queries the network (npm audit), so it cannot run at a rung that must work offline'],
]);
