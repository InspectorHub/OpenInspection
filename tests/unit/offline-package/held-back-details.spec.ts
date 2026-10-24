/**
 * A page that explains a refused package needs the figure the server named (how
 * many days a package may be old). It is carried on the held-back rows of a
 * whole-package refusal, and only there: an inspection left behind for its own
 * reason has no such figure.
 */
import { describe, it, expect } from 'vitest';
import { runImport } from '@core/offline-package';
import { makeCase } from '../helpers/offline-package-cases';
import { confirmedFor, harness, refusal } from '../helpers/offline-package-harness';

const pack = makeCase({ inspections: 3 });

describe('held-back rows carry the server details of a whole-package refusal', () => {
    it.each([
        ['PACKAGE_EXPIRED', { maxAgeDays: 400 }],
        ['PACKAGE_FROM_THE_FUTURE', { maxFutureSkewDays: 1 }],
    ])('%s keeps its figure on every held-back inspection', async (code, details) => {
        const h = harness(() => refusal(422, code, details));
        const report = await runImport(pack.zip, h.send, h.options);
        expect(report.heldBack).toHaveLength(3);
        for (const row of report.heldBack) expect(row.details).toEqual(details);
    });

    it('a row held back for its own reason has no details (positive control)', async () => {
        const h = harness((n, _ids, bytes) => (n === 1 ? refusal(404, 'NOT_FOUND', { inspectionId: 'insp-1' }) : confirmedFor(bytes)));
        const report = await runImport(pack.zip, h.send, h.options);
        expect(report.heldBack.map((x) => x.id)).toEqual(['insp-1']);
        expect(report.heldBack[0]).not.toHaveProperty('details');
    });
});
