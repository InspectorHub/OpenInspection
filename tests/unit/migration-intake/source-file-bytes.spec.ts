/**
 * The intake file service stores what it was given.
 *
 * The defect this guards: the upload path used to decode every file as UTF-8
 * before storing it, so a zip — which every real vendor export is — reached R2
 * as replacement characters and could not be recovered from storage at all.
 * A round-trip that only ever carries ASCII cannot see that, which is why the
 * fixture below is bytes no UTF-8 decode survives.
 */
import { describe, it, expect } from 'vitest';
import {
    MigrationSourceFileService,
    extForFileName,
} from '../../../server/services/migration-intake/source-file.service';

/** The first bytes of every zip, plus two that are not valid UTF-8 on their own. */
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x08, 0xff, 0xfe]);

function fakeBucket() {
    const store = new Map<string, Uint8Array>();
    return {
        store,
        bucket: {
            put: async (key: string, value: ArrayBuffer | ArrayBufferView | string) => {
                store.set(key, toBytes(value));
                return {} as R2Object;
            },
            get: async (key: string) => {
                const bytes = store.get(key);
                if (!bytes) return null;
                return {
                    arrayBuffer: async () => bytes.buffer.slice(
                        bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
                    ),
                    text: async () => new TextDecoder().decode(bytes),
                } as unknown as R2ObjectBody;
            },
            delete: async (keys: string | string[]) => {
                for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
            },
        } as unknown as R2Bucket,
    };
}

function toBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    return new Uint8Array(value);
}

describe('MigrationSourceFileService — bytes survive the round trip', () => {
    it('returns exactly the bytes it was given', async () => {
        const { bucket } = fakeBucket();
        const svc = new MigrationSourceFileService(bucket);
        const key = await svc.put('t1', 'b1', 'bin', ZIP_HEAD);
        const back = await svc.readBytes(key);
        expect(back).not.toBeNull();
        expect(Array.from(back!)).toEqual(Array.from(ZIP_HEAD));
    });

    it('does NOT round-trip through a UTF-8 decode', async () => {
        const { bucket } = fakeBucket();
        const svc = new MigrationSourceFileService(bucket);
        const key = await svc.put('t1', 'b1', 'bin', ZIP_HEAD);
        const back = await svc.readBytes(key);
        const mangled = new TextEncoder().encode(new TextDecoder().decode(ZIP_HEAD));
        // Positive control: the mangled form really IS different, so the
        // assertion below is capable of failing.
        expect(Array.from(mangled)).not.toEqual(Array.from(ZIP_HEAD));
        expect(Array.from(back!)).not.toEqual(Array.from(mangled));
    });

    it('readText still decodes, for the two callers that want text', async () => {
        const { bucket } = fakeBucket();
        const svc = new MigrationSourceFileService(bucket);
        const key = await svc.put(
            't1', 'b1', 'csv', new TextEncoder().encode('Name,Email\nZoe,zoe@example.test'),
        );
        expect(await svc.readText(key)).toBe('Name,Email\nZoe,zoe@example.test');
    });

    it('readBytes returns null for an object that is not there', async () => {
        const { bucket } = fakeBucket();
        const svc = new MigrationSourceFileService(bucket);
        expect(await svc.readBytes('t1/migrations/nope/source.bin')).toBeNull();
    });

    it('names a binary extension for the formats real vendors export', () => {
        expect(extForFileName('Commercial Inspection.xls')).toBe('bin');
        expect(extForFileName('Whole House Checklist.tpz')).toBe('bin');
        expect(extForFileName('bundle.tpzx')).toBe('bin');
        expect(extForFileName('form.HGF')).toBe('bin');
        expect(extForFileName('export.json')).toBe('json');
        expect(extForFileName('people.csv')).toBe('csv');
        expect(extForFileName('people.txt')).toBe('csv');
    });
});
