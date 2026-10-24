import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(__dirname, '..', '..', '..', 'scripts', 'check-zero-tracking.mjs');
const BEACON = "navigator.sendBeacon('/x', data);\n";

let root = '';

/** A tree of 60 harmless files (the gate refuses to pass on a tiny scan), plus whatever the case adds. */
function tree(extra: Record<string, string>) {
    mkdirSync(join(root, 'app'), { recursive: true });
    for (let i = 0; i < 60; i += 1) writeFileSync(join(root, 'app', `f${i}.ts`), 'export const x = 1;\n');
    for (const [rel, text] of Object.entries(extra)) {
        mkdirSync(join(root, rel, '..'), { recursive: true });
        writeFileSync(join(root, rel), text);
    }
}

function run() {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'zero-tracking-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('check-zero-tracking: which `generated` directory is skipped', () => {
    it('skips the compiled i18n output of packages/field-ui, and says how many files it scanned', () => {
        tree({ 'packages/field-ui/src/i18n/generated/messages.ts': BEACON });
        const r = run();
        expect(r.out).toContain('OK');
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/\b6\d client files scanned/);
    });

    it('scans a `generated` directory anywhere else: under app/', () => {
        tree({ 'app/generated/track.ts': BEACON });
        const r = run();
        expect(r.code).toBe(1);
        expect(r.out).toContain('app/generated/track.ts');
    });

    it('scans a `generated` directory elsewhere in the field-ui package', () => {
        tree({ 'packages/field-ui/src/generated/track.ts': BEACON, 'packages/field-ui/src/i18n/generated/ok.ts': BEACON });
        const r = run();
        expect(r.code).toBe(1);
        expect(r.out).toContain('packages/field-ui/src/generated/track.ts');
        expect(r.out).not.toContain('i18n/generated/ok.ts');
    });

    it('still skips the directories skipped by name (paraglide) and still fails a beacon in a normal one', () => {
        tree({ 'app/paraglide/out.ts': BEACON });
        expect(run().code).toBe(0);
        tree({ 'app/ui/track.ts': BEACON });
        expect(run().code).toBe(1);
    });
});
