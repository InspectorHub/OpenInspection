/**
 * #69 — WHERE the inspection hub links to the Repair Request Log.
 *
 * This is a source-level assertion, which is unusual here and deliberate. The
 * hub route is a 1,200-line component with a large loader payload, so
 * rendering it to ask one structural question is not the cheap option; and the
 * question is genuinely structural — not "does a link exist" but "which of the
 * two report cards is it on, and is it inside the published branch".
 *
 * WHY IT IS WORTH PINNING AT ALL. The link first shipped on `ReportsCard`, the
 * PLURAL deliverables card, and the component tests passed. In the browser it
 * rendered directly beneath that card's empty state — "No reports on this
 * order yet" — on an order whose report was published and whose singular
 * REPORT card said so ten centimetres below. Two cards, similar names,
 * different subjects: exactly the mistake a unit test cannot see and a
 * reviewer skims past.
 *
 * ⚠️ WHAT THIS DOES **NOT** GUARD. It is not a safety check. If the link ever
 * leaked onto an unpublished order, the page behind it still refuses — that
 * gate lives on the route and is tested there
 * (`tests/unit/repair/repair-request-log-route.spec.ts`, which asserts the
 * service is not even called). This test protects reachability and coherence,
 * which is the failure mode this codebase keeps producing: capabilities that
 * exist and that nobody can find.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let source: string;

beforeAll(() => {
    source = readFileSync(path.join(HERE, 'inspector-portal.tsx'), 'utf8');
});

/** Fails loudly rather than letting `indexOf` return -1 and skew a comparison. */
function at(needle: string): number {
    const i = source.indexOf(needle);
    expect(i, `anchor not found in inspector-portal.tsx: ${needle}`).toBeGreaterThan(-1);
    return i;
}

describe('inspection hub — Repair Request Log entry point (#69)', () => {
    it('links to the log', () => {
        // The anti-vacuity guard for everything below: if the link is gone, the
        // ordering assertions would otherwise pass on two -1s.
        expect(source).toContain('/repair-requests');
        expect(source).toContain('data-testid="hub-repair-log-link"');
    });

    it('puts it on the singular REPORT card, inside the published branch', () => {
        const publishedBranch = at('reportShipped ? (');
        const link = at('data-testid="hub-repair-log-link"');
        // The unpublished arm's first distinctive string. The link must come
        // before it, i.e. still inside the `reportShipped` true branch.
        const unpublishedBranch = at('inspections_hub_report_submitted');
        expect(link).toBeGreaterThan(publishedBranch);
        expect(link).toBeLessThan(unpublishedBranch);
    });

    it('sits with the other post-publish actions, not on the deliverables card', () => {
        // `ReportsCard` is a separate module; the link living in this file at
        // all is what says it is not back on the plural card. Pinned by name
        // so that re-adding the prop is a visible failure rather than a quiet
        // second entry point.
        const reportsCard = readFileSync(
            path.join(HERE, '..', 'components', 'inspector-portal', 'ReportsCard.tsx'),
            'utf8',
        );
        expect(reportsCard).not.toContain('repairLogHref');
        expect(reportsCard).not.toContain('hub-repair-log-link');
        // Adjacent to Unpublish — the other action that only makes sense once
        // the report is out.
        expect(at('data-testid="hub-repair-log-link"'))
            .toBeLessThan(at('inspections_hub_report_unpublish'));
    });
});
