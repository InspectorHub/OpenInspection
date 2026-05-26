/**
 * Parses .dev.vars into a key-value map for use in Node.js test processes.
 * Wrangler loads .dev.vars automatically for the dev server, but Playwright
 * tests run in Node.js and don't get those values injected automatically.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadDevVars(appDir = process.cwd()): Record<string, string> {
    const p = resolve(appDir, '.dev.vars');
    if (!existsSync(p)) return {};
    const vars: Record<string, string> = {};
    for (const line of readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const idx = t.indexOf('=');
        if (idx === -1) continue;
        vars[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
    }
    return vars;
}
