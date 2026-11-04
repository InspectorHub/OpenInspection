/**
 * Rules for deciding which api unit specs may share a module registry.
 *
 * `vitest.api.config.ts` runs two projects. `api-isolated` is the historical
 * behaviour: every spec file gets a fresh module graph. `api-shared` runs with
 * `isolate: false`, so the files a worker handles one after another reuse the
 * graph the first one built, which removes most of the import cost. That is only
 * sound for a spec that leaves nothing behind and depends on nothing a
 * neighbour could have left behind, so membership is decided by these rules and
 * recorded in `tests/unit/isolation.json`.
 *
 * Used by `gen-unit-isolation.mjs` (writes the manifest) and
 * `check-unit-isolation.mjs` (fails when a listed spec breaks a rule). Pure
 * functions over text, apart from the import walk, which reads source files.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Spec-level hazards. Each one either replaces a module for every later file
 * (mocks), mutates a process-wide object (globals, env, timers), or needs a
 * different environment.
 */
export const SPEC_HAZARDS = [
    ['module mock', /\bvi\.(mock|doMock|hoisted)\s*\(/],
    ['locale mutation', /\b(setLocale|overwriteGetLocale|overwriteSetLocale|overwriteGetUrlOrigin|defineCustomServerStrategy|defineCustomClientStrategy)\s*\(/],
    ['module registry reset', /\bvi\.(resetModules|importActual|importMock|dynamicImport)\s*\(/],
    ['global stub', /\bvi\.(stubGlobal|stubEnv|unstubAllGlobals|unstubAllEnvs)\s*\(/],
    ['global write', /\b(globalThis|global|self|window)\b(\s+as\s+[^)]*\))?\s*\)?\.\w+\s*(=(?!=)|\+=|\|\|=|\?\?=)/],
    ['global write', /Object\.(defineProperty|assign|defineProperties)\(\s*(globalThis|global|self|window|process|Date|Math|JSON|Intl|console)\b/],
    ['builtin write', /\b(Date|Math|JSON|Intl|console|crypto|performance|process)\.\w+\s*=(?!=)/],
    ['fake timers', /\bvi\.(useFakeTimers|setSystemTime|useRealTimers)\b/],
    ['process.env write', /process\.env(\.\w+|\[[^\]]+\])\s*(=(?!=)|\|\|=|\?\?=)|delete\s+process\.env/],
    ['process listeners', /\bprocess\.(on|once|off|chdir|exit)\s*\(/],
    ['spy on a global', /\bvi\.spyOn\(\s*(globalThis|global|window|self|Date|console|Math|crypto|process|JSON|performance|Intl)\b/],
    ['fetch reassignment', /\b(globalThis|global)\.fetch\s*=|vi\.stubGlobal\(\s*['"]fetch/],
    ['environment docblock', /@vitest-environment/],
    ['wall-clock bound', /\bperformance\.now\(\)|\bprocess\.hrtime|\bDate\.now\(\)\s*-/],
    ['global write', /\b(globalThis|global|self|window)\s*\[[^\]]+\]\s*(=(?!=)|\+=|\|\|=|\?\?=)/],
    ['vitest globals write', /\bvi\.(setConfig|stubGlobal)\b/],
    ['unrestored fake DOM', /\bdocument\.(body|head)\./],
];

/**
 * Modules whose top level keeps state that outlives a test, found by reading
 * them. Listing a name here keeps every spec that reaches it in `api-isolated`
 * without having to find the pattern again.
 */
export const KNOWN_MUTABLE_MODULES = [
    // service-account token cache and in-flight request map
    'server/lib/ai/credentials/google-service-account.ts',
    // per-process counter locks
    'server/api/inspections/report-send-guards.ts',
    // debounce map for the last-active touch
    'server/lib/middleware/touch-last-active.ts',
];

/**
 * Top-level (column 0) statements that create state living as long as the module.
 * A `let`/`var` is always state. A collection or empty container is state only
 * when the module also mutates it, because a frozen lookup table is not.
 */
export const BENIGN_MODULE_STATE = {
    'server/lib/tz.ts': 'Intl.DateTimeFormat memo keyed by zone and options',
    'server/lib/openapi/enrich-facts.ts': 'compiled RegExp memo keyed by token',
    'packages/field-ui/src/shared/intl-cache.ts': 'FormatterCache is a bounded memo of Intl formatters keyed by locale and options; a formatter is immutable, so every spec gets the same answer',
};

/**
 * The compiled message catalogue and its runtime. The runtime keeps the active
 * locale in module state; that is only a hazard for a spec that changes it,
 * which the 'locale mutation' spec rule rejects.
 */
const GENERATED_I18N = /^(app\/paraglide\/|packages\/field-ui\/src\/i18n\/generated\/)/;

export const MODULE_STATE_PATTERNS = [
    ['top-level let/var', /^(export\s+)?(let|var)\s+\w/m],
    ['global write in module', /^\s*(globalThis|global)\.\w+\s*=(?!=)/m],
];
const CONTAINER_RE = /^(?:export\s+)?const\s+(\w+)(?:\s*:(?:[^=\n]|=>)+)?\s*=\s*(?:new\s+(?:Map|Set|WeakMap|WeakSet)\b|\[\]|\{\})/gm;
const GLOBAL_ALIAS_RE = /\b(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:globalThis|global|self|window)\s*(?:as\b[^;\n]*)?(?:;|$)/gm;
const CLASS_RE = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
const MUTATING = (n) =>
    new RegExp(
        `\\b${n}\\.(set|add|push|delete|clear|splice|pop|shift|unshift|sort|reverse|fill)\\(|\\b${n}\\[[^\\]]+\\]\\s*=(?!=)|\\b${n}\\.\\w+\\s*=(?!=)|Object\\.assign\\(\\s*${n}\\b`,
    );

/** Strip comments and string-free noise so a comment that mentions `vi.mock(` is not a hit. */
export function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

export function specHazards(source) {
    const src = stripComments(source);
    const hits = [];
    for (const [name, re] of SPEC_HAZARDS) {
        if (re.test(src) && !hits.includes(name)) hits.push(name);
    }
    // The docblock lives in a comment, so look for it in the raw text.
    if (/@vitest-environment/.test(source) && !hits.includes('environment docblock')) hits.push('environment docblock');
    // A global written through an alias: `const g = globalThis; g.x = 1`.
    for (const m of src.matchAll(GLOBAL_ALIAS_RE)) {
        if (new RegExp(`\\b${m[1]}(\\.\\w+\\s*|\\[[^\\]]+\\]\\s*)(=(?!=)|\\+=|\\|\\|=|\\?\\?=)`).test(src)) {
            if (!hits.includes('global write')) hits.push('global write');
        }
    }
    // Spying on an imported object replaces a method on a shared singleton; with no
    // restore in the file the spy survives into the next spec the worker runs.
    if (/\bvi\.spyOn\(/.test(src) && !/\brestoreAllMocks\b|\.mockRestore\(/.test(src)) hits.push('spy without restore');
    return hits;
}

function candidates(base) {
    return [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')];
}

function resolveSpecifier(root, from, spec) {
    let base;
    if (spec.startsWith('.')) base = resolve(dirname(from), spec);
    else if (spec.startsWith('~/')) base = join(root, 'app', spec.slice(2));
    else if (spec.startsWith('@core/field-ui')) base = join(root, 'packages/field-ui/src', spec.slice('@core/field-ui'.length));
    else if (spec === '@core/offline-package') base = join(root, 'packages/offline-package/index.ts');
    else return null;
    for (const c of candidates(base)) {
        try {
            if (existsSync(c) && statSync(c).isFile()) return c;
        } catch {
            /* try the next candidate */
        }
    }
    return null;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

/** Source files a spec reaches through relative / alias imports (bare packages are not followed). */
export function reachableFiles(root, specFile, cache = new Map()) {
    const seen = new Set();
    const stack = [specFile];
    while (stack.length) {
        const f = stack.pop();
        if (seen.has(f)) continue;
        seen.add(f);
        let deps = cache.get(f);
        if (!deps) {
            deps = [];
            let text = '';
            try {
                text = stripComments(readFileSync(f, 'utf8'));
            } catch {
                /* unreadable: no edges */
            }
            for (const m of text.matchAll(IMPORT_RE)) {
                const r = resolveSpecifier(root, f, m[1]);
                if (r) deps.push(r);
            }
            cache.set(f, deps);
        }
        for (const d of deps) if (!seen.has(d)) stack.push(d);
    }
    seen.delete(specFile);
    return seen;
}

const stateCache = new Map();
/** Module-state hazards of one non-spec file (cached; the answer depends only on the text). */
export function moduleStateHazards(file) {
    if (stateCache.has(file)) return stateCache.get(file);
    let hits = [];
    if (/\.(ts|tsx|mjs|js)$/.test(file)) {
        let text = '';
        try {
            text = stripComments(readFileSync(file, 'utf8'));
        } catch {
            /* unreadable */
        }
        hits = MODULE_STATE_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);
        for (const c of text.matchAll(CLASS_RE)) {
            const body = text.slice(c.index, (text.indexOf(`
}`, c.index) + 1) || text.length);
            const field = /^\s+(?:(?:private|protected|public|readonly|static)\s+)*\w+(?:\s*:(?:[^=\n]|=>)+)?\s*=\s*(?:new\s+(?:Map|Set|WeakMap|WeakSet)\b|\[\])/m;
            const made = new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+\\w+(?:\\s*:(?:[^=\\n]|=>)+)?\\s*=\\s*new\\s+${c[1]}\\b`, 'm');
            if (field.test(body) && made.test(text)) {
                hits.push('top-level instance of a class with collection state');
                break;
            }
        }
        for (const m of text.matchAll(CONTAINER_RE)) {
            if (MUTATING(m[1]).test(text)) {
                hits.push('top-level container mutated');
                break;
            }
        }
    }
    stateCache.set(file, hits);
    return hits;
}

/**
 * Everything wrong with putting `specFile` in the shared project, as strings.
 * Empty array = eligible. `root` is the repo root (absolute).
 */
export function sharedProblems(root, specFile, graphCache = new Map()) {
    const abs = resolve(root, specFile);
    const problems = specHazards(readFileSync(abs, 'utf8')).map((h) => `spec: ${h}`);
    const norm = (p) => p.replace(/\\/g, '/');
    for (const dep of reachableFiles(root, abs, graphCache)) {
        const rel = norm(dep).slice(norm(root).length + 1);
        if (KNOWN_MUTABLE_MODULES.includes(rel)) problems.push(`imports known mutable module ${rel}`);
        // A helper under tests/ is judged by the spec rules; product code by the module-state rules.
        if (rel.startsWith('tests/')) {
            for (const h of specHazards(readFileSync(dep, 'utf8'))) problems.push(`helper ${rel}: ${h}`);
        } else if (rel.startsWith('server/') || rel.startsWith('app/') || rel.startsWith('packages/')) {
            if (BENIGN_MODULE_STATE[rel] || GENERATED_I18N.test(rel)) continue;
            for (const h of moduleStateHazards(dep)) problems.push(`${rel}: ${h}`);
        }
    }
    return problems;
}
