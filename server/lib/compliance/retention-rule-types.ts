/**
 * The SHAPES a retention decision may take — one per array in the catalogue.
 *
 * Split out of `retention-manifest.ts` when that file crossed the size gate, on
 * the same seam that sent the numbers to `retention-windows.ts`: this file
 * answers WHAT A RULE MAY SAY, the manifest answers WHICH TABLES AND WHAT
 * ACTION, and `retention-windows.ts` answers HOW LONG AND WHY.
 *
 * ⚠️ THE ARRAYS THEMSELVES MUST NOT FOLLOW. Both gates
 * (`scripts/check-retention-manifest.mjs`, `scripts/check-retention-policy.mjs`)
 * open `retention-manifest.ts` BY PATH and parse `RETENTION_MANIFEST`,
 * `RETENTION_OUT_OF_SCOPE` and `RETENTION_OPEN` out of its source text. Moving
 * any of the three here would not fail — it would make the manifest gate exit 1
 * on "could not locate", and the policy gate hash an empty parse. The types are
 * safe to move because neither gate reads a type; both read array literals.
 *
 * `retention-manifest.ts` re-exports everything here, so every existing import
 * site keeps working and nothing has to learn which of the two files a name
 * came from.
 */

/**
 * A retention period, carrying its unit.
 *
 * Months are not days. A 24-month window expressed as 730 days drifts against
 * the calendar and against the number published in the privacy policy, so the
 * unit travels with the value and the executor does calendar arithmetic for
 * months (`subtractMonthsMs`) rather than multiplying.
 */
export type RetentionWindow =
    | { unit: 'months'; value: number }
    | { unit: 'days'; value: number };

/**
 * One table, one clock.
 *
 * `purpose` is REQUIRED and is not decoration: a period with no stated purpose
 * is a number somebody picked, and the gate rejects it. It is also what makes a
 * later change reviewable — a diff that shortens a window and leaves the
 * purpose untouched is visibly one of the two things wrong.
 */
export interface RetentionRule {
    /** DB table name (snake_case), as it appears in the Drizzle schema. */
    table: string;
    /** The column the window is measured from (snake_case). */
    timestampColumn: string;
    window: RetentionWindow;
    action: 'delete' | 'erase_in_place';
    /** Why THIS period for THIS table. Enforced non-empty by the gate. */
    purpose: string;
    /**
     * How this rule obeys the global invariant that a legal hold outranks every
     * scheduled deletion. Required on every rule, because the
     * failure this field exists to prevent is a table nobody classified — which
     * looks identical to a table that does not need classifying.
     *
     * `tenant_scoped`   — the table carries `tenant_id`, and the executor
     *                     excludes rows belonging to a held tenant. This is the
     *                     real enforcement, and it is what the behavioural drift
     *                     guard in `legal-hold-sweep.spec.ts` proves per table.
     * `suspend_all`     — the table has NO tenant dimension but carries
     *                     substantive records, so a hold cannot be expressed as
     *                     a filter. The rule is skipped entirely while ANY hold
     *                     is in force. Over-preserving a small operational table
     *                     is the cheap error; the other one is spoliation.
     * `not_applicable`  — a hold cannot reach anything in this table, and
     *                     `legalHoldNote` has to say why. Not a way to opt out:
     *                     the gate rejects the value without the note, and the
     *                     note is the thing a reviewer disagrees with.
     */
        legalHold: 'tenant_scoped' | 'suspend_all' | 'not_applicable';
    /** REQUIRED when `legalHold` is `not_applicable`. Enforced by the gate. */
    legalHoldNote?: string;
    /**
     * The `tenant_configs` column holding a per-tenant override, in YEARS,
     * where 0 means indefinite.
     *
     * Present on exactly one rule, and named here rather than hidden in the
     * executor so the manifest stays TRUE: without it this file would state a
     * seven-year window for a table where a tenant may have chosen three, and a
     * register generated from the manifest would publish a number no tenant
     * necessarily has.
     */
    tenantWindowColumnYears?: string;
    /**
     * A column on the table itself holding this row's own due date.
     *
     * Present where one table carries records with genuinely different
     * lifetimes and the difference is a property of the record, not of the
     * tenant. `window` above is then the OUTER bound the catalogue guarantees —
     * true for every row that HAS a due date — and this column is what the
     * executor compares. Named here rather than left inside the executor for
     * the same reason as the per-tenant override next door: a catalogue that
     * states a period no record actually has is a catalogue nobody can audit
     * against.
     *
     * A NULL in the named column is NOT read as "due at the outer bound". The
     * executor leaves such a row alone, because a row whose due date was never
     * written is an unfinished write rather than an aged record — and guessing
     * a deletion date for it would delete on a clock nobody set.
     */
    rowWindowColumn?: string;
}

/**
 * A table the retention catalogue deliberately does NOT expire, with the reason.
 *
 * @gateConsumed `scripts/check-retention-manifest.mjs` reads this declaration
 * out of the SOURCE TEXT rather than importing it — the gate is a plain .mjs
 * script and this is TypeScript. That consumption is invisible to a
 * module-graph analyzer, so knip would report the symbol as dead. The tag says
 * "a tool consumes this", which is true; a dead-code baseline entry would have
 * said "this is dead and we tolerate it", which is not.
 */
export interface RetentionOutOfScopeEntry {
    table: string;
    reason: string;
}

/**
 * A table with a KNOWN retention gap and no decision yet, bounded by a date.
 *
 * The shape is borrowed from `PENDING_ENFORCEMENT` in the erasure gate, and for
 * the same reason: the alternative to declaring an open question is writing a
 * reason that sounds like a decision, and out-of-scope is where that lands. An
 * entry here says "this table accumulates data nothing expires, we know, and
 * here is when we answer" — which is honest, visible in the diff, and cannot
 * quietly become permanent because the gate fails once `decideBy` passes.
 *
 * To remove an entry: decide, then move it to `RETENTION_MANIFEST` or
 * `RETENTION_OUT_OF_SCOPE`. Adding one is a reviewed diff, not a keyword.
 *
 * @gateConsumed read as source text by `scripts/check-retention-manifest.mjs`.
 */
export interface RetentionOpenEntry {
    table: string;
    reason: string;
    /** YYYY-MM-DD. The gate fails once this date is past. */
    decideBy: string;
}
