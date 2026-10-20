#!/usr/bin/env node
/**
 * Import-boundary gate for `packages/field-ui`.
 *
 * The field editor package is meant to run inside hosts that are not this web
 * app (a native shell, a different router, no Cloudflare runtime). It earns
 * that only while its sources import nothing from the host. A single
 * `useFetcher` or `~/lib/...` import compiles fine in the web app and breaks
 * the package everywhere else, with no signal until a second host exists.
 *
 * Forbidden inside `packages/field-ui/`:
 *   - `react-router` (and subpaths, `@react-router/*`)
 *   - the `~/` app alias
 *   - anything whose specifier contains `.server`
 *   - `cloudflare:*` runtime modules
 *   - a relative path that resolves outside `packages/field-ui/`
 * Allowed on purpose: `@core/shared-ui` (bundled into the package), the
 * package's own `@core/field-ui` alias, and third-party peers such as `react`
 * and `yjs`.
 *
 * Both numbers print on every run. Zero files scanned is a broken walker, not a
 * clean package, so it fails.
 *
 * Usage: node scripts/check-field-ui-boundary.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import path from 'node:path';

const PACKAGE_DIR = 'packages/field-ui';
const SCAN_ROOT = `${PACKAGE_DIR}/src`;

/** Every module specifier a source file loads, in source order. */
function specifiersOf(source) {
    const out = [];
    // Static forms must start a statement, so prose in comments and strings is
    // not read as an import. `[^'"`;]*?` lets a multi-line `{ a, b }` list through.
    const staticRe = /^[ \t]*(?:import|export)\b(?:[^'"`;]*?\bfrom\b)?\s*(['"])([^'"\n]+)\1/gm;
    for (const m of source.matchAll(staticRe)) out.push({ index: m.index, specifier: m[2] });
    // Dynamic forms can sit anywhere in a line, so skip comment-looking lines.
    const lines = source.split('\n');
    let offset = 0;
    for (const line of lines) {
        const t = line.trimStart();
        if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) {
            for (const m of line.matchAll(/\b(?:import|require)\(\s*(['"])([^'"\n]+)\1\s*\)/g)) {
                out.push({ index: offset + m.index, specifier: m[2] });
            }
        }
        offset += line.length + 1;
    }
    return out.sort((a, b) => a.index - b.index).map((x) => x.specifier);
}

/** The reason a specifier is forbidden for a file, or null when it is fine. */
function reasonFor(file, specifier) {
    if (specifier === 'react-router' || specifier.startsWith('react-router/') || specifier.startsWith('@react-router/')) {
        return 'react-router is the host router; take behaviour through FieldDataSource instead';
    }
    if (specifier.startsWith('~/')) return 'the ~/ app alias reaches into the web app';
    if (specifier.includes('.server')) return 'server-only modules cannot ship in the package';
    if (specifier.startsWith('cloudflare:')) return 'cloudflare: runtime modules are not available in other hosts';
    if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (target !== PACKAGE_DIR && !target.startsWith(`${PACKAGE_DIR}/`)) {
            return 'a relative path resolves outside packages/field-ui';
        }
    }
    return null;
}

/**
 * @param {{ file: string, source: string }[]} files `file` is repo-relative, forward slashes.
 * @returns {{ file: string, specifier: string, reason: string }[]}
 */
export function findBoundaryViolations(files) {
    const violations = [];
    for (const { file, source } of files) {
        for (const specifier of specifiersOf(source)) {
            const reason = reasonFor(file, specifier);
            if (reason) violations.push({ file, specifier, reason });
        }
    }
    return violations;
}

function collect(dir, root, out) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) collect(full, root, out);
        else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.endsWith('.d.ts')) {
            out.push({ file: relative(root, full).split(path.sep).join('/'), source: readFileSync(full, 'utf8') });
        }
    }
    return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const scanDir = join(root, SCAN_ROOT);
    const files = existsSync(scanDir) ? collect(scanDir, root, []) : [];
    const violations = findBoundaryViolations(files);
    console.log(`field-ui boundary: ${files.length} files scanned, ${violations.length} violations`);
    if (files.length === 0) {
        console.error(`field-ui boundary: read ZERO files under ${SCAN_ROOT} - the walker is broken, not the package.`);
        process.exit(1);
    }
    if (violations.length) {
        for (const v of violations) console.error(`  ${v.file}: '${v.specifier}' - ${v.reason}`);
        process.exit(1);
    }
}
