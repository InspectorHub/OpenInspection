/**
 * The uploaded file's home.
 *
 * It lives under the tenant prefix of the bucket that already has a destruction
 * path and an export path, so an object put here is reachable by both without
 * either being taught about it. A new bucket would mean doing those two things
 * again, and the second one is always the one nobody does.
 *
 * The key is built by ONE function. A key formed inline somewhere else is a key
 * the sweep does not know how to find.
 *
 * What the service carries is BYTES — the round trip itself is pinned in
 * `source-file-bytes.spec.ts`; this file is about keys, content types and the
 * naming rule.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    MigrationSourceFileService,
    extForFileName,
    type SourceExt,
} from '../../../server/services/migration-intake/source-file.service';
import { r2Keys } from '../../../server/lib/r2-keys';

const TENANT = 'TEN';
const BATCH = 'BAT';

const utf8 = (text: string) => new TextEncoder().encode(text);

function toBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
    if (typeof value === 'string') return utf8(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    return new Uint8Array(value);
}

function fakeBucket() {
    const store = new Map<string, Uint8Array>();
    return {
        store,
        put: vi.fn(async (key: string, value: ArrayBuffer | ArrayBufferView | string) => {
            store.set(key, toBytes(value));
            return {} as R2Object;
        }),
        get: vi.fn(async (key: string) => {
            const bytes = store.get(key);
            if (bytes === undefined) return null;
            return {
                arrayBuffer: async () => bytes.buffer.slice(
                    bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
                ),
                text: async () => new TextDecoder().decode(bytes),
            } as unknown as R2ObjectBody;
        }),
        delete: vi.fn(async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        }),
    };
}

describe('extForFileName', () => {
    it('reads csv and json off the name', () => {
        expect(extForFileName('contacts.csv')).toBe('csv');
        expect(extForFileName('Template Export.JSON')).toBe('json');
    });

    it('treats an unrecognised name as csv', () => {
        // Not "because the browser flattened it" — nothing does that. A name
        // this function does not recognise says nothing about the content, and
        // csv is the arm whose reader tolerates being handed something else.
        // A name it DOES recognise as a container gets `bin`, which is pinned
        // in source-file-bytes.spec.ts.
        expect(extForFileName('noextension')).toBe('csv');
        expect(extForFileName('contacts.tsv')).toBe('csv');
    });

    it('is not fooled by a name that merely mentions json', () => {
        // Positive control for the two above: the rule is the ENDING, not a
        // substring. A `.csv` export of a JSON-shaped table would otherwise be
        // stored claiming a content type it does not have. It is also the
        // control for the `.xlsx` → bin case: `xlsx-notes.csv` stays csv.
        expect(extForFileName('json-export.csv')).toBe('csv');
        expect(extForFileName('contacts.json.csv')).toBe('csv');
        expect(extForFileName('xlsx-notes.csv')).toBe('csv');
    });
});

describe('MigrationSourceFileService', () => {
    it('stores under the tenant prefix and hands back the key it used', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const key = await svc.put(TENANT, BATCH, 'csv', utf8('a,b\n1,2'));
        expect(key).toBe('TEN/migrations/BAT/source.csv');
        expect(key).toBe(r2Keys.migrationSource(TENANT, BATCH, 'csv'));
        expect(Array.from(bucket.store.get(key)!)).toEqual(Array.from(utf8('a,b\n1,2')));
    });

    it('declares the content type the extension promised', async () => {
        // The three travel together: an object stored as .json whose metadata
        // says text/csv is a file that reads correctly here and wrongly to
        // everything downstream of the bucket.
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        await svc.put(TENANT, BATCH, 'json', utf8('{}'));
        expect(bucket.put).toHaveBeenLastCalledWith(
            'TEN/migrations/BAT/source.json',
            utf8('{}'),
            { httpMetadata: { contentType: 'application/json' } },
        );
        await svc.put(TENANT, BATCH, 'csv', utf8('a,b'));
        expect(bucket.put).toHaveBeenLastCalledWith(
            'TEN/migrations/BAT/source.csv',
            utf8('a,b'),
            { httpMetadata: { contentType: 'text/csv' } },
        );
        const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
        await svc.put(TENANT, BATCH, 'bin', zip);
        expect(bucket.put).toHaveBeenLastCalledWith(
            'TEN/migrations/BAT/source.bin',
            zip,
            { httpMetadata: { contentType: 'application/octet-stream' } },
        );
    });

    it('takes the extension the namer produced, without a second decision in between', async () => {
        // The two halves compose: whatever `extForFileName` answered is what
        // gets stored, so a vendor export lands as JSON and a spreadsheet lands
        // as a binary container. A caller re-deciding the extension is how a key
        // stops matching the object.
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const ext: SourceExt = extForFileName('Template Export.JSON');
        expect(await svc.put(TENANT, BATCH, ext, utf8('{}'))).toBe('TEN/migrations/BAT/source.json');
        const binExt: SourceExt = extForFileName('clients.xlsx');
        expect(await svc.put(TENANT, BATCH, binExt, utf8('a,b'))).toBe('TEN/migrations/BAT/source.bin');
    });

    it('reads the text back, which is what a re-map needs', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const key = await svc.put(TENANT, BATCH, 'json', utf8('{"sections":[]}'));
        expect(await svc.readText(key)).toBe('{"sections":[]}');
    });

    it('returns null rather than throwing when the object is gone', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        expect(await svc.readText('TEN/migrations/GONE/source.csv')).toBeNull();
    });

    it('removes nothing when given an empty list', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        await svc.remove([]);
        expect(bucket.delete).not.toHaveBeenCalled();
    });

    it('removes the keys it is given', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const key = await svc.put(TENANT, BATCH, 'csv', utf8('x'));
        await svc.remove([key]);
        expect(bucket.delete).toHaveBeenCalledWith([key]);
        expect(bucket.store.has(key)).toBe(false);
    });
});
