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

function fakeBucket() {
    const store = new Map<string, string>();
    return {
        store,
        put: vi.fn(async (key: string, value: string) => { store.set(key, value); return {} as R2Object; }),
        get: vi.fn(async (key: string) => {
            if (!store.has(key)) return null;
            return { text: async () => store.get(key) as string } as unknown as R2ObjectBody;
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

    it('treats anything else as csv, because that is what the browser uploads', () => {
        // The wizard converts a spreadsheet to CSV text before upload, so a
        // .xlsx name arrives carrying CSV bytes. Naming the object .csv keeps
        // the extension a statement about the CONTENT rather than about the
        // file the operator happened to pick.
        expect(extForFileName('contacts.xlsx')).toBe('csv');
        expect(extForFileName('noextension')).toBe('csv');
    });

    it('is not fooled by a name that merely mentions json', () => {
        // Positive control for the two above: the rule is the ENDING, not a
        // substring. A `.csv` export of a JSON-shaped table would otherwise be
        // stored claiming a content type it does not have.
        expect(extForFileName('json-export.csv')).toBe('csv');
        expect(extForFileName('contacts.json.csv')).toBe('csv');
    });
});

describe('MigrationSourceFileService', () => {
    it('stores under the tenant prefix and hands back the key it used', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const key = await svc.put(TENANT, BATCH, 'csv', 'a,b\n1,2');
        expect(key).toBe('TEN/migrations/BAT/source.csv');
        expect(key).toBe(r2Keys.migrationSource(TENANT, BATCH, 'csv'));
        expect(bucket.store.get(key)).toBe('a,b\n1,2');
    });

    it('declares the content type the extension promised', async () => {
        // The two travel together: an object stored as .json whose metadata
        // says text/csv is a file that reads correctly here and wrongly to
        // everything downstream of the bucket.
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        await svc.put(TENANT, BATCH, 'json', '{}');
        expect(bucket.put).toHaveBeenLastCalledWith(
            'TEN/migrations/BAT/source.json',
            '{}',
            { httpMetadata: { contentType: 'application/json' } },
        );
        await svc.put(TENANT, BATCH, 'csv', 'a,b');
        expect(bucket.put).toHaveBeenLastCalledWith(
            'TEN/migrations/BAT/source.csv',
            'a,b',
            { httpMetadata: { contentType: 'text/csv' } },
        );
    });

    it('takes the extension the namer produced, without a second decision in between', async () => {
        // The two halves compose: whatever `extForFileName` answered is what
        // gets stored, so an upload named for a spreadsheet lands as CSV and a
        // vendor export lands as JSON. A caller re-deciding the extension is
        // how a key stops matching the object.
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const ext: SourceExt = extForFileName('Template Export.JSON');
        expect(await svc.put(TENANT, BATCH, ext, '{}')).toBe('TEN/migrations/BAT/source.json');
        const csvExt: SourceExt = extForFileName('clients.xlsx');
        expect(await svc.put(TENANT, BATCH, csvExt, 'a,b')).toBe('TEN/migrations/BAT/source.csv');
    });

    it('reads the text back, which is what a re-map needs', async () => {
        const bucket = fakeBucket();
        const svc = new MigrationSourceFileService(bucket as unknown as R2Bucket);
        const key = await svc.put(TENANT, BATCH, 'json', '{"sections":[]}');
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
        const key = await svc.put(TENANT, BATCH, 'csv', 'x');
        await svc.remove([key]);
        expect(bucket.delete).toHaveBeenCalledWith([key]);
        expect(bucket.store.has(key)).toBe(false);
    });
});
