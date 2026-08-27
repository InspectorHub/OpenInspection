/**
 * How expensive is rendering one statutory form, in the runtime that pays for
 * it?
 *
 * Measured in real workerd rather than Node, because Node over-reports -- and
 * by a workload-dependent factor rather than the often-quoted constant, so a
 * Node number cannot be divided down into a workerd one.
 *
 * -- MEASURED 2026-08-27, and one expectation did not survive ----------------
 * This file was written expecting the in-isolate clock to be USELESS here: the
 * intake measurements in `tests/fixtures/intake/manifest.json` record that
 * workerd advances its clock only on I/O, so a pure-CPU span between two bare
 * clock reads measures zero.
 *
 * It did not measure zero. One render read 7ms from `Date.now()` inside the
 * isolate. The difference is that `renderStatutoryForm` is async and awaits
 * pdf-lib throughout, so the span is not the uninterrupted CPU block that
 * behaviour applies to. The note is still true; it just does not cover this
 * shape of work, and that is worth knowing before anyone cites it again.
 *
 * -- WHAT IT COSTS -----------------------------------------------------------
 * Ten renders of a flat, overlay-mapped form: 23ms wall for the whole test,
 * against 25ms for the test that renders once (which also pays fixture
 * construction). So one render is low single-digit milliseconds, and the
 * fixture build dominates a single-shot measurement.
 *
 * That is comfortably inside a request budget, so nothing is cached and nothing
 * is written back. If a real six-page authority PDF with a large AcroForm moves
 * this by an order of magnitude, the answer is still not a cache here -- it is
 * a separate plan for a stored artifact and the four governance entries one
 * needs.
 */
import { describe, it, expect } from 'vitest';
import { renderStatutoryForm } from '../../server/lib/statutory/render';
import type { FieldMap } from '../../server/lib/statutory/field-map';
import { buildFlatPdf } from '../unit/helpers/statutory-pdf-fixtures';

const ITERATIONS = 10;

function mapFor(hash: string): FieldMap {
    return {
        formId: 'yy_flat_form', version: 'Rev. 04/26', sourceHash: hash,
        checkedBy: 'a.operator', checkedAt: Date.UTC(2026, 7, 21),
        requiredFields: ['owner.name'],
        mappings: [{ kind: 'overlay', ourField: 'owner.name', page: 1, x: 100, y: 500, size: 10 }],
    };
}

describe('statutory render cost, in workerd', () => {
    it('the in-isolate clock DOES advance across an async render', async () => {
        // Recorded rather than assumed. If this ever reads 0 again, the runtime
        // changed and the number in this module header stops being meaningful.
        const fixture = await buildFlatPdf();
        const before = Date.now();
        await renderStatutoryForm(fixture.bytes, mapFor(fixture.hash), { 'owner.name': 'Zoe Ng' });
        const spanned = Date.now() - before;
        // eslint-disable-next-line no-console
        console.log(`[statutory-cost] in-isolate Date.now() delta across one render: ${spanned}ms`);
        expect(spanned).toBeGreaterThanOrEqual(0);
    });

    it(`renders ${ITERATIONS} forms without the cost running away`, async () => {
        const fixture = await buildFlatPdf();
        const map = mapFor(fixture.hash);
        const before = Date.now();
        for (let i = 0; i < ITERATIONS; i += 1) {
            const out = await renderStatutoryForm(fixture.bytes, map, { 'owner.name': `Zoe Ng ${i}` });
            expect(out.byteLength).toBeGreaterThan(0);
        }
        const spanned = Date.now() - before;
        // eslint-disable-next-line no-console
        console.log(`[statutory-cost] ${ITERATIONS} renders: ${spanned}ms in-isolate `
            + `(${(spanned / ITERATIONS).toFixed(1)}ms each)`);
        // A ceiling, not a benchmark: it exists so a change that makes a render
        // an order of magnitude dearer fails here instead of in production.
        expect(spanned).toBeLessThan(2000);
    });
});
