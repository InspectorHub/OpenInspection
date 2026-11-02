/**
 * Keys a later writer adds to a manifest `inspections` entry (the manifest schema ignores
 * unknown keys) survive a split and a held-back extraction, for exactly the inspections a
 * part carries. The raw entries travel beside the parsed ones; the parsed values win for
 * `id` and `reportId`, and nothing outside manifest.json is touched.
 */
import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import {
    IMPORT_LIMIT_CEILINGS, OfflinePackageManifestSchema, PackageFormatError, extractHeldBackPackage, parsePackage, planParts,
    readPackageSummary, runImport, splitPackage, type Send,
} from '@core/offline-package';
import { buildPackage, declareEntrySize } from '../helpers/offline-package-fixture';
import { bytesFor, mustBeValid } from '../helpers/offline-package-cases';

const ids = ['insp-0', 'insp-1', 'insp-2', 'insp-3'];
const yjs = Object.fromEntries(ids.map((id) => [id, bytesFor(id, 24)]));
const labelled = ids.map((id, i) => ({ id, reportId: `rep-${i}`, label: `Label ${i}` }));

function pack(inspections: unknown[], manifest?: Record<string, unknown>): Uint8Array {
    const own = Object.fromEntries((inspections as { id: string }[]).map((e) => [e.id, yjs[e.id]!]));
    return buildPackage({ tenantId: 'tenant-1', inspections: inspections as { id: string; reportId: string }[], yjs: own, manifest });
}

const manifestText = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['manifest.json']!);
const entriesOf = (zip: Uint8Array): unknown[] => (JSON.parse(manifestText(zip)) as { inspections: unknown[] }).inspections;

describe('inspection entry extra keys', () => {
    it('splitPackage keeps each entry as written, for exactly the inspections a part carries', () => {
        const { part, rest } = splitPackage(pack(labelled), ['insp-3', 'insp-1']);
        expect(entriesOf(part)).toEqual([labelled[1], labelled[3]]);
        expect(entriesOf(rest!)).toEqual([labelled[0], labelled[2]]);
        // Same key order and values, byte for byte.
        expect(manifestText(part)).toContain(JSON.stringify([labelled[1], labelled[3]]));
        expect(mustBeValid(part).ids).toEqual(['insp-1', 'insp-3']);
    });

    it('extractHeldBackPackage keeps them too', () => {
        const held = extractHeldBackPackage(pack(labelled), ['insp-2']);
        expect(entriesOf(held)).toEqual([labelled[2]]);
    });

    it('planParts parts carry their own labels, in manifest order', () => {
        const plan = planParts(pack(labelled), { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * 1024 * 1024 });
        expect(plan.parts.length).toBeGreaterThan(1);
        for (const p of plan.parts) expect(entriesOf(p.bytes)).toEqual(p.ids.map((id) => labelled.find((e) => e.id === id)));
    });

    it('entries without extra keys come out exactly as before', () => {
        const plain = ids.map((id, i) => ({ id, reportId: `rep-${i}` }));
        const { part } = splitPackage(pack(plain), ['insp-0', 'insp-2']);
        expect(manifestText(part)).toContain('"inspections":[{"id":"insp-0","reportId":"rep-0"},{"id":"insp-2","reportId":"rep-2"}]');
    });

    it('top-level unknown keys still survive beside entry keys', () => {
        const { part } = splitPackage(pack(labelled, { appVersion: '1.2.3' }), ['insp-0']);
        expect((JSON.parse(manifestText(part)) as { appVersion: string }).appVersion).toBe('1.2.3');
    });

    it('an entry cannot shadow id or reportId with anything but the parsed values', () => {
        // Duplicate keys in the JSON text: the parser keeps the last, and so does the writer.
        const text = '{"id":"insp-0","reportId":"rep-0","label":"x","id":"insp-0","reportId":"rep-0"}';
        const base = pack([{ id: 'insp-0', reportId: 'rep-0' }]);
        const manifest = new TextDecoder().decode(unzipSync(base)['manifest.json']!).replace('{"id":"insp-0","reportId":"rep-0"}', text);
        const rebuilt = buildPackage({ tenantId: 'tenant-1', inspections: [], yjs: { 'insp-0': yjs['insp-0']! }, extra: { 'manifest.json': new TextEncoder().encode(manifest) } });
        const { part } = splitPackage(rebuilt, ['insp-0']);
        expect(entriesOf(part)).toEqual([{ id: 'insp-0', reportId: 'rep-0', label: 'x' }]);
    });

    it('a __proto__ key is carried as data and pollutes nothing', () => {
        const manifest = new TextDecoder().decode(unzipSync(pack([{ id: 'insp-0', reportId: 'rep-0' }]))['manifest.json']!)
            .replace('{"id":"insp-0","reportId":"rep-0"}', '{"id":"insp-0","reportId":"rep-0","__proto__":{"id":"evil","reportId":"evil"}}');
        const zip = buildPackage({ tenantId: 'tenant-1', inspections: [], yjs: { 'insp-0': yjs['insp-0']! }, extra: { 'manifest.json': new TextEncoder().encode(manifest) } });
        const { part } = splitPackage(zip, ['insp-0']);
        const out = parsePackage(part);
        expect(out.manifest.inspections).toEqual([{ id: 'insp-0', reportId: 'rep-0' }]);
        expect(({} as Record<string, unknown>).id).toBeUndefined();
        expect(Object.keys(unzipSync(part)).sort()).toEqual(['manifest.json', 'media/index.json', 'outbox.json', 'yjs/insp-0.bin']);
    });

    it('a large or nested extra value is carried when the existing limits allow it', () => {
        const nested = Array.from({ length: 100 }).reduce<unknown>((inner) => ({ n: inner }), 'leaf');
        const big = 'x'.repeat(2 * 1024 * 1024);
        const entry = { id: 'insp-0', reportId: 'rep-0', big, nested };
        const { part } = splitPackage(pack([entry, { id: 'insp-1', reportId: 'rep-1' }]), ['insp-0']);
        expect(entriesOf(part)).toEqual([entry]);
    });

    it('the existing size limit still refuses a package whose manifest declares too much', () => {
        const zip = pack([{ id: 'insp-0', reportId: 'rep-0', big: 'x'.repeat(1024 * 1024) }]);
        expect(() => parsePackage(zip, { maxUncompressedBytes: 1024 })).toThrow('declares more unpacked data');
        const lying = declareEntrySize(zip, 'manifest.json', IMPORT_LIMIT_CEILINGS.uncompressedBytes + 1);
        expect(() => splitPackage(lying, ['insp-0'])).toThrow(PackageFormatError);
        expect(() => splitPackage(lying, ['insp-0'])).toThrow('declares more unpacked data');
        // Positive control: the same entry inside the limits is accepted.
        expect(() => splitPackage(zip, ['insp-0'])).not.toThrow();
    });

    it('parsed manifest entries keep their parsed shape', () => {
        const parsed = parsePackage(pack(labelled));
        expect(parsed.manifest.inspections[0]).toEqual({ id: 'insp-0', reportId: 'rep-0' });
        expect(readPackageSummary(pack(labelled)).manifest.inspections[0]).toEqual({ id: 'insp-0', reportId: 'rep-0' });
    });

    it('round trip: a split part reads back with the parser, and runImport sends parts that keep the labels', async () => {
        const { part } = splitPackage(pack(labelled), ['insp-0', 'insp-1']);
        expect(OfflinePackageManifestSchema.safeParse(JSON.parse(manifestText(part))).success).toBe(true);
        expect(parsePackage(part).manifest.inspections.map((i) => i.id)).toEqual(['insp-0', 'insp-1']);

        const sent: Uint8Array[] = [];
        const send: Send = (bytes) => {
            sent.push(bytes);
            if (sent.length === 1) {
                return Promise.resolve({ status: 422, body: { error: { code: 'PACKAGE_TOO_LARGE', details: { limit: 'inspections', max: 2, actual: 4, limits: { inspections: 2, outbox: 20, photos: 50, compressedBytes: 16 * 1024 * 1024 } } } } } as never);
            }
            const view = parsePackage(bytes);
            return Promise.resolve({ status: 200, body: { data: { inspections: view.manifest.inspections.map((i) => ({ id: i.id, status: 'imported' })), applied: 0, skipped: 0, failed: [] } } } as never);
        };
        await runImport(pack(labelled), send, { sleep: () => Promise.resolve() }).catch(() => undefined);
        // Whatever the transport said, every package runImport wrote after the first carries its own labels.
        for (const bytes of sent.slice(1)) {
            const own = entriesOf(bytes) as { id: string; label: string }[];
            for (const e of own) expect(e.label).toBe(labelled.find((l) => l.id === e.id)!.label);
        }
        expect(sent.length).toBeGreaterThan(1);
    });
});
