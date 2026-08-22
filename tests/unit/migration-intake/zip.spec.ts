/**
 * One named entry out of a zip.
 *
 * Every vendor container this repository reads is a zip — a spreadsheet export
 * and a template archive alike — so a reader that returns the WRONG entry is
 * worse than one that fails: the caller gets bytes, parses them, and reports a
 * confident answer about a file it never opened. Most of these assertions are
 * about that rather than about the happy path.
 */
import { describe, it, expect } from 'vitest';
import { readZipEntry } from '../../../server/lib/migration-intake/formats/zip';
import { zipOf } from '../helpers/zip-fixture';

const text = (bytes: Uint8Array | null): string | null =>
    bytes === null ? null : new TextDecoder().decode(bytes);

describe('the zip fixture helper', () => {
    it('produces something that starts with the zip signature', async () => {
        // A broken helper makes every test in this area fail for the wrong
        // reason, so it is asserted before anything is built on top of it.
        const bytes = await zipOf({ 'a.txt': 'hello' });
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
        expect(bytes[2]).toBe(0x03);
        expect(bytes[3]).toBe(0x04);
    });
});

describe('readZipEntry', () => {
    it('reads a STORED entry', async () => {
        const bytes = await zipOf({ 'a.txt': 'hello', 'b.txt': 'world' });
        expect(text(await readZipEntry(bytes, 'a.txt'))).toBe('hello');
        expect(text(await readZipEntry(bytes, 'b.txt'))).toBe('world');
    });

    it('reads a DEFLATED entry', async () => {
        // Real archives use both methods, and a reader that handles only stored
        // entries passes every hand-made fixture and fails every real file.
        const body = 'a repeated sentence. '.repeat(200);
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': body }, { deflate: true });
        expect(text(await readZipEntry(bytes, 'xl/worksheets/sheet1.xml'))).toBe(body);
    });

    it('reads an entry whose path has directories in it', async () => {
        const bytes = await zipOf({ 'xl/worksheets/sheet1.xml': '<worksheet/>' });
        expect(text(await readZipEntry(bytes, 'xl/worksheets/sheet1.xml'))).toBe('<worksheet/>');
    });

    it('returns null for a name the archive does not hold', async () => {
        const bytes = await zipOf({ 'a.txt': 'hello' });
        expect(await readZipEntry(bytes, 'b.txt')).toBeNull();
    });

    it('does NOT find a name that only appears inside another entry\'s DATA', async () => {
        // The reason this reader walks the central directory instead of
        // scanning for local headers. An entry name is ordinary text and can
        // appear inside a file's contents; a scanner finds that occurrence and
        // hands back whatever follows it.
        const bytes = await zipOf({
            'notes.txt': 'PK xl/worksheets/sheet1.xml <worksheet>decoy</worksheet>',
        });
        expect(await readZipEntry(bytes, 'xl/worksheets/sheet1.xml')).toBeNull();
    });

    it('returns null for bytes that are not a zip', async () => {
        expect(await readZipEntry(new TextEncoder().encode('Name,Email\nA,b@c.test'), 'a.txt')).toBeNull();
        expect(await readZipEntry(new Uint8Array(0), 'a.txt')).toBeNull();
    });

    it('returns null for a truncated zip rather than throwing', async () => {
        // An operator uploading half a file is a mistake to report, not a
        // server error to raise.
        const bytes = await zipOf({ 'a.txt': 'hello' });
        expect(await readZipEntry(bytes.slice(0, bytes.length - 8), 'a.txt')).toBeNull();
    });

    it('POSITIVE CONTROL — the same archive untruncated still reads', async () => {
        // Without this, "returns null" above would also pass for a reader that
        // returns null unconditionally.
        const bytes = await zipOf({ 'a.txt': 'hello' });
        expect(text(await readZipEntry(bytes, 'a.txt'))).toBe('hello');
    });
});
