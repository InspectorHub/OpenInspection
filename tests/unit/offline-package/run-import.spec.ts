/**
 * The import state machine, against a scripted stand-in for the endpoint. Every
 * refusal class has a positive control in this file: the same situation with the
 * one distinguishing field changed, so a machine that treats everything the same
 * way cannot pass.
 */
import { describe, it, expect } from 'vitest';
import {
    BACKOFF_BASE_MS, MAX_ATTEMPTS_PER_PART, MAX_RETRY_WINDOW_MS, PackageFormatError, readPackageSummary, runImport,
    type ImportReport,
} from '@core/offline-package';
import { makeCase } from '../helpers/offline-package-cases';
import { confirmedFor, harness, partitionProblems, refusal } from '../helpers/offline-package-harness';

const MIB = 1024 * 1024;
const LIMITS = { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * MIB };
const package5 = makeCase({ inspections: 5, creates: [2], photos: { 0: 1, 3: 2 }, updates: { 1: 1, 2: 1 } });

function expectAccountedFor(report: ImportReport, ids: readonly string[]): void {
    expect(partitionProblems(report, ids)).toEqual([]);
}

describe('runImport: the whole package fits', () => {
    it('is one request and everything is imported', async () => {
        const h = harness((_n, _ids, bytes) => confirmedFor(bytes, { skipped: 3 }));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids]);
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
        expect(report.skipped).toBe(3);
        expect(report.applied).toBe(3);
        expect(report.requests).toBe(1);
        expect(h.invalid).toEqual([]);
    });

    it('refuses to start from something that is not a package, before any request', async () => {
        const h = harness((_n, _ids, bytes) => confirmedFor(bytes));
        await expect(runImport(new Uint8Array([1, 2, 3]), h.send, h.options)).rejects.toBeInstanceOf(PackageFormatError);
        expect(h.calls).toEqual([]);
    });
});

describe('runImport: too large', () => {
    const limits = { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * MIB };

    it.each([
        ['422', refusal(422, 'PACKAGE_TOO_LARGE', { limit: 'inspections', max: 2, actual: 5, limits })],
        ['413', refusal(413, 'PACKAGE_TOO_LARGE', { limit: 'compressedBytes', max: 16 * MIB, actual: 20 * MIB, limits })],
    ])('cuts the package to the limits the %s names and sends the parts one after another', async (_status, tooLarge) => {
        const h = harness((n, _ids, bytes) => (n === 1 ? tooLarge : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls[0]).toEqual(package5.ids);
        expect(h.calls.slice(1).every((ids) => ids.length <= 2)).toBe(true);
        expect(h.calls.slice(1).flat().sort()).toEqual(package5.ids);
        // The part that carries insp-2's create is the first one sent after the refusal.
        expect(h.calls[1]).toContain('insp-2');
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
        expect(h.maxInFlight).toBe(1);
        expect(h.invalid).toEqual([]);
    });

    it('does not cut when the answer is not a size refusal (control)', async () => {
        const h = harness((_n, _ids, bytes) => confirmedFor(bytes));
        await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(1);
    });

    it('holds back an inspection that is over the limits on its own', async () => {
        const big = makeCase({ inspections: 3, photos: { 1: 4 } });
        const tight = { inspections: 8, outbox: 20, photos: 3, compressedBytes: 16 * MIB };
        const h = harness((_n, ids, bytes) => (ids.length === 3 ? refusal(422, 'PACKAGE_TOO_LARGE', { limit: 'photos', max: 3, actual: 4, limits: tight }) : confirmedFor(bytes)));
        const report = await runImport(big.zip, h.send, h.options);
        expect(report.imported).toEqual(['insp-0', 'insp-2']);
        expect(report.heldBack).toEqual([{ id: 'insp-1', reason: 'too_large_to_split', status: 422, code: 'PACKAGE_TOO_LARGE' }]);
        expectAccountedFor(report, big.ids);
    });

    it('halves the package when the refusal offers no limits', async () => {
        const h = harness((_n, ids, bytes) => (ids.length > 2 ? { status: 413 } : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(report.imported).toEqual(package5.ids);
        expect(h.calls).toEqual([package5.ids, ['insp-0', 'insp-1', 'insp-2'], ['insp-0', 'insp-1'], ['insp-2'], ['insp-3', 'insp-4']]);
    });
});

describe('runImport: a refusal that names inspections', () => {
    const named = (status: number, code: string, details: Record<string, unknown>) => (id: string) => (ids: string[], bytes: Uint8Array) =>
        ids.includes(id) ? refusal(status, code, { inspectionId: id, ...details }) : confirmedFor(bytes);

    it.each([
        [404, 'NOT_FOUND', {}, 'not_found'],
        [403, 'FORBIDDEN', {}, 'forbidden'],
        [400, 'BAD_REQUEST', {}, 'different_report'],
        [400, 'BAD_REQUEST', { reason: 'photos' }, 'apply_failed'],
        [422, 'UNPROCESSABLE_ENTITY', { reason: 'yjs' }, 'apply_failed'],
    ] as const)('%s %s: the named inspection is held back and the rest is sent again without it', async (status, code, details, reason) => {
        const answer = named(status, code, details)('insp-1');
        const h = harness((_n, ids, bytes) => answer(ids, bytes));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, ['insp-0', 'insp-2', 'insp-3', 'insp-4']]);
        expect(report.imported).toEqual(['insp-0', 'insp-2', 'insp-3', 'insp-4']);
        expect(report.heldBack).toEqual([{ id: 'insp-1', reason, status, code, ...('reason' in details ? { detail: details.reason } : {}) }]);
        expectAccountedFor(report, package5.ids);
        expect(h.invalid).toEqual([]);
    });

    it('409 PACKAGE_INSPECTION_DELETED names several at once and one resend settles them all', async () => {
        const h = harness((_n, ids, bytes) => (ids.includes('insp-1') || ids.includes('insp-3')
            ? refusal(409, 'PACKAGE_INSPECTION_DELETED', { inspectionId: 'insp-1', inspectionIds: ['insp-1', 'insp-3'] })
            : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, ['insp-0', 'insp-2', 'insp-4']]);
        expect(report.heldBack.map((x) => [x.id, x.reason, x.status])).toEqual([['insp-1', 'deleted', 409], ['insp-3', 'deleted', 409]]);
        expect(report.imported).toEqual(['insp-0', 'insp-2', 'insp-4']);
    });

    it('follows several refusals one after another until none is left, each inspection once', async () => {
        const poisoned = ['insp-0', 'insp-2', 'insp-4'];
        const h = harness((_n, ids, bytes) => {
            const first = ids.find((id) => poisoned.includes(id));
            return first ? refusal(404, 'NOT_FOUND', { inspectionId: first }) : confirmedFor(bytes);
        });
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(4);
        expect(report.imported).toEqual(['insp-1', 'insp-3']);
        expect(report.heldBack.map((x) => x.id)).toEqual(poisoned);
        expectAccountedFor(report, package5.ids);
    });

    it('a failure while applying an inspection, naming it with a 503, is retried and not split (control)', async () => {
        const h = harness((n, ids, bytes) => (n <= 2 ? refusal(503, 'SERVICE_UNAVAILABLE', { inspectionId: 'insp-1', reason: 'photos' }) : confirmedFor(bytes, { applied: ids.length })));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, package5.ids, package5.ids]);
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
    });

    it('a name that is not in the part cannot be cut away, so the run stops rather than looping', async () => {
        const h = harness(() => refusal(404, 'NOT_FOUND', { inspectionId: 'insp-elsewhere' }));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(1);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.every((x) => x.reason === 'package_rejected')).toBe(true);
        expectAccountedFor(report, package5.ids);
    });
});

describe('runImport: a refusal of the whole package', () => {
    it.each([
        ['another workspace', refusal(403, 'FORBIDDEN')],
        ['a 403 for a missing capability', refusal(403, 'FORBIDDEN', { capability: 'editReports' })],
        ['a 400 that names no inspection', refusal(400, 'BAD_REQUEST')],
        ['an expired package', refusal(422, 'PACKAGE_EXPIRED', { maxAgeDays: 400 })],
        ['a package from the future', refusal(422, 'PACKAGE_FROM_THE_FUTURE', { maxFutureSkewDays: 1 })],
        ['a session that ended', refusal(401, 'UNAUTHORIZED')],
    ])('%s: stops at once and holds every inspection back', async (_name, answer) => {
        const h = harness(() => answer);
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(1);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.map((x) => x.id)).toEqual(package5.ids);
        expect(report.heldBack.every((x) => x.reason === 'package_rejected' && x.status === answer.status && x.code === answer.code)).toBe(true);
    });

    it('does not send the parts still waiting, and holds them back with the same reason', async () => {
        const limits = { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * MIB };
        const h = harness((n) => (n === 1 ? refusal(422, 'PACKAGE_TOO_LARGE', { limits }) : refusal(403, 'FORBIDDEN')));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(2);
        expect(report.heldBack.map((x) => x.id)).toEqual(package5.ids);
        expect(report.heldBack.every((x) => x.reason === 'package_rejected')).toBe(true);
    });

    it('the same 403 with an inspection named is a split, not a stop (control)', async () => {
        const h = harness((_n, ids, bytes) => (ids.includes('insp-0') ? refusal(403, 'FORBIDDEN', { inspectionId: 'insp-0' }) : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(report.imported).toEqual(['insp-1', 'insp-2', 'insp-3', 'insp-4']);
        expect(report.heldBack).toHaveLength(1);
    });
});

describe('runImport: retries', () => {
    const transient = [
        ['409 idempotency_in_flight', refusal(409, 'CONFLICT', { reason: 'idempotency_in_flight' })],
        ['500', refusal(500, 'INTERNAL_ERROR')],
        ['503', refusal(503, 'SERVICE_UNAVAILABLE')],
        ['408', refusal(408, 'TIMEOUT')],
        ['429', refusal(429, 'RATE_LIMITED')],
    ] as const;

    it.each(transient)('%s: waits, sends the same part again and does not split', async (_name, answer) => {
        const h = harness((n, _ids, bytes) => (n <= 2 ? answer : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, package5.ids, package5.ids]);
        expect(h.sleeps).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
        expect(report.imported).toEqual(package5.ids);
        expect(h.maxInFlight).toBe(1);
    });

    // A key held by another request has its own, longer budget (run-import-failures.spec.ts).
    it.each(transient.filter(([name]) => !name.includes('in_flight')))('%s: gives up after the attempts allowed and holds the part back', async (_name, answer) => {
        const h = harness(() => answer);
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(MAX_ATTEMPTS_PER_PART);
        expect(h.sleeps).toHaveLength(MAX_ATTEMPTS_PER_PART - 1);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.map((x) => x.id)).toEqual(package5.ids);
        expect(report.heldBack.every((x) => x.reason === 'gave_up' && x.status === answer.status)).toBe(true);
    });

    it('stops retrying once the time allowed has passed', async () => {
        let reads = 0;
        const h = harness(() => refusal(500, 'INTERNAL_ERROR'));
        const report = await runImport(package5.zip, h.send, { ...h.options, now: () => (reads++ === 0 ? 0 : MAX_RETRY_WINDOW_MS + 1) });
        expect(h.calls).toHaveLength(1);
        expect(h.sleeps).toEqual([]);
        expect(report.heldBack.every((x) => x.reason === 'gave_up')).toBe(true);
    });

    it('a part that gave up does not stop the parts after it', async () => {
        const limits = { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * MIB };
        const h = harness((n, ids, bytes) => {
            if (n === 1) return refusal(422, 'PACKAGE_TOO_LARGE', { limits });
            return ids.includes('insp-2') ? refusal(500, 'INTERNAL_ERROR') : confirmedFor(bytes);
        });
        const report = await runImport(package5.zip, h.send, h.options);
        const lost = report.heldBack.map((x) => x.id);
        expect(lost).toContain('insp-2');
        expect(report.imported.length + lost.length).toBe(5);
        expect(report.imported.length).toBeGreaterThan(0);
        expectAccountedFor(report, package5.ids);
    });
});

describe('runImport: an answer that does not confirm', () => {
    const unconfirmed = [
        ['a dropped connection', 'throw'],
        ['a 200 that is not JSON', { status: 200 }],
        ['a 200 with a string body', { status: 200, body: 'ok' }],
        ['a 200 without the outbox', { status: 200, body: { success: true, data: { inspections: 5, photos: 3, yjs: { changed: 1, unchanged: 0 } } } }],
        ['a 200 without the yjs counts', { status: 200, body: { success: true, data: { inspections: 5, photos: 3, outbox: { applied: 1, skipped: 0, failed: [] } } } }],
        ['a 200 whose failed list is malformed', { status: 200, body: { success: true, data: { inspections: 5, photos: 3, outbox: { applied: 1, skipped: 0, failed: [{ op: 'x' }] }, yjs: { changed: 1, unchanged: 0 } } } }],
        ['a 204', { status: 204 }],
    ] as const;

    it.each(unconfirmed)('%s is not an import: the part is sent again, and only a confirmed answer counts', async (_name, answer) => {
        const h = harness((n, _ids, bytes) => (n === 1 ? (answer as 'throw') : confirmedFor(bytes)));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toEqual([package5.ids, package5.ids]);
        expect(report.imported).toEqual(package5.ids);
        expect(h.confirmed.size).toBe(5);
    });

    it('never reports an inspection as imported on an answer it could not read', async () => {
        const h = harness(() => ({ status: 200, body: { success: true } }));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.every((x) => x.reason === 'gave_up')).toBe(true);
        expect(h.confirmed.size).toBe(0);
    });
});

describe('runImport: queued writes the server refused', () => {
    const failed = [
        { idempotencyKey: 'k-update-insp-1-0', op: 'inspection.update', inspectionId: 'insp-1', status: 422 },
        { idempotencyKey: 'k-update-insp-2-0', op: 'inspection.complete', inspectionId: 'insp-2', status: 424, reason: 'blocked_by_failed_update' },
        { idempotencyKey: 'k-create-insp-2', op: 'inspection.update', inspectionId: 'insp-2', status: 424, reason: 'a_reason_from_a_later_version' },
    ];

    it('lists them as needing attention and does not send the package again', async () => {
        const h = harness((_n, _ids, bytes) => confirmedFor(bytes, { failed }));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(h.calls).toHaveLength(1);
        expect(report.imported).toEqual(package5.ids);
        expect(report.heldBack).toEqual([]);
        expect(report.needsAttention).toEqual(failed);
        expect(report.needsAttention.at(-1)?.reason).toBe('a_reason_from_a_later_version');
    });

    it('is empty when nothing failed (control)', async () => {
        const h = harness((_n, _ids, bytes) => confirmedFor(bytes));
        expect((await runImport(package5.zip, h.send, h.options)).needsAttention).toEqual([]);
    });

    it('counts a write once when a resend reports it again', async () => {
        const h = harness((n, _ids, bytes) => (n === 1 ? { status: 500 } : confirmedFor(bytes, { failed: failed.slice(0, 1) })));
        const report = await runImport(package5.zip, h.send, h.options);
        expect(report.needsAttention).toHaveLength(1);
    });
});

describe('runImport: bounded and serial', () => {
    it('ends by itself when every answer sends the part back: each cut is strictly smaller', async () => {
        const three = makeCase({ inspections: 3 });
        // No limits to cut to, so every refusal halves the part; each one, a leaf included, is one resend.
        const h = harness(() => ({ status: 413 }));
        const report = await runImport(three.zip, h.send, h.options);
        expect(h.calls).toHaveLength(5);
        expect(report.imported).toEqual([]);
        expect(report.heldBack.map((x) => [x.id, x.reason])).toEqual([
            ['insp-0', 'too_large_to_split'], ['insp-1', 'too_large_to_split'], ['insp-2', 'too_large_to_split'],
        ]);
        expectAccountedFor(report, three.ids);
    });

    it('never has two requests in flight, and never sends a confirmed inspection again', async () => {
        const limits = { inspections: 1, outbox: 20, photos: 50, compressedBytes: 16 * MIB };
        const h = harness((n, ids, bytes) => (n === 1 ? refusal(422, 'PACKAGE_TOO_LARGE', { limits }) : n === 3 ? { status: 500 } : confirmedFor(bytes)));
        const confirmedBefore: string[] = [];
        const send: typeof h.send = async (bytes) => {
            const ids = readPackageSummary(bytes).manifest.inspections.map((i) => i.id);
            expect(ids.filter((id) => confirmedBefore.includes(id))).toEqual([]);
            const result = await h.send(bytes);
            if (result.status === 200) confirmedBefore.push(...ids);
            return result;
        };
        const report = await runImport(package5.zip, send, h.options);
        expect(h.maxInFlight).toBe(1);
        expect(report.imported).toEqual(package5.ids);
        expect(h.calls.filter((ids) => ids.length === 1)).toHaveLength(5 + 1);
    });
});
