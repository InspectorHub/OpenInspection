/**
 * Enforcement for the account-export classification
 * (`server/lib/compliance/account-export-manifest.ts`).
 *
 * ── WHY A TEST AND NOT A `scripts/check-*.mjs` GATE ─────────────────────────
 *
 * The erasure manifest — the house pattern this classification copies — is
 * enforced by a gate, so the default answer here would have been a gate too.
 * It is a test for three reasons, and the first is the load-bearing one:
 *
 *  1. The authority on "every column of `users`" is the Drizzle table OBJECT,
 *     and only a TypeScript consumer can read it. `getTableColumns(users)`
 *     returns the compiled truth: the property names the selected row actually
 *     carries and the DB names behind them. A `.mjs` gate cannot import
 *     TypeScript, so it would have to regex the schema source — which is
 *     exactly what `scripts/check-erasure-manifest.mjs` does, and its own
 *     header documents two occasions that regex gave a confident wrong answer
 *     (it parsed a RENAMED array and reported health; it matched inside PROSE
 *     and reported zero rules while all 56 sat intact below). Reproducing that
 *     class of bug for a table we can simply import would be a choice.
 *
 *  2. The classification is only worth anything if `exportAccount` actually
 *     applies it. That is a behavioural assertion — it needs the service run
 *     against a database — and no gate can make it. Splitting "is every column
 *     ruled on" into a gate and "is the ruling applied" into a test lets the
 *     two drift, and the interesting failure is precisely the pair coming
 *     apart: a complete, well-reasoned classification nothing reads. Both
 *     halves live here, in `account-export-delete.spec.ts` alongside it.
 *
 *  3. Rung cost. `lint:erasure` runs at the PUSH rung (pre-push + CI verify);
 *     `test:unit` runs in CI. Both are pre-merge, so a gate would buy no
 *     earlier warning here — while a new `lint:*` script must also be
 *     registered in `scripts/lib/gate-registry.mjs` or it runs on no rung at
 *     all (`check-gate-registry.mjs` is the guard for exactly that), which is
 *     real machinery to add for no additional coverage.
 *
 * The one thing a gate would have bought is a red run on a schema change that
 * touches no test. It does not apply: adding a column to `users` changes the
 * compiled table object, so `getTableColumns` sees it on the very next unit
 * run, with no list anywhere to remember to update.
 */
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { users } from '../../../server/lib/db/schema';
import {
    ACCOUNT_EXPORT_CLASSIFICATION,
    auditAccountExportClassification,
    redactIdentityForExport,
    UNCLASSIFIED_REASON,
} from '../../../server/lib/compliance/account-export-manifest';

/** The live table, as the compiler sees it — not a list anybody maintains. */
const liveFields = Object.keys(getTableColumns(users));

describe('account-export classification', () => {
    // Positive control for the two audits below. Both are set-difference
    // checks, and both would pass vacuously against an empty column list: an
    // audit that reports nothing because it read nothing is the failure mode
    // this repo has watched turn a green run into a digest of nothing.
    it('reads a non-empty column list off the live users table', () => {
        expect(liveFields.length).toBeGreaterThan(20);
        expect(liveFields).toContain('email');
        expect(liveFields).toContain('totpSecret');
        expect(ACCOUNT_EXPORT_CLASSIFICATION.length).toBeGreaterThan(20);
    });

    it('classifies every column of users as exported or withheld', () => {
        const { unclassified } = auditAccountExportClassification(liveFields);
        expect(
            unclassified,
            'A new users column is neither exported nor withheld. Add it to ' +
            'ACCOUNT_EXPORT_CLASSIFICATION in server/lib/compliance/account-export-manifest.ts ' +
            'with the reason. Until then it is withheld at runtime, which UNDER-DISCLOSES ' +
            'on a subject-access request.',
        ).toEqual([]);
    });

    it('carries no rule for a column the table no longer has', () => {
        const { stale } = auditAccountExportClassification(liveFields);
        expect(
            stale,
            'A classification entry names a column users does not have — a decision nobody ' +
            'can evaluate, padding the count that makes the classification look complete.',
        ).toEqual([]);
    });

    it('records the real snake_case DB name beside every field', () => {
        const cols = getTableColumns(users);
        const dbName = (field: string): string | undefined =>
            field in cols ? cols[field as keyof typeof cols].name : undefined;
        const mismatched = ACCOUNT_EXPORT_CLASSIFICATION
            .filter((r) => dbName(r.field) !== undefined && dbName(r.field) !== r.column)
            .map((r) => `${r.field}: declared '${r.column}', table says '${String(dbName(r.field))}'`);
        expect(mismatched).toEqual([]);
    });

    it('gives every entry a non-empty reason', () => {
        const reasonless = ACCOUNT_EXPORT_CLASSIFICATION
            .filter((r) => !r.reason || r.reason.trim() === '')
            .map((r) => r.field);
        expect(reasonless).toEqual([]);
    });

    it('withholds the three authentication credentials and nothing else', () => {
        const withheld = ACCOUNT_EXPORT_CLASSIFICATION
            .filter((r) => r.disposition === 'withhold')
            .map((r) => r.field)
            .sort();
        // Pinned rather than counted. Growing this set is a disclosure decision:
        // every addition removes something from what a subject is handed, and
        // that belongs in a diff somebody approves — the same reason
        // check-erasure-manifest.mjs pins its PENDING_ENFORCEMENT list.
        expect(withheld).toEqual(['passwordHash', 'totpRecoveryCodes', 'totpSecret']);
    });

    // ── The classification BITES ────────────────────────────────────────────
    // `auditAccountExportClassification` takes the column list as an argument
    // precisely so it can be pointed at a synthetic table, for the reason
    // check-erasure-manifest.mjs grew its `--schema-dir` override: an
    // enforcement that can only ever look at the real, currently-correct thing
    // has never been shown to fail. Nothing tracked is mutated, so no
    // interrupted run can leave a probe committed.
    it('reports a column the classification has never heard of', () => {
        const withSynthetic = [...liveFields, 'syntheticUnclassifiedProbe'];

        const { unclassified, stale } = auditAccountExportClassification(withSynthetic);
        expect(unclassified).toEqual(['syntheticUnclassifiedProbe']);
        // The other direction stays quiet: adding a column invalidates no
        // existing rule, and an audit that shouted about both would make the
        // signal useless.
        expect(stale).toEqual([]);

        // And with the synthetic column removed again, the same audit is clean —
        // so the red above is caused by the column, not by the audit being
        // broken in a way that reddens everything.
        expect(auditAccountExportClassification(liveFields).unclassified).toEqual([]);
    });

    it('withholds an unclassified column at runtime and names it', () => {
        const row = { id: 'u1', email: 'a@x.com', syntheticUnclassifiedProbe: '6789' };

        const { identity, withheld } = redactIdentityForExport(row);

        // Fail closed: an unreviewed column could be a credential.
        expect(identity).not.toHaveProperty('syntheticUnclassifiedProbe');
        expect(JSON.stringify(identity)).not.toContain('6789');
        // ...but NOT silently. The subject can see that something was held back
        // and ask why, which is what stops the safe default from becoming a
        // quiet under-disclosure.
        expect(withheld).toContainEqual({ field: 'syntheticUnclassifiedProbe', reason: UNCLASSIFIED_REASON });
        // The classified fields around it are unaffected.
        expect(identity.email).toBe('a@x.com');
    });

    it('reports a rule whose column has been dropped from the table', () => {
        const withoutPhone = liveFields.filter((f) => f !== 'phone');
        expect(auditAccountExportClassification(withoutPhone).stale).toEqual(['phone']);
    });
});
