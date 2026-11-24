import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocsShotsMeta, listCapturedSlugs, writeDocsShotsMeta } from '../../docs-shots/meta';

describe('docs shots metadata', () => {
    let tempDir: string | undefined;

    afterEach(() => {
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
    });

    it('writes a sorted list of captured guide slugs with the capture commit and time', () => {
        tempDir = mkdtempSync(path.join(os.tmpdir(), 'docs-shots-meta-'));
        const meta = createDocsShotsMeta('1234abcd', '2026-11-23T12:00:00.000Z', ['your-first-week', 'getting-started']);

        writeDocsShotsMeta(tempDir, meta);

        expect(JSON.parse(readFileSync(path.join(tempDir, 'META.json'), 'utf8'))).toEqual({
            engineSha: '1234abcd',
            capturedAt: '2026-11-23T12:00:00.000Z',
            slugs: ['getting-started', 'your-first-week'],
        });
    });

    it('lists only capture directories', () => {
        tempDir = mkdtempSync(path.join(os.tmpdir(), 'docs-shots-meta-'));
        writeDocsShotsMeta(tempDir, createDocsShotsMeta('1234abcd', '2026-11-23T12:00:00.000Z', []));
        mkdirSync(path.join(tempDir, 'guide-a'));
        writeFileSync(path.join(tempDir, 'loose.png'), 'image');

        expect(listCapturedSlugs(tempDir)).toEqual(['guide-a']);
    });

    it('treats a missing capture root as an empty run', () => {
        tempDir = path.join(os.tmpdir(), `docs-shots-meta-missing-${Date.now()}`);

        expect(listCapturedSlugs(tempDir)).toEqual([]);
    });
});
