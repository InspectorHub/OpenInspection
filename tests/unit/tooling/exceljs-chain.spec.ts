/**
 * The exceljs chain after the dependency overrides (docs/develop/dependency-policy.md): the pieces the overrides moved still do their
 * work. The streaming workbook writer builds its archive with archiver, the streaming reader reads it with unzipper, and archiver's
 * glob and directory helpers use readdir-glob and archiver-utils on glob 14. None of this is in the Worker bundle; it is checked here
 * because the packages are installed with the production dependencies.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require_ = createRequire(import.meta.url);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const scratch = (): string => { const d = mkdtempSync(path.join(tmpdir(), 'exceljs-chain-')); dirs.push(d); return d; };

describe('the exceljs chain', () => {
    it('writes a workbook with the streaming writer (archiver) and reads it back with the streaming reader (unzipper) and the buffered reader', async () => {
        const ExcelJS = require_('exceljs') as typeof import('exceljs');
        const file = path.join(scratch(), 'chain.xlsx');
        const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file });
        const sheet = writer.addWorksheet('Rows');
        for (let i = 0; i < 3; i += 1) sheet.addRow([`row ${i}`, i]).commit();
        await sheet.commit();
        await writer.commit();
        expect(statSync(file).size).toBeGreaterThan(1000);

        const seen: unknown[][] = [];
        const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {});
        for await (const worksheet of reader) {
            for await (const row of worksheet) seen.push((row.values as unknown[]).slice(1));
        }
        expect(seen).toEqual([['row 0', 0], ['row 1', 1], ['row 2', 2]]);

        const buffered = new ExcelJS.Workbook();
        await buffered.xlsx.readFile(file);
        expect(buffered.getWorksheet('Rows')?.rowCount).toBe(3);
        const bytes = await buffered.xlsx.writeBuffer();
        const again = new ExcelJS.Workbook();
        await again.xlsx.load(bytes);
        expect(again.getWorksheet('Rows')?.getRow(2).getCell(1).value).toBe('row 1');
    }, 30_000);

    it('builds a zip with archiver from a glob and from a directory, and expands a pattern with archiver-utils', async () => {
        const archiver = require_('archiver') as (format: string) => { pipe: (s: NodeJS.WritableStream) => void; glob: (p: string, o?: { cwd: string }) => void; directory: (d: string, n: string) => void; finalize: () => Promise<void>; on: (e: string, f: (err: Error) => void) => void };
        const utils = require_('archiver-utils') as { file: { expand: (pattern: string) => string[] } };
        // A fixture of its own, so nothing here depends on the repository's file names.
        const fixture = scratch();
        mkdirSync(path.join(fixture, 'sub'));
        writeFileSync(path.join(fixture, 'alpha.txt'), 'alpha');
        writeFileSync(path.join(fixture, 'beta.txt'), 'beta');
        writeFileSync(path.join(fixture, 'sub', 'gamma.md'), 'gamma');
        const target = path.join(scratch(), 'out.zip');
        const out = createWriteStream(target);
        const zip = archiver('zip');
        const failure: Error[] = [];
        zip.on('error', (e) => failure.push(e));
        zip.pipe(out);
        zip.glob('*.txt', { cwd: fixture });
        zip.directory(path.join(fixture, 'sub'), 'nested');
        await new Promise<void>((resolve) => { out.on('close', () => resolve()); void zip.finalize(); });
        expect(failure).toEqual([]);
        const bytes = readFileSync(target);
        // A zip starts with the local file header signature, and its entry names are stored in plain text.
        expect(Buffer.from(bytes.subarray(0, 4)).toString('hex')).toBe('504b0304');
        for (const name of ['alpha.txt', 'beta.txt', 'nested/gamma.md']) expect(bytes.includes(Buffer.from(name)), name).toBe(true);
        const posix = fixture.replace(/\\/g, '/');
        expect(utils.file.expand(`${posix}/*.txt`).length).toBe(2);
        // Control: a pattern that matches nothing expands to nothing.
        expect(utils.file.expand(`${posix}/*.nothing`)).toEqual([]);
    }, 30_000);
});
