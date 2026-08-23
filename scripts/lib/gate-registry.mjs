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
    // Not the chrome-record gate itself -- that one runs at the commit-msg rung,
    // which this ladder does not model, because the thing it reads (the commit
    // message) does not exist until after pre-commit has finished. What runs
    // here is that gate's SELF-TEST, and it is registered for one reason: if the
    // judge inside check-chrome-record.mjs breaks, the commit-msg hook goes
    // green on every commit and nothing anywhere says so. That is this repo's
    // oldest failure shape -- an empty result reading as a pass -- and the only
    // defence against it is a positive control that runs on a rung somebody
    // watches. Pure functions over literal fixtures, no fs walk, no git: single
    // -digit milliseconds, the cheapest entry in this list.
    { key: 'chromerecord', label: 'Chrome-record judge self-test', script: 'check-chrome-record.mjs', fix: 'npm run lint:chrome-record', rung: PRECOMMIT, args: ['--self-test'] },
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
    // tracking gate. It also holds the AWAITING ratchet, which is why it stays
    // here rather than moving to PUSH: the moment debt is DECLARED is the same
    // moment the line is typed, and `0 new` stayed true on every run while the
    // backlog grew.
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
    // PRECOMMIT rather than PUSH, and the rung is the whole point. What this
    // catches ends up in a PUBLIC repository's permanent history, so the only
    // moment the fix is cheap is before the commit exists — after that it is a
    // rebase, and after a push it is not fixable at all. Measured at 0.67s over
    // 3,605 files.
    { key: 'privatereview', label: 'No private-review references', script: 'check-no-private-review-refs.mjs', fix: 'npm run lint:private-review', rung: PRECOMMIT },

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
    // The other direction of `tests` above, and the most expensive entry in
    // this list by an order of magnitude: it spawns `playwright test --list`
    // once per playwright config (5 today, ~10-15s in total) because Playwright
    // is the only authority on what `testMatch` collects.
    //
    // PUSH and emphatically not PRECOMMIT. The registry's rule for the rungs
    // above is that a pre-commit row is a cost decision paid by every commit in
    // the repo, and the cheapest row up there is two file reads; this one is
    // three orders of magnitude dearer and would be paid on doc-only commits
    // too. Nor is it a keystroke gate: what it catches is a spec file EXISTING
    // with no project pointing at it, which is a state a branch is in for as
    // long as it takes to write the spec — a commit mid-way through writing one
    // is normal, and failing it there would train people to `--no-verify`. PUSH
    // is the first rung where the answer is complete, and it is a rung before
    // CI actually runs the suite, so the spec still gets wired up before anyone
    // could mistake "never collected" for "passing".
    { key: 'e2ecoverage', label: 'lint:e2e-coverage', script: 'check-e2e-spec-coverage.mjs', fix: 'npm run lint:e2e-coverage', rung: PUSH },
    { key: 'testimports', label: 'lint:test-imports', script: 'check-test-imports.mjs', fix: 'npm run lint:test-imports', rung: PUSH },
    { key: 'deadcode', label: 'lint:deadcode', script: 'check-deadcode.mjs', fix: 'npm run lint:deadcode', rung: PUSH },
    { key: 'timestamps', label: 'lint:timestamps', script: 'check-timestamps.mjs', fix: 'npm run lint:timestamps', rung: PUSH },
    { key: 'i18n', label: 'lint:i18n', script: 'check-i18n.mjs', fix: 'npm run lint:i18n', rung: PUSH },
    { key: 'i18ncatalog', label: 'lint:i18n-catalog', script: 'check-i18n-catalog.mjs', fix: 'npm run lint:i18n-catalog', rung: PUSH },
    { key: 'i18nglossary', label: 'lint:i18n-glossary', script: 'check-i18n-glossary.mjs', fix: 'npm run lint:i18n-glossary', rung: PUSH },
    { key: 'naming', label: 'lint:naming', script: 'check-naming.mjs', fix: 'npm run lint:naming', rung: PUSH },
    { key: 'agentroutes', label: 'lint:agent-routes', script: 'check-agent-routes.mjs', fix: 'npm run lint:agent-routes', rung: PUSH },
    { key: 'doclinks', label: 'lint:doclinks', script: 'check-doc-links.mjs', fix: 'npm run lint:doclinks', rung: PUSH },
    // The Workers Free CPU ceiling is 10 ms PER INVOCATION and this repo
    // promises the free tier in README.md, but only the free tier's SCRIPT-SIZE
    // limit was ever gated -- the CPU limit was gated nowhere, which is how a
    // thirteen-job scheduled() handler measured at 13.8x the ceiling shipped and
    // stayed. This gate cannot measure CPU from source; it gates the SHAPE that
    // made the overrun possible (every job bounded, no job body on the cron
    // invocation, no unbounded table read in a cron path).
    //
    // PUSH and not PRECOMMIT: the files it reads are five, and they change
    // rarely -- a new cron job is not a thing anyone adds by accident between
    // commits, and the note above is explicit that a new pre-commit row is a
    // cost decision for every commit in the repo and belongs in its own change.
    { key: 'cronbudget', label: 'lint:cron-budget', script: 'check-cron-budget.mjs', fix: 'npm run lint:cron-budget', rung: PUSH },
    // NOTE: there is no `docsmarkers` row any more. The user-guide prose is
    // published from the hosted docs site and its marker gate went with it.
    // `tests/docs-shots/` here still PRODUCES the captures, but no markdown in
    // this repository carries a shot marker, so a gate registered here would
    // scan a directory that no longer exists and go green on it.
    // The docs gate that replaced `docsmarkers`. PUSH rather than PRECOMMIT for
    // the same reason as the doc-link gate beside it: it reads every markdown
    // file in the repo, and a bare hosted path is introduced by prose that is
    // usually written across several commits before anyone pushes it.
    { key: 'noportalroutes', label: 'lint:no-portal-routes', script: 'check-no-portal-routes.mjs', fix: 'npm run lint:no-portal-routes', rung: PUSH },
    { key: 'schemadoc', label: 'lint:schema-doc', script: 'gen-schema-doc.mjs', fix: 'npm run lint:schema-doc', rung: PUSH, args: ['--check'] },
    { key: 'verificationcopy', label: 'lint:verification-copy', script: 'check-verification-copy.mjs', fix: 'npm run lint:verification-copy', rung: PUSH },
    // PUSH rather than PRECOMMIT, unlike the tracking gate above it, and for a
    // reason that is about WHERE the breakage comes from rather than how much
    // it costs: this one fails when an anchor comment is deleted or a guarded
    // site is refactored away, which is usually a commit somewhere else in the
    // tree. The rung that sees the whole change is the rung where the answer is
    // complete. It reads the same ~1.9k server/app sources with one regex.
    { key: 'viewinvariants', label: 'lint:view-invariants', script: 'check-view-tracking-invariants.mjs', fix: 'npm run lint:view-invariants', rung: PUSH },
    { key: 'fabricatednames', label: 'lint:fabricated-names', script: 'check-fabricated-names.mjs', fix: 'npm run lint:fabricated-names', rung: PUSH },
    { key: 'sigcompare', label: 'lint:sigcompare', script: 'check-signature-compare.mjs', fix: 'npm run lint:sigcompare', rung: PUSH },
    { key: 'signaturedynamics', label: 'lint:signature-dynamics', script: 'check-signature-dynamics.mjs', fix: 'npm run lint:signature-dynamics', rung: PUSH },
    { key: 'smsgateargs', label: 'lint:sms-gate-args', script: 'check-sms-gate-args.mjs', fix: 'npm run lint:sms-gate-args', rung: PUSH },
    { key: 'messagingrules', label: 'lint:messaging-rules', script: 'check-messaging-rules.mjs', fix: 'npm run lint:messaging-rules', rung: PUSH },
    // PUSH rather than PRECOMMIT, and the argument is the opposite of the price
    // and tracking gates above: what this one catches is not a capability
    // ARRIVING, it is a resolution step that reads one of two id spaces. That
    // shape is created by a query being written and then, usually, by a second
    // query elsewhere in the tree failing to be written at all — so the commit
    // that creates the defect is often not the commit that would fail. PUSH is
    // the first rung that sees the whole change. It walks ~987 server sources,
    // strips comments and matches four regexes, which is the same order of cost
    // as the tracking gate that does sit at pre-commit; the rung choice here is
    // about WHEN the answer is complete, not about the price.
    { key: 'consentsubjects', label: 'lint:consent-subjects', script: 'check-consent-subject-kinds.mjs', fix: 'npm run lint:consent-subjects', rung: PUSH },
    // PUSH, not PRECOMMIT, and the argument cuts the other way from the price /
    // tracking / AI gates above. Those catch a CAPABILITY arriving, where the
    // moment to argue is while the line is typed. This one catches a vocabulary
    // WORD drifting from its call sites, and the drift is usually created by a
    // commit elsewhere in the tree -- a route deleted, a metadata key renamed --
    // so the commit that breaks it is often not the commit that touches the
    // registry. It also reads every .ts/.tsx under server/ and app/ and matches
    // three call forms with a brace walker, the most expensive scan in this
    // list. PUSH sees the whole change; that is the rung where the answer is
    // complete.
    { key: 'auditregistry', label: 'lint:audit-registry', script: 'check-audit-registry.mjs', fix: 'npm run lint:audit-registry', rung: PUSH },
    // PUSH rather than pre-commit, and the two converter gates sit together
    // because they answer halves of one question. `converter-capability` asks
    // whether a converter is registered, tested and has a declared format;
    // `converter-literals` asks whether every string it embeds is classified.
    // Both read a handful of files and cost almost nothing, but neither catches
    // a keystroke — they catch a converter ARRIVING, and a converter arrives in
    // one change rather than one line. ⚠️ Neither says anything about whether a
    // reader has ever seen a real file: that is `verify:real-corpus`, which is a
    // release-time manual rung and is in UNREGISTERED below with its reason.
    { key: 'convcapability', label: 'lint:converter-capability', script: 'check-converter-capability.mjs', fix: 'npm run lint:converter-capability', rung: PUSH },
    { key: 'convliterals', label: 'lint:converter-literals', script: 'check-converter-literals.mjs', fix: 'npm run lint:converter-literals', rung: PUSH },
    // PUSH rather than PRECOMMIT: a statutory form revision is published by
    // hand, weeks or months apart, so there is no stream of commits for a
    // pre-commit rung to watch. It reads one directory and a handful of files
    // and costs milliseconds; what it protects is a document somebody files
    // with a government agency, and its own output states the one thing it
    // cannot check (that a person read the form).
    { key: 'statutoryfidelity', label: 'lint:statutory-fidelity', script: 'check-statutory-fidelity.mjs', fix: 'npm run lint:statutory-fidelity', rung: PUSH },
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
    ['verify:real-corpus', 'reads real vendor exports that are NOT in this repository and must never be. A release-time manual rung run by somebody holding the private corpus: CI here runs on a public repository and cannot hold credentials for private material. Listed rather than omitted so that its absence from every rung is a recorded decision instead of an oversight'],
]);
