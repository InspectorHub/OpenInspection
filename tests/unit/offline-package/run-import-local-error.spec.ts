/**
 * What `runImport` does when the code that cuts a package apart fails on this side
 * (writing a smaller package, or planning the parts of a large one). The run must
 * not reject: what the server confirmed stays imported, everything else is left
 * behind as `gave_up` with the detail `local_error`, and every inspection is still
 * in exactly one of the two lists.
 *
 * The writer is wrapped, not replaced: it delegates to the real one unless a spec
 * switches a fault on, so the same file also holds the control where nothing fails.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runImport } from '@core/offline-package';
import { makeCase } from '../helpers/offline-package-cases';
import { confirmedFor, harness, partitionProblems, refusal } from '../helpers/offline-package-harness';

const fault = vi.hoisted(() => ({ writeForSize: null as number | null, plan: false }));

vi.mock('../../../packages/offline-package/src/format', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../packages/offline-package/src/format')>();
    return {
        ...original,
        writePackageFor: (parsed: Parameters<typeof original.writePackageFor>[0], ids: ReadonlySet<string>) => {
            if (fault.writeForSize !== null && ids.size === fault.writeForSize) throw new Error('writer failed');
            return original.writePackageFor(parsed, ids);
        },
    };
});

vi.mock('../../../packages/offline-package/src/split', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../packages/offline-package/src/split')>();
    return {
        ...original,
        planParsedParts: (...args: Parameters<typeof original.planParsedParts>) => {
            if (fault.plan) throw new Error('planner failed');
            return original.planParsedParts(...args);
        },
    };
});

const MIB = 1024 * 1024;
const eight = makeCase({ inspections: 8, updates: { 1: 1, 6: 1 } });
const limits = { inspections: 4, outbox: 20, photos: 50, compressedBytes: 16 * MIB };

/** The whole package is too large, the first half imports, and the second half names insp-5. */
const script = (ids: string[], bytes: Uint8Array, n: number) => {
    if (n === 1) return refusal(422, 'PACKAGE_TOO_LARGE', { limits });
    if (ids.includes('insp-5')) return refusal(403, 'FORBIDDEN', { inspectionId: 'insp-5' });
    return confirmedFor(bytes);
};

beforeEach(() => {
    fault.writeForSize = null;
    fault.plan = false;
});

describe('runImport: the code that cuts a package fails on this side', () => {
    it('imports everything when nothing fails (control)', async () => {
        const h = harness((n, ids, bytes) => script(ids, bytes, n));
        const report = await runImport(eight.zip, h.send, h.options);
        expect(report.imported).toEqual(eight.ids.filter((id) => id !== 'insp-5'));
        expect(report.heldBack.map((x) => [x.id, x.reason])).toEqual([['insp-5', 'forbidden']]);
        expect(partitionProblems(report, eight.ids)).toEqual([]);
    });

    it('a writer that throws leaves the confirmed part imported and the rest behind', async () => {
        // After insp-5 is cut away the remaining three (insp-4, insp-6, insp-7) must be written again.
        fault.writeForSize = 3;
        const h = harness((n, ids, bytes) => script(ids, bytes, n));
        const report = await runImport(eight.zip, h.send, h.options);
        expect(report.imported).toEqual(['insp-0', 'insp-1', 'insp-2', 'insp-3']);
        expect(report.heldBack.map((x) => [x.id, x.reason, x.detail])).toEqual([
            ['insp-4', 'gave_up', 'local_error'],
            ['insp-5', 'forbidden', undefined],
            ['insp-6', 'gave_up', 'local_error'],
            ['insp-7', 'gave_up', 'local_error'],
        ]);
        expect(partitionProblems(report, eight.ids)).toEqual([]);
        // Apart from the refused whole package, the confirmed part is sent once and never again.
        expect(h.calls.slice(1).flat().filter((id) => id === 'insp-0')).toHaveLength(1);
    });

    it('a planner that throws holds every inspection back, and the run still resolves', async () => {
        fault.plan = true;
        const h = harness((n, ids, bytes) => script(ids, bytes, n));
        const report = await runImport(eight.zip, h.send, h.options);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.map((x) => [x.id, x.reason, x.detail])).toEqual(eight.ids.map((id) => [id, 'gave_up', 'local_error']));
        expect(partitionProblems(report, eight.ids)).toEqual([]);
    });
});
