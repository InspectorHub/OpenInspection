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
    // `new Date(Date.now() - ageMs)` builds a timestamp in the past; it bounds nothing. A bare
    // `Date.now() - start` is an elapsed time and still counts, and so does a `new Date(Date.now() - t0)`
    // that is read back as a number (`.getTime()` / `.valueOf()`), which is the same probe in a wrapper.
    [
        'wall-clock bound',
        /\bperformance\.now\(\)|\bprocess\.hrtime|(?<!new Date\(\s*)\bDate\.now\(\)\s*-|\bnew Date\(\s*Date\.now\(\)\s*-[^;\n]*?\)\s*\.(?:getTime|valueOf)\s*\(/,
    ],
    // The loader registry holds whatever the last caller installed. The worker entry installs the real one
    // and nothing else does, so a spec that installs a fake is the only other writer.
    ['api app loader registration', /\bregisterApiAppLoader\s*\(/],
    // Importing the worker entry runs its top level, which installs the real API app loader (see above).
    ['worker entry import', /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"][^'"]*\bworkers\/app(?:\.[cm]?[jt]sx?)?['"]/m],
    ['global write', /\b(globalThis|global|self|window)\s*\[[^\]]+\]\s*(=(?!=)|\+=|\|\|=|\?\?=)/],
    ['vitest globals write', /\bvi\.(setConfig|stubGlobal)\b/],
    ['unrestored fake DOM', /\bdocument\.(body|head)\./],
];

/**
 * Modules whose top level keeps state that outlives a test but that the patterns below cannot see,
 * found by reading them. Listing a name here keeps every spec that reaches it in `api-isolated`
 * without having to find the pattern again. Empty today: every module read so far is either caught by
 * the patterns, benign, or reset per file.
 */
export const KNOWN_MUTABLE_MODULES = [];

/**
 * Modules whose state is real, outlives a spec file, and is cleared by an exported function that
 * `tests/unit/setup-shared.ts` calls after every file of the `api-shared` project. The value is that
 * function's name; `setupProblems` fails when the setup file stops calling it, so an entry cannot
 * outlive its reset.
 */
export const RESET_BY_SHARED_SETUP = {
    'server/lib/ai/credentials/google-service-account.ts': 'resetServiceAccountTokenCache',
    'server/lib/middleware/touch-last-active.ts': 'resetTouchLastActiveDebounce',
    'server/lib/csp-report.ts': 'resetCspReportSampling',
};

/**
 * Helpers under tests/ that look like a hazard to the text rules and are not. Each entry names the
 * hazards it may carry and why that is safe; any other hazard in the same file still counts.
 */
export const VETTED_HELPERS = {
    'tests/unit/helpers/tenant-email-harness.ts': {
        hazards: ['global stub', 'fetch reassignment', 'vitest globals write'],
        // The exemption covers `fetch` and nothing else: `vettedHelperProblems` fails on any other stubGlobal
        // target, on stubEnv / unstubAllEnvs / setConfig, and on a stubGlobal whose target is not a literal.
        stubs: ['fetch'],
        reason: "its vi.stubGlobal('fetch') is undone by the vi.unstubAllGlobals() in the close() every spec calls, and tests/unit/setup-shared.ts restores spies and unstubs again after each file",
    },
};

/**
 * The part of a vetted helper's exemption that the text rules would otherwise hide: everything the
 * exempted rules match must be a `vi.stubGlobal` of one of the helper's named globals.
 */
export function vettedHelperProblems(source, vetted) {
    const src = stripComments(source);
    const problems = [];
    const calls = [...src.matchAll(/\bvi\.stubGlobal\s*\(\s*([^,)]*)/g)];
    for (const [, target] of calls) {
        const m = /^(['"])(\w+)\1$/.exec(target.trim());
        if (!m) problems.push('stubs a global whose name is not a string literal');
        else if (!vetted.stubs.includes(m[2])) problems.push(`stubs the global ${m[2]}, which is not one of: ${vetted.stubs.join(', ')}`);
    }
    if (/\bvi\.(stubEnv|unstubAllEnvs|setConfig)\s*\(/.test(src)) problems.push('stubs the environment or changes the vitest config');
    if (/\b(globalThis|global)\.(?!fetch\b)\w+\s*=(?!=)/.test(src)) problems.push('assigns a global other than fetch');
    return problems;
}

/**
 * Top-level (column 0) statements that create state living as long as the module.
 * A `let`/`var` is always state. A collection or empty container is state only
 * when the module also mutates it, because a frozen lookup table is not.
 */
export const BENIGN_MODULE_STATE = {
    'server/lib/tz.ts': 'Intl.DateTimeFormat memo keyed by zone and options',
    'server/api/inspections/report-send-guards.ts': 'counterLocks holds a promise only while a send is in flight and deletes it when the chain drains; the per-request WeakMap is keyed by the Request object, which no later file can share',
    'server/lib/api-app.ts': 'the loader is written once by the worker entry; a spec that imports the entry or installs a fake loader is kept out of the shared project by the worker entry import and api app loader registration rules',
    'server/index.ts': "the OpenAPI document memo is built from this module's own immutable app object, so every spec that reads it gets the same answer",
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

function resolveSpecifier(root, from, spec, opts = {}) {
    let base;
    if (spec.startsWith('.')) base = resolve(dirname(from), spec);
    else if (spec.startsWith('~/')) base = join(root, 'app', spec.slice(2));
    else if (spec.startsWith('@core/field-ui')) base = join(root, 'packages/field-ui/src', spec.slice('@core/field-ui'.length));
    else if (spec === '@core/offline-package') base = join(root, 'packages/offline-package/index.ts');
    else if (opts.sharedUi && spec.startsWith('@core/shared-ui')) base = join(root, 'packages/shared-ui/src', spec.slice('@core/shared-ui'.length));
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

/** `import type ... from 'x'` / `export type ... from 'x'`: erased at build time, so no module is loaded. */
const TYPE_ONLY_IMPORT_RE = /^[ \t]*(?:import|export)\s+type\b(?:\s*\*(?:\s+as\s+\w+)?|\s*\{[^}]*\}|\s+\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s*from\s*['"][^'"]+['"]/gm;

/**
 * Source files a spec reaches through relative / alias imports (bare packages are not followed).
 * `opts.sharedUi` also resolves `@core/shared-ui`; `opts.skipTypeImports` ignores type-only imports.
 * Both default to off, which is the unit suite's behaviour. A `cache` must not be shared between
 * callers that pass different options.
 */
export function reachableFiles(root, specFile, cache = new Map(), opts = {}) {
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
            if (opts.skipTypeImports) text = text.replace(TYPE_ONLY_IMPORT_RE, (m) => m.replace(/[^\n]/g, ' '));
            for (const m of text.matchAll(IMPORT_RE)) {
                const r = resolveSpecifier(root, f, m[1], opts);
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
    const specText = readFileSync(abs, 'utf8');
    const problems = specHazards(specText).map((h) => `spec: ${h}`);
    // The harness stubs fetch and spies on the usage meter until its close(); a spec that opens one and never
    // closes it would leave both for the next file. (A spec that gets a harness through another helper is
    // judged by that helper; the setup file's restore is the net under it.)
    if (/\bcreateHarness\s*\(/.test(stripComments(specText)) && !/\.close\s*\(/.test(stripComments(specText))) {
        problems.push('spec: createHarness without close()');
    }
    const norm = (p) => p.replace(/\\/g, '/');
    for (const dep of reachableFiles(root, abs, graphCache)) {
        const rel = norm(dep).slice(norm(root).length + 1);
        if (KNOWN_MUTABLE_MODULES.includes(rel)) problems.push(`imports known mutable module ${rel}`);
        // A helper under tests/ is judged by the spec rules; product code by the module-state rules.
        if (rel.startsWith('tests/')) {
            const vetted = VETTED_HELPERS[rel];
            const text = readFileSync(dep, 'utf8');
            for (const h of specHazards(text)) if (!vetted?.hazards.includes(h)) problems.push(`helper ${rel}: ${h}`);
            if (vetted) for (const p of vettedHelperProblems(text, vetted)) problems.push(`helper ${rel}: ${p}`);
        } else if (rel.startsWith('server/') || rel.startsWith('app/') || rel.startsWith('packages/')) {
            if (BENIGN_MODULE_STATE[rel] || RESET_BY_SHARED_SETUP[rel] || GENERATED_I18N.test(rel)) continue;
            for (const h of moduleStateHazards(dep)) problems.push(`${rel}: ${h}`);
        }
    }
    return problems;
}

/**
 * What is wrong with the shared project's per-file setup: it must exist, call every reset named in
 * RESET_BY_SHARED_SETUP, and `vitest.api.config.ts` must load it for api-shared.
 */
export function setupProblems(root) {
    const rel = 'tests/unit/setup-shared.ts';
    let setup = '';
    try {
        setup = stripComments(readFileSync(join(root, rel), 'utf8'));
    } catch {
        return [`${rel} is missing, so the resets in RESET_BY_SHARED_SETUP are never called`];
    }
    const problems = [];
    for (const [mod, fn] of Object.entries(RESET_BY_SHARED_SETUP)) {
        if (!new RegExp(`\\b${fn}\\s*\\(`).test(setup)) problems.push(`${rel} does not call ${fn}(), which ${mod} relies on`);
    }
    let cfg = '';
    try {
        // stripComments would read the `/**` of a '**/node_modules/**' glob in this file as a block comment, so
        // only comments that start a line are removed (a trailing comment on a code line is left in place).
        cfg = readFileSync(join(root, 'vitest.api.config.ts'), 'utf8')
            .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
            .replace(/^[ \t]*\/\/.*$/gm, '');
    } catch {
        /* reported below */
    }
    // A mention in a comment (stripped above) or in the other project's block does not count.
    const from = cfg.search(/name\s*:\s*['"]api-shared['"]/);
    const to = cfg.search(/name\s*:\s*['"]api-isolated['"]/);
    const block = from >= 0 ? cfg.slice(from, to > from ? to : undefined) : '';
    if (!/\bsetupFiles\s*:\s*\[[^\]]*['"]tests\/unit\/setup-shared\.ts['"]/.test(block)) {
        problems.push("vitest.api.config.ts does not list tests/unit/setup-shared.ts in the api-shared project's setupFiles");
    }
    return problems;
}

/**
 * How many top-level statements of one file create module state, by the same detector the rules use
 * (`let`/`var`, a global written at the top level, a mutated top-level container, a top-level instance of
 * a class with collection state). Used to pin the files whose state is exempted wholesale.
 */
export function topLevelStateCount(file) {
    let text = '';
    try {
        text = stripComments(readFileSync(file, 'utf8'));
    } catch {
        return 0;
    }
    let n = (text.match(/^(?:export\s+)?(?:let|var)\s+\w/gm) ?? []).length;
    n += (text.match(/^\s*(?:globalThis|global)\.\w+\s*=(?!=)/gm) ?? []).length;
    for (const c of text.matchAll(CLASS_RE)) {
        const body = text.slice(c.index, (text.indexOf(`
}`, c.index) + 1) || text.length);
        const field = /^\s+(?:(?:private|protected|public|readonly|static)\s+)*\w+(?:\s*:(?:[^=\n]|=>)+)?\s*=\s*(?:new\s+(?:Map|Set|WeakMap|WeakSet)\b|\[\])/m;
        const made = new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+\\w+(?:\\s*:(?:[^=\\n]|=>)+)?\\s*=\\s*new\\s+${c[1]}\\b`, 'gm');
        if (field.test(body)) n += (text.match(made) ?? []).length;
    }
    for (const m of text.matchAll(CONTAINER_RE)) if (MUTATING(m[1]).test(text)) n += 1;
    return n;
}

/**
 * The state-creating statements of each file that is exempt from the module-state rules, as last
 * reviewed by a person. A file in BENIGN_MODULE_STATE or RESET_BY_SHARED_SETUP is skipped by the rules
 * as a whole, so without a pin a NEW top-level cache added to it would be invisible. Changing a number
 * here means the new state was read and is still benign (or is reset by the setup file).
 */
export const EXEMPT_STATE_PINS = {
    'server/lib/tz.ts': 1,
    'server/api/inspections/report-send-guards.ts': 2,
    'server/lib/api-app.ts': 1,
    'server/index.ts': 1,
    'server/lib/openapi/enrich-facts.ts': 1,
    'packages/field-ui/src/shared/intl-cache.ts': 3,
    'server/lib/ai/credentials/google-service-account.ts': 3,
    'server/lib/middleware/touch-last-active.ts': 1,
    'server/lib/csp-report.ts': 3,
};

/** Pure over the files under `root`: what is wrong with the pins of the exempt files. */
export function exemptStateProblems(
    root,
    pins = EXEMPT_STATE_PINS,
    exempt = [...Object.keys(BENIGN_MODULE_STATE), ...Object.keys(RESET_BY_SHARED_SETUP)],
) {
    const problems = [];
    for (const rel of exempt) {
        const abs = join(root, rel);
        if (!existsSync(abs)) {
            problems.push(`${rel}: exempt from the module-state rules but not a file on disk`);
            continue;
        }
        const actual = topLevelStateCount(abs);
        if (!(rel in pins)) problems.push(`${rel}: exempt from the module-state rules with no pinned state count (it has ${actual})`);
        else if (pins[rel] !== actual) {
            problems.push(`${rel}: has ${actual} top-level state statement(s), pinned at ${pins[rel]}; read the change, then update EXEMPT_STATE_PINS`);
        }
    }
    return problems;
}
