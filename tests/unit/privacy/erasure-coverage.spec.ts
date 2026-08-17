import { describe, it, expect } from 'vitest';
import {
    buildErasureCoverage,
    ERASURE_SUBJECT_AXIS,
} from '../../../server/lib/compliance/erasure-coverage';
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';
import { ERASURE_OUT_OF_SCOPE } from '../../../server/lib/compliance/erasure-out-of-scope';
import type { ErasureDecision } from '../../../server/lib/compliance/erasure-orchestrator';

/**
 * Privacy P3 — the coverage disclosure that rides `reply.subject.erased`.
 *
 * NOTHING HERE IS ASSERTED AGAINST A LITERAL COUNT. The catalogue gains rules
 * most months; a spec that pinned "48 rules" would go red on a diff that added a
 * PII column correctly, which trains people to update the number rather than
 * read it. What is asserted is the RELATIONSHIP between the disclosure and its
 * two sources, plus the internal consistency portal refuses a reply over.
 */
describe('erasure coverage disclosure', () => {
    const decisions: ErasureDecision[] = [
        { table: 'agreement_signers', action: 'erase_in_place', count: 1, legalBasis: 'art_17_3_e' },
        { table: 'agreement_requests', action: 'erase_in_place', count: 1, legalBasis: 'art_17_3_e' },
        { table: 'contacts', action: 'delete', count: 1 },
        // Same table twice — the orchestrator emits one decision per envelope.
        { table: 'agreement_signers', action: 'delete', count: 2 },
    ];

    it('reports the catalogue sizes it actually derives them from', () => {
        const c = buildErasureCoverage(decisions);
        // eslint-disable-next-line no-console
        console.log(`[coverage] manifest rules=${c.manifestRuleCount}, out-of-scope=${c.outOfScopeCount}, pending=${c.pendingEnforcementCount}`);
        expect(c.manifestRuleCount).toBe(ERASURE_MANIFEST.length);
        expect(c.outOfScopeCount).toBe(ERASURE_OUT_OF_SCOPE.length);
        // A catalogue that scanned to nothing must not read as "fully covered".
        expect(c.manifestRuleCount).toBeGreaterThan(0);
        expect(c.outOfScopeCount).toBeGreaterThan(0);
    });

    it('carries pending-enforcement rules as IDENTIFIERS, matching the manifest', () => {
        const expected = [...new Set(
            ERASURE_MANIFEST.filter((r) => r.enforcementStatus === 'pending')
                .map((r) => `${r.table}.${r.column}`),
        )].sort();
        const c = buildErasureCoverage(decisions);
        // eslint-disable-next-line no-console
        console.log(`[coverage] pendingRules=${c.pendingRules.length} -> ${c.pendingRules.join(', ') || '(none)'}`);
        expect(c.pendingRules).toEqual(expected);
        // The tripwire that makes the assertion above mean something. If the
        // manifest ever holds NO pending rule, the equality passes on two empty
        // arrays and this spec stops testing anything — that day, delete this
        // expectation deliberately rather than letting it rot into a no-op.
        expect(expected.length, 'manifest has no pending rules — the comparison above is now vacuous').toBeGreaterThan(0);
    });

    it('pendingRules.length === pendingEnforcementCount — the one thing portal refuses a reply over', () => {
        const c = buildErasureCoverage(decisions);
        expect(c.pendingRules.length).toBe(c.pendingEnforcementCount);
    });

    it('executedTables come from THIS RUN, de-duplicated and sorted', () => {
        const c = buildErasureCoverage(decisions);
        expect(c.executedTables).toEqual(['agreement_requests', 'agreement_signers', 'contacts']);
    });

    it('a step that THREW is not reported as an executed table', () => {
        const withFailure: ErasureDecision[] = [
            { table: 'contacts', action: 'delete', count: 1 },
            { table: 'notification_preferences', action: 'delete', count: 0, error: 'no such table' },
        ];
        const c = buildErasureCoverage(withFailure);
        expect(c.executedTables).toEqual(['contacts']);
        expect(c.executedTables).not.toContain('notification_preferences');
    });

    it('discloses the email axis and flags the catalogue as advisory', () => {
        const c = buildErasureCoverage(decisions);
        expect(c.subjectAxis).toBe('email');
        expect(ERASURE_SUBJECT_AXIS).toBe('email');
        expect(c.catalogueIsAdvisory).toBe(true);
    });

    it('an empty run still produces a complete disclosure (no field is optional)', () => {
        const c = buildErasureCoverage([]);
        expect(c.executedTables).toEqual([]);
        expect(Object.keys(c).sort()).toEqual([
            'catalogueIsAdvisory', 'executedTables', 'manifestRuleCount',
            'outOfScopeCount', 'pendingEnforcementCount', 'pendingRules', 'subjectAxis',
        ]);
    });
});
