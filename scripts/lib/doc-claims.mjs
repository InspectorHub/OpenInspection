import { isAbsolute, posix, relative as relativePath, resolve, sep } from 'node:path';

const KNOWN_ROOTS = /^(?:docs|scripts|server|app|packages|tests|workers|migrations|public|\.github|\.githooks)\//;
const NPM = /^npm\s+(?:--prefix[ =](\S+)\s+)?run\s+([A-Za-z0-9:_.-]{2,})/;
const UNTRACKED_ROOTS = /(?:^|\/)(?:node_modules|dist|build|coverage|test-results|playwright-report|\.wrangler|\.docs-shots|\.types|\.publish)\//;
const GENERATED_PATHS = /^(?:app\/paraglide\/|app\/content\/legal\/[^/]+\.local\.md$|packages\/field-ui\/src\/i18n\/generated\/|public\/vendor\/)/;

export function extractClaims(text) {
    const claims = [];
    let inFence = false;
    for (const [lineIndex, line] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
        if (inFence) continue;
        for (const [, raw] of line.matchAll(/`([^`\n]+)`/g)) {
            const token = raw.trim();
            const npm = token.match(NPM);
            if (npm) { claims.push({ kind: 'npm-script', value: npm[2], prefix: npm[1] ?? null, line: lineIndex + 1 }); continue; }
            if (!token.includes('/') || token.startsWith('/') || token.startsWith('~') || token.includes('://') || /[*<>{}$|\s]/.test(token)) continue;
            const value = token.replace(/:\d+(?:-\d+)?$/, '').replace(/#[\w-]+$/, '');
            if (UNTRACKED_ROOTS.test(value.replace(/^\.\.\//, ''))) continue;
            if (GENERATED_PATHS.test(value)) continue;
            if (!KNOWN_ROOTS.test(value) && !value.startsWith('../')) continue;
            if (!/^[\w.@/-]+$/.test(value)) continue;
            claims.push({ kind: 'path', value, prefix: null, line: lineIndex + 1 });
        }
    }
    return claims;
}

export function buildSuffixSet(trackedFiles) {
    const suffixes = new Set();
    for (const file of trackedFiles) {
        const parts = file.split('/');
        for (let index = 0; index < parts.length; index++) {
            suffixes.add(parts.slice(index).join('/'));
            for (let end = index + 1; end < parts.length; end++) {
                const directory = parts.slice(index, end).join('/');
                suffixes.add(directory);
                suffixes.add(`${directory}/`);
            }
        }
    }
    return suffixes;
}

export function baselineDoesNotRise(next, previous) {
    return Number.isInteger(next) && next >= 0 && (!Number.isInteger(previous) || next <= previous);
}

export function resolveClaims(claims, { trackedFiles, scripts, repoRoot = null, packageScriptsAt = null, docFile = '', suffixSet = buildSuffixSet(trackedFiles) }) {
    const tracked = new Set(trackedFiles);
    return claims.map((claim) => {
        if (claim.kind === 'npm-script') {
            if (!claim.prefix) return { claim, ok: scripts.has(claim.value) };
            if (!repoRoot || !packageScriptsAt) return { claim, ok: false };
            const packageDir = resolve(repoRoot, claim.prefix);
            const prefixRelative = relativePath(resolve(repoRoot), packageDir);
            const escaped = isAbsolute(prefixRelative)
                || prefixRelative === '..'
                || prefixRelative.startsWith(`..${sep}`);
            if (escaped) return { claim, ok: false };
            return { claim, ok: packageScriptsAt(packageDir)?.has(claim.value) ?? false };
        }
        const value = claim.value.replaceAll('\\', '/');
        const relative = docFile ? posix.normalize(posix.join(posix.dirname(docFile), value)) : value;
        return { claim, ok: tracked.has(value) || tracked.has(relative) || suffixSet.has(value) || suffixSet.has(relative) };
    });
}
