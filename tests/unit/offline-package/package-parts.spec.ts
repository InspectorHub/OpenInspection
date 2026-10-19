/**
 * Reading, splitting and planning offline packages with `@core/offline-package`.
 * Every refusal is paired with a positive control, and every package the code
 * writes is judged by the ENGINE's own reader (`engineReads`), not by the code
 * that wrote it.
 */
import { describe, it, expect } from 'vitest';
import {
    PackageFormatError, extractHeldBackPackage, parsePackage, planParts, readPackageSummary, splitPackage,
    type PartLimits,
} from '@core/offline-package';
import { buildPackage } from '../helpers/offline-package-fixture';
import {
    bytesFor, corruptEntryData, engineReads, inspectionId, makeCase, mustBeValid, photoId, withExtraEntry, withOrphanPhoto,
    withoutManifest, withoutYjs,
} from '../helpers/offline-package-cases';
import { crossingProblems } from '../helpers/offline-package-harness';

const MIB = 1024 * 1024;
const GENEROUS: PartLimits = { inspections: 8, outbox: 20, photos: 50, compressedBytes: 16 * MIB };

describe('the fixture generator', () => {
    const spec = { inspections: 3, creates: [1], photos: { 0: 2, 2: 1 }, updates: { 0: 1, 1: 1 } };

    it('writes packages the engine accepts', () => {
        const view = mustBeValid(makeCase(spec).zip);
        expect(view.ids).toEqual(['insp-0', 'insp-1', 'insp-2']);
        expect(view.photos.get('insp-0')).toHaveLength(2);
        expect(view.writes.get('insp-1')).toEqual(['k-create-insp-1', 'k-update-insp-1-0']);
    });

    it.each([
        ['an entry name the engine does not know', withExtraEntry(spec)],
        ['no manifest', withoutManifest()],
        ['a photo for an inspection outside the manifest', withOrphanPhoto()],
        ['no Yjs state for an inspection', withoutYjs()],
    ])('writes a package the engine refuses: %s', (_name, zip) => {
        expect(engineReads(zip).ok).toBe(false);
        expect(() => parsePackage(zip)).toThrow(PackageFormatError);
    });
});

describe('readPackageSummary', () => {
    const photoBytes = new Uint8Array(4000).fill(7);
    const zip = buildPackage({
        tenantId: 'tenant-1',
        inspections: [{ id: 'insp-0', reportId: 'rep-0' }, { id: 'insp-1', reportId: 'rep-1' }],
        yjs: { 'insp-0': bytesFor('a', 32), 'insp-1': bytesFor('b', 32) },
        outbox: [{ idempotencyKey: 'k1', op: 'inspection.update', payload: { id: 'insp-0', title: 't' } }],
        media: [{ pendingId: 'ph-1', inspectionId: 'insp-0', contentType: 'image/jpeg', bytes: photoBytes }],
    });

    it('reports the manifest and the three counts', () => {
        const summary = readPackageSummary(zip);
        expect(summary.counts).toEqual({ inspections: 2, writes: 1, photos: 1 });
        expect(summary.manifest.tenantId).toBe('tenant-1');
        expect(summary.bytes).toBe(zip.length);
    });

    it('does not unpack photos: a damaged photo does not change the answer', () => {
        const damaged = corruptEntryData(zip, 'media/ph-1.jpg');
        // The control: the same damage stops anything that does unpack the photo.
        expect(() => parsePackage(damaged)).toThrow(PackageFormatError);
        expect(readPackageSummary(damaged).counts).toEqual({ inspections: 2, writes: 1, photos: 1 });
    });

    it('refuses what is not a package', () => {
        expect(() => readPackageSummary(withoutManifest())).toThrow(PackageFormatError);
        expect(() => readPackageSummary(new Uint8Array([1, 2, 3]))).toThrow(PackageFormatError);
    });

    describe('the declared unpacked size', () => {
        // 4000 bytes of photo and two 32-byte states plus the indexes: well under 10 KiB, well over 1 KiB.
        it('is checked before anything is inflated, against the caller\'s limit', () => {
            expect(() => parsePackage(zip, { maxUncompressedBytes: 1024 })).toThrow(PackageFormatError);
            expect(() => readPackageSummary(zip, { maxUncompressedBytes: 1024 })).toThrow(PackageFormatError);
        });

        it('lets the same package through under a larger limit, and by default (control)', () => {
            expect(parsePackage(zip, { maxUncompressedBytes: 10 * 1024 }).manifest.inspections).toHaveLength(2);
            expect(readPackageSummary(zip, { maxUncompressedBytes: 10 * 1024 }).counts.inspections).toBe(2);
            expect(parsePackage(zip).manifest.inspections).toHaveLength(2);
        });
    });
});

describe('splitPackage', () => {
    const { zip } = makeCase({ inspections: 4, creates: [1], photos: { 0: 2, 1: 1, 3: 3 }, updates: { 0: 1, 1: 2, 2: 1 } });
    const original = mustBeValid(zip);

    it('moves each named inspection whole, and both halves are packages the engine accepts', () => {
        const { part, rest } = splitPackage(zip, ['insp-1', 'insp-3']);
        const partView = mustBeValid(part);
        const restView = mustBeValid(rest!);
        expect(partView.ids).toEqual(['insp-1', 'insp-3']);
        expect(restView.ids).toEqual(['insp-0', 'insp-2']);
        expect(crossingProblems(original, partView)).toEqual([]);
        expect(crossingProblems(original, restView)).toEqual([]);
        expect(partView.writes.get('insp-1')).toEqual(['k-create-insp-1', 'k-update-insp-1-0', 'k-update-insp-1-1']);
        expect(partView.photos.get('insp-3')).toHaveLength(3);
        expect(restView.photos.get('insp-0')).toHaveLength(2);
    });

    it('trims the manifest to the part and keeps what else the manifest said', () => {
        const { part, rest } = splitPackage(zip, ['insp-2']);
        expect(readPackageSummary(part).counts).toEqual({ inspections: 1, writes: 1, photos: 0 });
        expect(readPackageSummary(rest!).counts).toEqual({ inspections: 3, writes: 4, photos: 6 });
        expect(readPackageSummary(part).manifest).toMatchObject({ tenantId: 'tenant-1', exportedBy: 'user-a', deviceId: 'device-1' });
    });

    it('leaves nothing in the rest when every inspection is named', () => {
        const everything = splitPackage(zip, original.ids);
        expect(everything.rest).toBeNull();
        expect(mustBeValid(everything.part).ids).toEqual(original.ids);
    });

    it('refuses an empty or unknown naming', () => {
        expect(() => splitPackage(zip, [])).toThrow(PackageFormatError);
        expect(() => splitPackage(zip, ['insp-404'])).toThrow(PackageFormatError);
    });

    it('extractHeldBackPackage is a package of its own for the held inspections', () => {
        const held = mustBeValid(extractHeldBackPackage(zip, ['insp-0', 'insp-2']));
        expect(held.ids).toEqual(['insp-0', 'insp-2']);
        expect(crossingProblems(original, held)).toEqual([]);
    });

    describe('a photo in another inspection\'s part (review focus 2)', () => {
        // The engine's own checks accept this package: its media index is consistent with its manifest.
        // Only comparing content with the original shows the photo moved to the wrong inspection, so
        // this is what the content check must catch, and what a wrong implementation would produce.
        const brokenPart = buildPackage({
            tenantId: 'tenant-1',
            inspections: [{ id: 'insp-1', reportId: 'rep-1' }],
            yjs: { 'insp-1': original.yjs.get('insp-1')! },
            media: [{ pendingId: photoId(0, 0), inspectionId: 'insp-1', contentType: 'image/jpeg', bytes: original.photoBytes.get(photoId(0, 0))! }],
        });

        it('is something the engine accepts and the content check refuses', () => {
            const view = mustBeValid(brokenPart);
            expect(crossingProblems(original, view).join('\n')).toContain('insp-1: photos');
        });

        it('is not what splitPackage produces: the same check is clean for the real part', () => {
            const real = mustBeValid(splitPackage(zip, ['insp-1']).part);
            expect(crossingProblems(original, real)).toEqual([]);
            expect(real.photos.get('insp-1')).toEqual([photoId(1, 0)]);
            expect(real.photos.get('insp-1')).not.toContain(photoId(0, 0));
        });

        it('a photo left behind in a part that lacks its inspection is refused by the engine', () => {
            expect(engineReads(withOrphanPhoto()).ok).toBe(false);
        });
    });
});

describe('planParts', () => {
    function check(plan: ReturnType<typeof planParts>, original: ReturnType<typeof mustBeValid>, limits: PartLimits): void {
        const seen: string[] = [];
        for (const part of plan.parts) {
            const view = mustBeValid(part.bytes);
            expect(view.ids).toEqual(part.ids);
            expect(view.ids.length).toBeLessThanOrEqual(limits.inspections);
            expect([...view.writes.values()].flat().length).toBeLessThanOrEqual(limits.outbox);
            expect([...view.photos.values()].flat().length).toBeLessThanOrEqual(limits.photos);
            expect(part.bytes.length).toBeLessThanOrEqual(limits.compressedBytes);
            expect(crossingProblems(original, view)).toEqual([]);
            seen.push(...view.ids);
        }
        // Nothing lost and nothing twice: every inspection is in exactly one part or is too large.
        expect([...seen, ...plan.tooLarge].sort()).toEqual([...original.ids].sort());
    }

    it('keeps every part within every limit and never splits an inspection', () => {
        const { zip } = makeCase({ inspections: 10, creates: [4, 9], photos: { 0: 3, 3: 2, 5: 4, 8: 1 }, updates: { 1: 2, 2: 2, 4: 1, 7: 3 } });
        const original = mustBeValid(zip);
        const limits: PartLimits = { inspections: 3, outbox: 5, photos: 6, compressedBytes: 16 * MIB };
        const plan = planParts(zip, limits);
        expect(plan.tooLarge).toEqual([]);
        expect(plan.parts.length).toBeGreaterThan(1);
        check(plan, original, limits);
    });

    it('sends the part that carries a create first', () => {
        const { zip } = makeCase({ inspections: 6, creates: [5] });
        const plan = planParts(zip, { ...GENEROUS, inspections: 2 });
        expect(plan.parts[0]!.ids).toContain('insp-5');
        expect(plan.parts.flatMap((p) => p.ids).sort()).toEqual(mustBeValid(zip).ids);
    });

    it('is one part when the package already fits', () => {
        const { zip } = makeCase({ inspections: 5, photos: { 0: 2 }, updates: { 1: 1 } });
        const plan = planParts(zip, GENEROUS);
        expect(plan.parts.map((p) => p.ids)).toEqual([['insp-0', 'insp-1', 'insp-2', 'insp-3', 'insp-4']]);
        expect(plan.tooLarge).toEqual([]);
    });

    it('holds back an inspection that is over a limit on its own, and still plans the rest', () => {
        const { zip } = makeCase({ inspections: 4, photos: { 2: 7 }, updates: { 0: 1 } });
        const limits: PartLimits = { inspections: 8, outbox: 20, photos: 6, compressedBytes: 16 * MIB };
        const plan = planParts(zip, limits);
        expect(plan.tooLarge).toEqual(['insp-2']);
        expect(plan.parts.flatMap((p) => p.ids)).toEqual(['insp-0', 'insp-1', 'insp-3']);
        check(plan, mustBeValid(zip), limits);
        // The control: with room for seven photos the same inspection is planned.
        expect(planParts(zip, { ...limits, photos: 7 }).tooLarge).toEqual([]);
    });

    it('holds back an inspection whose bytes alone exceed the compressed limit', () => {
        const { zip } = makeCase({ inspections: 3, photos: { 1: 3 }, photoBytes: 9000 });
        const limits: PartLimits = { inspections: 8, outbox: 20, photos: 50, compressedBytes: 20_000 };
        const plan = planParts(zip, limits);
        expect(plan.tooLarge).toEqual(['insp-1']);
        check(plan, mustBeValid(zip), limits);
    });

    describe('a limit the server has not stated', () => {
        // One inspection with 210 photos is 214 entries: over the default of 200, which is only a guess.
        const { zip } = makeCase({ inspections: 2, photos: { 0: 210 }, photoBytes: 10 });
        const wide: PartLimits = { inspections: 8, outbox: 20, photos: 1500, compressedBytes: 16 * MIB };

        it('does not condemn an inspection on the default entry count; the server corrects it', () => {
            const plan = planParts(zip, wide);
            expect(plan.tooLarge).toEqual([]);
            expect(plan.parts.flatMap((p) => p.ids).sort()).toEqual(['insp-0', 'insp-1']);
        });

        it('holds it back once the server has named the entry count (control)', () => {
            const plan = planParts(zip, { ...wide, entries: 200 });
            expect(plan.tooLarge).toEqual(['insp-0']);
            expect(plan.parts.flatMap((p) => p.ids)).toEqual(['insp-1']);
        });
    });

    it('splits by size when the counts fit but the bytes do not', () => {
        const { zip } = makeCase({ inspections: 6, photos: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 }, photoBytes: 4000 });
        const limits: PartLimits = { inspections: 8, outbox: 20, photos: 50, compressedBytes: 30_000 };
        const plan = planParts(zip, limits);
        expect(plan.tooLarge).toEqual([]);
        expect(plan.parts.length).toBeGreaterThan(1);
        check(plan, mustBeValid(zip), limits);
    });
});
