/**
 * Every React Router resource route that exports a mutating `action` must authenticate the caller.
 *
 * The Hono route gates (idempotency coverage, mutating-route guards, URL taxonomy) enumerate server routes only, so
 * a resource route under app/routes/resources/ is invisible to them. Several of these are plain-fetch endpoints (the
 * media upload, the editor command channel), which makes "it calls a token getter" the whole of their access control.
 * A route that only re-exports another module's action is judged by that module's source.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'app', 'routes', 'resources');

/** Routes that are deliberately public. Each needs the reason its writes are still safe. */
const PUBLIC_ON_PURPOSE: Record<string, string> = {
    'view-tracking.tsx': 'records an anonymous report view; the API call it makes authenticates with its own token',
};

const TOKEN_GETTER = /\b(?:requireToken|getToken|requireAdmin)\s*\(/;
const HAS_ACTION = /export\s+(?:async\s+function\s+action\b|const\s+action\b|\{[^}]*\baction\b[^}]*\}\s*from)/;
const REEXPORT = /export\s*\{[^}]*\baction\b[^}]*\}\s*from\s*["']([^"']+)["']/;

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function resolveModule(from: string, spec: string): string | null {
    const base = resolve(dirname(from), spec);
    for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
        if (existsSync(base + ext) && !base.endsWith('/')) {
            try { readFileSync(base + ext); return base + ext; } catch { /* a directory */ }
        }
    }
    return null;
}

/** The source that actually defines the action: this file, or the module it re-exports from. */
function definingSource(file: string, depth = 0): string {
    const src = readFileSync(file, 'utf8');
    const re = REEXPORT.exec(stripComments(src));
    if (!re || depth > 3) return stripComments(src);
    const target = resolveModule(file, re[1]!);
    if (!target) throw new Error(`${file} re-exports an action from ${re[1]} which does not resolve`);
    return definingSource(target, depth + 1);
}

describe('resource routes with an action authenticate the caller', () => {
    const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\.spec\./.test(f));
    const withAction = files.filter((f) => HAS_ACTION.test(stripComments(readFileSync(join(DIR, f), 'utf8'))));

    it('scans a plausible set (an empty glob must not pass)', () => {
        // 21 today: 20 own actions plus the editor command channel. Print both numbers so a drift is visible.
        console.info(`resource routes: ${files.length} scanned, ${withAction.length} export an action`);
        expect(withAction.length).toBeGreaterThanOrEqual(21);
        expect(withAction).toContain('inspection-editor-command.ts');
    });

    it.each(withAction)('%s calls a token getter, or is public on purpose', (f) => {
        if (PUBLIC_ON_PURPOSE[f]) return;
        expect(TOKEN_GETTER.test(definingSource(join(DIR, f))), `${f} exports an action but its defining source calls no token getter`).toBe(true);
    });

    it('every public-on-purpose entry still exists and still exports an action', () => {
        for (const f of Object.keys(PUBLIC_ON_PURPOSE)) expect(withAction, f).toContain(f);
    });

    it('can say no: a source with an action and no getter fails the check', () => {
        expect(TOKEN_GETTER.test(stripComments('export async function action() { return null; }'))).toBe(false);
        expect(TOKEN_GETTER.test(stripComments('// requireToken(\nexport async function action() {}'))).toBe(false);
    });
});
