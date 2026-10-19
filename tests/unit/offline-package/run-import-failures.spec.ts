/**
 * How `runImport` treats the failures that are not a plain refusal: a retry window
 * that belongs to one part, a part that keeps failing on one inspection, a queued
 * write the server turned into a 400, the reason an inspection is held back, the
 * longer wait for a key another request holds, and a callback or a count that goes
 * wrong. Each refusal has a control that differs in the one distinguishing field.
 */
import { describe, it, expect } from 'vitest';
import {
    MAX_ATTEMPTS_PER_PART, MAX_RETRY_WINDOW_MS, BACKOFF_CAP_MS, classifyResponse, runImport, type ImportReport,
} from '@core/offline-package';
import { makeCase } from '../helpers/offline-package-cases';
import { confirmedFor, harness, partitionProblems, refusal } from '../helpers/offline-package-harness';

const MIB = 1024 * 1024;
const package5 = makeCase({ inspections: 5, creates: [2], photos: { 0: 1, 3: 2 }, updates: { 1: 1, 2: 1 } });
const package8 = makeCase({ inspections: 8, updates: { 3: 1 } });
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

function accounted(report: ImportReport, ids: readonly string[]): void {
    expect(partitionProblems(report, ids)).toEqual([]);
}

describe('runImport: the retry window belongs to one part', () => {
    const limits = { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * MIB };

    it('a part that starts after the import has run longer than the window can still be retried', async () => {
        let t = 0;
        const h = harness((n, _ids, bytes) => {
            if (n === 1) return refusal(422, 'PACKAGE_TOO_LARGE', { limits });
            if (n === 2) { t += MAX_RETRY_WINDOW_MS + 60_000; return confirmedFor(bytes); }
            if (n === 3) return refusal(503, 'SERVICE_UNAVAILABLE');
            return confirmedFor(bytes);
        });
        const report = await runImport(package5.zip, h.send, { sleep: async (ms) => { h.sleeps.push(ms); t += ms; }, now: () => t });
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
        expect(h.calls).toHaveLength(5);
        expect(h.calls[2]).toEqual(h.calls[3]);
    });

    it('a part whose own sends outlast the window is given up on (control)', async () => {
        let t = 0;
        const h = harness(() => { t += MAX_RETRY_WINDOW_MS + 1; return refusal(503, 'SERVICE_UNAVAILABLE'); });
        const report = await runImport(package5.zip, h.send, { sleep: async () => undefined, now: () => t });
        expect(h.calls).toHaveLength(1);
        expect(report.heldBack.every((x) => x.reason === 'gave_up')).toBe(true);
    });
});

describe('runImport: a part that keeps failing on one inspection', () => {
    const failing = (details: Record<string, unknown> | undefined, status = 503, code = 'SERVICE_UNAVAILABLE') =>
        harness((_n, ids, bytes) => (ids.includes('insp-3') ? refusal(status, code, details) : confirmedFor(bytes)));

    it('keeps only the inspection it named and imports the others', async () => {
        const h = failing({ inspectionId: 'insp-3', reason: 'photos' });
        const report = await runImport(package8.zip, h.send, h.options);
        expect(h.calls).toHaveLength(MAX_ATTEMPTS_PER_PART + 1);
        expect(h.calls.at(-1)).toEqual(package8.ids.filter((id) => id !== 'insp-3'));
        expect(report.imported).toEqual(package8.ids.filter((id) => id !== 'insp-3'));
        expect(report.heldBack).toEqual([{ id: 'insp-3', reason: 'apply_failed', status: 503, code: 'SERVICE_UNAVAILABLE', detail: 'photos' }]);
        accounted(report, package8.ids);
    });

    it.each([
        ['names no inspection', undefined],
        ['names an inspection but gives no reason', { inspectionId: 'insp-3' }],
        ['names an inspection outside the part', { inspectionId: 'insp-elsewhere', reason: 'photos' }],
    ])('a 503 that %s holds the whole part back (control)', async (_name, details) => {
        const h = failing(details);
        const report = await runImport(package8.zip, h.send, h.options);
        expect(h.calls).toHaveLength(MAX_ATTEMPTS_PER_PART);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.map((x) => [x.id, x.reason])).toEqual(package8.ids.map((id) => [id, 'gave_up']));
    });

    it('a key held by another request is never turned into a failure of that inspection (control)', async () => {
        const h = harness((_n, ids) => (ids.includes('insp-3') ? refusal(409, 'CONFLICT', { inspectionId: 'insp-3', idempotencyKey: 'k', reason: 'idempotency_in_flight' }) : { status: 500 }));
        const report = await runImport(package8.zip, h.send, h.options);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.every((x) => x.reason === 'gave_up')).toBe(true);
    });

    it('several inspections that keep failing are cut away one at a time, each once', async () => {
        const bad = ['insp-1', 'insp-5'];
        const h = harness((_n, ids, bytes) => {
            const first = ids.find((id) => bad.includes(id));
            return first ? refusal(503, 'SERVICE_UNAVAILABLE', { inspectionId: first, reason: 'yjs' }) : confirmedFor(bytes);
        });
        const report = await runImport(package8.zip, h.send, h.options);
        expect(report.heldBack.map((x) => [x.id, x.reason])).toEqual([['insp-1', 'apply_failed'], ['insp-5', 'apply_failed']]);
        expect(report.imported).toEqual(package8.ids.filter((id) => !bad.includes(id)));
        accounted(report, package8.ids);
    });
});

describe('runImport: a queued write the server answered with a 400', () => {
    const queued = (status: number, extra: Record<string, unknown> = {}) =>
        refusal(400, 'BAD_REQUEST', { idempotencyKey: 'k-update-insp-1-0', op: 'inspection.update', inspectionId: 'insp-1', status, ...extra });

    it.each([429, 408, 503])('details.status %s is a retry, not a permanent refusal', async (status) => {
        const h = harness((n, _ids, bytes) => (n <= 2 ? queued(status) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, package5.ids, package5.ids]);
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
    });

    it('that never goes through leaves the one inspection behind as apply_failed', async () => {
        const h = harness((_n, ids, bytes) => (ids.includes('insp-1') ? queued(429) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(report.heldBack).toEqual([{ id: 'insp-1', reason: 'apply_failed', status: 400, code: 'BAD_REQUEST' }]);
        expect(report.imported).toEqual(package5.ids.filter((id) => id !== 'insp-1'));
    });

    it('a permanent refusal of the write is not retried (control)', async () => {
        const h = harness((_n, ids, bytes) => (ids.includes('insp-1') ? queued(422) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(2);
        expect(report.heldBack.map((x) => [x.id, x.reason])).toEqual([['insp-1', 'apply_failed']]);
    });

    it('a 400 that only carries a status of 429 and no write is a different report (control)', async () => {
        const h = harness((_n, ids, bytes) => (ids.includes('insp-1') ? refusal(400, 'BAD_REQUEST', { inspectionId: 'insp-1', status: 429 }) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(2);
        expect(report.heldBack.map((x) => [x.id, x.reason])).toEqual([['insp-1', 'different_report']]);
    });
});

describe('runImport: the reason an inspection is held back', () => {
    const reasonOf = async (answer: ReturnType<typeof refusal>): Promise<string | undefined> => {
        const h = harness((_n, ids, bytes) => (ids.includes('insp-1') ? answer : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        return report.heldBack.find((x) => x.id === 'insp-1')?.reason;
    };
    const write = { idempotencyKey: 'k', op: 'inspection.update', inspectionId: 'insp-1' };

    it('deleted is only PACKAGE_INSPECTION_DELETED', async () => {
        expect(await reasonOf(refusal(409, 'PACKAGE_INSPECTION_DELETED', { inspectionId: 'insp-1' }))).toBe('deleted');
        expect(await reasonOf(refusal(409, 'CONFLICT', { inspectionId: 'insp-1' }))).toBe('refused');
        expect(await reasonOf(refusal(409, 'CONFLICT', { ...write, status: 409 }))).toBe('apply_failed');
    });

    it.each([
        [404, 'NOT_FOUND', 'not_found'],
        [403, 'FORBIDDEN', 'forbidden'],
        [400, 'BAD_REQUEST', 'different_report'],
    ] as const)('%s without a queued write keeps its own reason (control)', async (status, code, reason) => {
        expect(await reasonOf(refusal(status, code, { inspectionId: 'insp-1' }))).toBe(reason);
    });

    it.each([
        [404, 'NOT_FOUND'],
        [403, 'FORBIDDEN'],
        [400, 'BAD_REQUEST'],
        [422, 'UNPROCESSABLE_ENTITY'],
    ] as const)('%s that carries a queued write is apply_failed', async (status, code) => {
        expect(await reasonOf(refusal(status, code, { ...write, status }))).toBe('apply_failed');
    });
});

describe('runImport: a key another request holds', () => {
    const inFlight = refusal(409, 'CONFLICT', { reason: 'idempotency_in_flight' });

    it('is waited for longer than other failures, within the window, and then given up on', async () => {
        const h = harness(() => inFlight);
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls.length).toBeGreaterThan(MAX_ATTEMPTS_PER_PART);
        expect(sum(h.sleeps)).toBeLessThanOrEqual(MAX_RETRY_WINDOW_MS);
        expect(sum(h.sleeps)).toBeGreaterThan(MAX_RETRY_WINDOW_MS - BACKOFF_CAP_MS);
        expect(Math.max(...h.sleeps)).toBe(BACKOFF_CAP_MS);
        expect(report.heldBack.every((x) => x.reason === 'gave_up' && x.status === 409)).toBe(true);
    });

    it('is imported when the key is released after a long wait', async () => {
        const h = harness((n, _ids, bytes) => (n <= 12 ? inFlight : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(13);
        expect(report.imported).toEqual(package5.ids);
    });

    it('other failures keep their short budget (control)', async () => {
        const h = harness(() => refusal(503, 'SERVICE_UNAVAILABLE'));
        await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(MAX_ATTEMPTS_PER_PART);
    });

    it('a failure in between does not use up the key budget', async () => {
        const h = harness((n, _ids, bytes) => (n === 7 ? refusal(503, 'SERVICE_UNAVAILABLE') : n <= 9 ? inFlight : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(report.imported).toEqual(package5.ids);
    });
});

describe('runImport: a 200 that counts something else', () => {
    it('is not a confirmation when it counts another number of inspections', async () => {
        const wrong = (bytes: Uint8Array) => {
            const answer = confirmedFor(bytes);
            return { ...answer, body: { success: true, data: { ...(answer.body as { data: object }).data, inspections: 4 } } };
        };
        const h = harness((n, _ids, bytes) => (n === 1 ? wrong(bytes) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, package5.ids]);
        expect(report.imported).toEqual(package5.ids);
    });

    it('classifyResponse: the count is checked only against a count it is given', () => {
        const answer = confirmedFor(package5.zip);
        expect(classifyResponse(answer, 5).kind).toBe('confirmed');
        expect(classifyResponse(answer, 4).kind).toBe('retry');
        expect(classifyResponse(answer).kind).toBe('confirmed');
    });
});

describe('runImport: bounded without wrongly giving up', () => {
    it('halving a large package to single inspections reaches every one of them', async () => {
        const forty = makeCase({ inspections: 40 });
        const h = harness(() => ({ status: 413 }));
        const report = await runImport(forty.zip, h.send, h.options);
        // Each request is a part of the cut: a tree of 40 leaves has 79 nodes, so the loop ends by itself.
        expect(h.calls).toHaveLength(79);
        expect(report.heldBack.every((x) => x.reason === 'too_large_to_split')).toBe(true);
        accounted(report, forty.ids);
    });

    it('halving still lets the parts that fit through', async () => {
        const forty = makeCase({ inspections: 40 });
        const h = harness((_n, ids, bytes) => (ids.length > 3 ? { status: 413 } : confirmedFor(bytes)));
        const report = await runImport(forty.zip, h.send, h.options);
        expect(report.imported).toEqual(forty.ids);
        expect(report.heldBack).toEqual([]);
    });
});

describe('runImport: a callback that throws', () => {
    const limits = { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * MIB };

    it('keeps what was imported and holds the rest back with a detail', async () => {
        const h = harness((n, _ids, bytes) => (n === 1 ? refusal(422, 'PACKAGE_TOO_LARGE', { limits }) : confirmedFor(bytes)));
        let calls = 0;
        const report = await runImport(package5.zip, h.send, {
            ...h.options,
            onProgress: () => { if (++calls === 3) throw new Error('progress view is gone'); },
        });
        expect(report.imported.length).toBeGreaterThan(0);
        expect(report.heldBack.length).toBeGreaterThan(0);
        expect(report.heldBack.every((x) => x.reason === 'gave_up' && x.detail === 'local_error')).toBe(true);
        // The part that was confirmed before the callback failed is not sent again.
        expect(new Set(h.calls.slice(1).flat()).size).toBe(h.calls.slice(1).flat().length);
        accounted(report, package5.ids);
    });

    it('a callback that does not throw imports everything (control)', async () => {
        const h = harness((n, _ids, bytes) => (n === 1 ? refusal(422, 'PACKAGE_TOO_LARGE', { limits }) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, { ...h.options, onProgress: () => undefined });
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
    });
});
