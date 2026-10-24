/**
 * Review focus 1, as a property: whatever the package and whatever the server
 * does, every input inspection ends up imported or held back, in exactly one of
 * the two, and nothing the server did not confirm is reported as imported.
 *
 * Random packages meet random faults. The generator is a small seeded PRNG so a
 * failure is reproducible: the seed is part of every assertion message, and
 * `OFFLINE_PACKAGE_SEED` replays one.
 */
import { describe, it, expect } from 'vitest';
import { MAX_ATTEMPTS_PER_PART, extractHeldBackPackage, readPackageSummary, runImport, type SendResult } from '@core/offline-package';
import { makeCase, mustBeValid } from '../helpers/offline-package-cases';
import { confirmedFor, crossingProblems, harness, partitionProblems, refusal } from '../helpers/offline-package-harness';

const MIB = 1024 * 1024;
const BASE_SEED = Number(process.env.OFFLINE_PACKAGE_SEED ?? 20261019);
const CASES = 120;
/** Each case unpacks and validates every part it sends with the engine's reader, which is slow under a loaded machine. */
const PROPERTY_TIMEOUT_MS = 120_000;

/** mulberry32: small, fast and the same on every machine. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type PoisonKind = 'not_found' | 'forbidden' | 'different_report' | 'deleted' | 'apply';

interface World {
    count: number;
    poison: Map<string, PoisonKind>;
    limits: { inspections: number; outbox: number; photos: number; compressedBytes: number };
    wholePackageRefused: boolean;
    transient: Array<SendResult | 'throw' | null>;
}

function buildWorld(seed: number): { world: World; spec: Parameters<typeof makeCase>[0] } {
    const rand = prng(seed);
    const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
    const count = int(1, 12);
    const creates: number[] = [];
    const photos: Record<number, number> = {};
    const updates: Record<number, number> = {};
    const poison = new Map<string, PoisonKind>();
    const kinds: PoisonKind[] = ['not_found', 'forbidden', 'different_report', 'deleted', 'apply'];
    for (let i = 0; i < count; i++) {
        if (rand() < 0.3) creates.push(i);
        photos[i] = int(0, 3);
        updates[i] = int(0, 2);
        if (rand() < 0.25) poison.set(`insp-${i}`, kinds[int(0, kinds.length - 1)]!);
    }
    const transientKinds: Array<SendResult | 'throw'> = [
        'throw', refusal(500, 'INTERNAL_ERROR'), refusal(429, 'RATE_LIMITED'), refusal(408, 'TIMEOUT'),
        refusal(409, 'CONFLICT', { reason: 'idempotency_in_flight' }), { status: 200 }, { status: 200, body: { success: true, data: {} } },
    ];
    const transient = Array.from({ length: 40 }, () => (rand() < 0.25 ? transientKinds[int(0, transientKinds.length - 1)]! : null));
    const world: World = {
        count,
        poison,
        limits: {
            inspections: rand() < 0.5 ? int(1, 8) : 8,
            // No lower than one inspection's own writes (a create and two updates), so a limit never
            // makes a single inspection unsendable by itself.
            outbox: rand() < 0.3 ? int(3, 20) : 20,
            photos: rand() < 0.3 ? int(3, 50) : 50,
            compressedBytes: 16 * MIB,
        },
        wholePackageRefused: rand() < 0.05,
        transient,
    };
    return { world, spec: { inspections: count, creates, photos, updates } };
}

function serverFor(world: World, confirmedSoFar: Set<string>, violations: string[]) {
    return (call: number, ids: string[], bytes: Uint8Array): SendResult | 'throw' => {
        if (world.wholePackageRefused) return refusal(403, 'FORBIDDEN');
        const { counts } = readPackageSummary(bytes);
        const over = counts.inspections > world.limits.inspections ? 'inspections'
            : counts.writes > world.limits.outbox ? 'outbox'
                : counts.photos > world.limits.photos ? 'photos' : null;
        if (over) return refusal(422, 'PACKAGE_TOO_LARGE', { limit: over, max: world.limits[over], actual: counts[over === 'outbox' ? 'writes' : over], limits: world.limits });

        const fault = world.transient[call - 1];
        if (fault === 'throw') return 'throw';
        if (fault) return fault;

        const poisoned = ids.filter((id) => world.poison.has(id));
        if (poisoned.length > 0) {
            const first = poisoned[0]!;
            switch (world.poison.get(first)) {
                case 'not_found': return refusal(404, 'NOT_FOUND', { inspectionId: first });
                case 'forbidden': return refusal(403, 'FORBIDDEN', { inspectionId: first });
                case 'different_report': return refusal(400, 'BAD_REQUEST', { inspectionId: first });
                case 'apply': return refusal(422, 'UNPROCESSABLE_ENTITY', { inspectionId: first, reason: 'yjs' });
                default: {
                    const deleted = poisoned.filter((id) => world.poison.get(id) === 'deleted');
                    return refusal(409, 'PACKAGE_INSPECTION_DELETED', { inspectionId: deleted[0], inspectionIds: deleted });
                }
            }
        }
        for (const id of ids) if (confirmedSoFar.has(id)) violations.push(`${id} was sent again after it was confirmed (call ${call})`);
        for (const id of ids) confirmedSoFar.add(id);
        return confirmedFor(bytes);
    };
}

describe(`runImport over random packages and random faults (seed ${BASE_SEED}, ${CASES} cases)`, () => {
    it('never loses, invents or double-counts an inspection, and never reports an unconfirmed one as imported', async () => {
        let held = 0;
        let imported = 0;
        let splitCases = 0;
        let heldPackages = 0;
        for (let n = 0; n < CASES; n++) {
            const seed = BASE_SEED + n;
            const { world, spec } = buildWorld(seed);
            const { zip, ids } = makeCase(spec);
            const original = mustBeValid(zip);
            const confirmedSoFar = new Set<string>();
            const violations: string[] = [];
            const h = harness(serverFor(world, confirmedSoFar, violations));
            const where = `seed ${seed}`;

            const report = await runImport(zip, h.send, h.options);

            expect(partitionProblems(report, ids), where).toEqual([]);
            expect([...h.confirmed].sort(), `${where}: imported is exactly what the server confirmed`).toEqual([...report.imported].sort());
            for (const id of report.imported) expect(world.poison.has(id), `${where}: ${id} is poisoned but reported imported`).toBe(false);
            for (const id of world.poison.keys()) {
                expect(report.heldBack.map((x) => x.id), `${where}: poisoned ${id} must be held back`).toContain(id);
            }
            if (world.wholePackageRefused) expect(report.imported, where).toEqual([]);
            expect(violations, where).toEqual([]);
            expect(h.maxInFlight, `${where}: serial`).toBeLessThanOrEqual(1);
            expect(h.invalid, `${where}: every part is a package the engine accepts`).toEqual([]);
            for (const view of h.views) expect(crossingProblems(original, view), where).toEqual([]);
            expect(report.requests, where).toBe(h.calls.length);
            // Review focus 7: what was left behind can be handed on as a package of its own.
            if (report.heldBack.length > 0) {
                const heldIds = report.heldBack.map((x) => x.id);
                const held = mustBeValid(extractHeldBackPackage(zip, heldIds));
                expect(held.ids, `${where}: the held-back package carries exactly the held-back inspections`).toEqual(ids.filter((id) => heldIds.includes(id)));
                expect(crossingProblems(original, held), where).toEqual([]);
                heldPackages++;
            }
            expect(h.calls.length, `${where}: bounded`).toBeLessThanOrEqual((ids.length + 2) * MAX_ATTEMPTS_PER_PART);
            for (const x of report.heldBack) {
                expect(['not_found', 'forbidden', 'different_report', 'deleted', 'apply_failed', 'refused', 'too_large_to_split', 'package_rejected', 'gave_up'], where).toContain(x.reason);
            }

            held += report.heldBack.length;
            imported += report.imported.length;
            if (h.calls.length > 1) splitCases++;
        }
        // The generator exercises both outcomes and the split path; a run that never did would prove nothing.
        expect(imported).toBeGreaterThan(0);
        expect(held).toBeGreaterThan(0);
        expect(splitCases).toBeGreaterThan(CASES / 4);
        expect(heldPackages).toBeGreaterThan(CASES / 8);
    }, PROPERTY_TIMEOUT_MS);

    it('with no transient faults, holds back exactly the refused inspections, each for the reason its refusal gave', async () => {
        const reasonFor: Record<PoisonKind, string> = {
            not_found: 'not_found', forbidden: 'forbidden', different_report: 'different_report', deleted: 'deleted', apply: 'apply_failed',
        };
        let withPoison = 0;
        for (let n = 0; n < CASES; n++) {
            const seed = BASE_SEED + 2000 + n;
            const { world, spec } = buildWorld(seed);
            world.transient.fill(null);
            world.wholePackageRefused = false;
            const { zip, ids } = makeCase(spec);
            const h = harness(serverFor(world, new Set(), []));
            const report = await runImport(zip, h.send, h.options);
            // The reason is the check that catches an inspection dropped without being recorded: a
            // dropped one would otherwise surface as the generic "gave up".
            expect(report.heldBack.map((x) => [x.id, x.reason]), `seed ${seed}`)
                .toEqual(ids.filter((id) => world.poison.has(id)).map((id) => [id, reasonFor[world.poison.get(id)!]]));
            expect(report.imported, `seed ${seed}`).toEqual(ids.filter((id) => !world.poison.has(id)));
            if (world.poison.size > 0) withPoison++;
        }
        expect(withPoison).toBeGreaterThan(CASES / 4);
    }, PROPERTY_TIMEOUT_MS);

    it('imports everything when the server never faults (control)', async () => {
        for (let n = 0; n < 30; n++) {
            const seed = BASE_SEED + 1000 + n;
            const { world, spec } = buildWorld(seed);
            world.poison.clear();
            world.transient.fill(null);
            world.wholePackageRefused = false;
            const { zip, ids } = makeCase(spec);
            const h = harness(serverFor(world, new Set(), []));
            const report = await runImport(zip, h.send, h.options);
            expect(report.imported, `seed ${seed}`).toEqual(ids);
            expect(report.heldBack, `seed ${seed}`).toEqual([]);
        }
    }, PROPERTY_TIMEOUT_MS);
});
