import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(__dirname, '..', '..', '..', 'scripts', 'check-english-only.mjs');
let root = '';

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'english-only-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function run(files: Record<string, string>) {
    mkdirSync(join(root, 'src'), { recursive: true });
    for (const [rel, text] of Object.entries(files)) writeFileSync(join(root, 'src', rel), text);
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const line = (...cps: number[]) => `// ${String.fromCodePoint(...cps)}\nexport const x = 1;\n`;

describe('check-english-only: scripts beyond ideographs', () => {
    it('passes plain English and non-CJK accents', () => {
        const r = run({ 'clean.ts': `// caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x3b1, 0x44f)}\nexport const x = 1;\n` });
        expect(r.code).toBe(0);
    });

    it.each([
        ['ideograph', [0x4e2d]],
        ['hiragana', [0x3042]],
        ['katakana', [0x30a2]],
        ['hangul syllable', [0xd55c]],
        ['hangul jamo', [0x1112]],
    ] as const)('flags a %s', (_name, cps) => {
        const r = run({ 'bad.ts': line(...cps) });
        expect(r.code).toBe(1);
        expect(r.out).toContain('src/bad.ts:1');
    });
});
