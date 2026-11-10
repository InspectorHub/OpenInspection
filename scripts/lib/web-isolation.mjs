/**
 * Rules for deciding which web specs (`app/**`, `packages/shared-ui`, `packages/field-ui`) may share
 * a module registry.
 *
 * `vitest.config.ts` runs three projects. `web-isolated` is the historical behaviour: every spec file
 * gets a fresh module graph. `web-node-shared` and `web-dom-shared` run with `isolate: false`, one per
 * environment, so the files a worker handles one after another reuse the graph (and, for the dom
 * project, the same happy-dom window) the first one built. That is only sound for a spec that leaves
 * nothing behind and depends on nothing a neighbour could have left behind, so membership is decided
 * by these rules and recorded in `tests/web-isolation.json`.
 *
 * The rules are the unit suite's (`scripts/lib/unit-isolation.mjs`) minus the two that are normal for
 * a web spec (an environment docblock, DOM access) plus the browser-global writes a web spec makes.
 * Used by `gen-web-isolation.mjs` (writes the manifest) and `check-web-isolation.mjs` (fails when a
 * listed spec breaks a rule).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    BENIGN_MODULE_STATE as UNIT_BENIGN_MODULE_STATE,
    SPEC_HAZARDS,
    moduleStateHazards,
    reachableFiles,
    stripComments,
} from './unit-isolation.mjs';

/** Directories `vitest.config.ts` collects `*.test.ts(x)` from. Keep in step with its `include`. */
export const WEB_SPEC_ROOTS = ['app', 'packages/shared-ui/src', 'packages/field-ui/src'];

/** Every web spec, as sorted forward-slash paths relative to `root`. */
export function listWebSpecs(root) {
    const out = [];
    const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.name === 'node_modules') continue;
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.test\.tsx?$/.test(e.name)) out.push(p.slice(root.length + 1).replaceAll(String.fromCharCode(92), '/'));
        }
    };
    for (const r of WEB_SPEC_ROOTS) {
        try {
            walk(join(root, r));
        } catch {
            /* a root that does not exist holds no spec */
        }
    }
    return out.sort();
}

/** The unit rules that do not apply to a web spec: it declares its environment and touches the DOM by design. */
const NOT_WEB_RULES = new Set(['environment docblock', 'unrestored fake DOM']);

/** Spec-level hazards of a web spec: the unit ones that still apply, plus browser globals. */
export const WEB_SPEC_HAZARDS = [
    ...SPEC_HAZARDS.filter(([name]) => !NOT_WEB_RULES.has(name)),
    ['browser storage write', /\b(sessionStorage|indexedDB)\b/],
    ['localStorage write', /\blocalStorage\.(setItem|removeItem|clear)\b/],
    [
        'navigator/location/history write',
        /\b(navigator|location|history)\b[^;\n]{0,40}(defineProperty|=(?!=))|window\.location\s*=|history\.(pushState|replaceState)|Object\.defineProperty\(\s*(navigator|window\.navigator|window\.location|document)\b/,
    ],
    [
        'browser API replacement',
        /\b(matchMedia|ResizeObserver|IntersectionObserver|WebSocket|EventSource|Notification|requestAnimationFrame|scrollTo|scrollIntoView|\w*Element\.prototype|URL\.(createObjectURL|revokeObjectURL))\b[^;\n]{0,30}=(?!=)|(\w*Element|Node|window|document)\.prototype\.\w+\s*=/,
    ],
    [
        'document head/body mutation',
        /\bdocument\.(body|head|documentElement)\.(appendChild|append|prepend|innerHTML|insertAdjacentHTML|classList|className|style|setAttribute|replaceChildren|removeChild)\b|\bdocument\.(title|cookie|adoptedStyleSheets)\s*=|document\.(body|head)\.\w+\s*=(?!=)/,
    ],
    ['manual mount', /\bdocument\.createElement\([^)]*\)[\s\S]{0,400}?document\.body\.appendChild|\bcreateRoot\s*\(|ReactDOM\.render|\.hydrateRoot\b/],
    ['style injection', /\bnew CSSStyleSheet|\.insertRule\(|createElement\(\s*['"]style['"]/],
    [
        'spy on a browser object',
        /\bvi\.spyOn\(\s*(document|window|navigator|localStorage|sessionStorage|Storage\.prototype|URL|history|location|\w*Element\.prototype)\b/,
    ],
];

/**
 * Modules a web spec can reach whose top level keeps state, found by reading each one and
 * confirming the state cannot carry a result from one spec file to another. One verified reason per
 * module, written down so a later reader can re-check it. The unit suite's own list applies too.
 */
export const WEB_BENIGN_MODULE_STATE = {
    ...UNIT_BENIGN_MODULE_STATE,
    'packages/shared-ui/src/layers.ts':
        'overlay stack, scroll-lock counter and pinned-body styles are written only inside effects and return to empty or zero when the component unmounts (cleanup runs after every test); nextOrder is a monotonic integer used only to compare two layers; tests/setup-web-shared.ts fails a test that leaves a layer or the body lock behind',
    'packages/field-ui/src/context.tsx':
        'blobTokens is a WeakMap keyed by the Blob object (it cannot outlive or collide across tests) and nextBlobToken only needs to be unique, so the identity of one request never depends on which spec ran first; no spec asserts a literal token',
    'app/lib/session.server.ts':
        'lazy memos of the derived session secret and the cookie storage, both keyed by the secret they were built from and rebuilt when it differs, so the value is a pure function of the input and never of the test that filled it',
    'packages/field-ui/src/collab/media-upload-queue.ts':
        'the draining, swapped, swapFailed and refused sets are written only by drainMediaQueue; the in-flight set empties in a finally, and the three session sets hold a record id only after a failed swap, delete or a permanent refusal, which only useMediaDrain.test.tsx drives (it is kept in forcedIsolated for exactly that); every other spec reaches the module without draining a failing queue',
    'packages/field-ui/src/lib/video-media-delete.ts':
        'the inFlight set holds one key per delete request and removes it in a finally as soon as the request settles, so it is empty again once the awaited call returns',
    'packages/field-ui/src/components/editor/MobileDrawerTriggers.tsx':
        'mountedNavs counts mounted instances: incremented in an effect, decremented by its cleanup, and the data-mobile-nav mark is removed by the last one, so it is back to zero after unmount; tests/setup-web-shared.ts fails a test that leaves the mark behind',
    'app/hooks/useToast.ts':
        'toastListeners holds one subscriber per mounted useToastQueue, added in an effect and filtered out by its cleanup; pushToast with no subscriber is dropped, so nothing queued by one spec reaches the next',
};

/**
 * Extra module-level shapes that matter in a browser: store singletons, observers and listeners
 * registered at import time.
 */
const WEB_MODULE_PATTERNS = [
    ['zustand store singleton', /from\s+['"]zustand/],
    ['module-level singleton', /^(export\s+)?const\s+\w+\s*=\s*new\s+(QueryClient|EventTarget|BroadcastChannel|AbortController)/m],
    [
        'module-level registry',
        /^(export\s+)?const\s+(listeners|subscribers|handlers|registry|cache|store|memo|pending|inflight)\w*\s*(:[^=\n]+)?=\s*(new\s+(Map|Set|WeakMap)|\[\]|\{\})/m,
    ],
    ['module-level listener', /^(window|document)\.addEventListener\(/m],
    ['module-level DOM access', /^(export\s+)?const\s+\w+\s*=\s*(typeof\s+window[^?]*\?\s*)?(window|document)\./m],
];

/**
 * Hazards that are accepted in a shared spec because tests/setup-web.ts undoes them after every test, for every
 * project. Each entry names the hazard rule it lifts and the line of the setup file that carries the guarantee;
 * `setupResetProblems` fails when that line goes, so an exemption cannot outlive the reset it depends on.
 */
export const SETUP_RESETS = {
    'fake timers': { setup: 'tests/setup-web.ts', needle: /vi\.useRealTimers\(\)/, call: 'vi.useRealTimers()' },
    'localStorage write': { setup: 'tests/setup-web.ts', needle: /localStorage\.clear\(\)/, call: 'localStorage.clear()' },
};

/** One string per exempted hazard whose reset is missing from its setup file (empty = every exemption is backed). */
export function setupResetProblems(root) {
    const problems = [];
    for (const [hazard, { setup, needle, call }] of Object.entries(SETUP_RESETS)) {
        let text = '';
        try {
            text = stripComments(readFileSync(join(root, setup), 'utf8'));
        } catch {
            /* a missing setup file backs nothing */
        }
        if (!/afterEach\(/.test(text) || !needle.test(text)) {
            problems.push(`${setup} no longer calls ${call} in an afterEach, so specs with "${hazard}" can no longer share a worker (scripts/lib/web-isolation.mjs SETUP_RESETS)`);
        }
    }
    return problems;
}

const GENERATED_I18N = /^(app\/paraglide\/|packages\/field-ui\/src\/i18n\/generated\/)/;

/** The environment a spec asks for in its docblock; `node` when it names none (the project default). */
export function webSpecEnvironment(source) {
    const m = source.match(/@vitest-environment\s+([\w-]+)/);
    return m ? m[1] : 'node';
}

/** Spec-level hazards of one web spec or spec helper, as strings. */
export function webSpecHazards(source) {
    const src = stripComments(source);
    const hits = [];
    for (const [name, re] of WEB_SPEC_HAZARDS) {
        if (SETUP_RESETS[name]) continue;
        if (re.test(src) && !hits.includes(name)) hits.push(name);
    }
    // Fake timers are accepted because tests/setup-web.ts puts the real ones back after every TEST; a clock
    // installed once for the whole file (beforeAll / afterAll) would be torn down after its first test.
    if (/\b(beforeAll|afterAll)\(\s*(\(\)\s*=>\s*)?\{?\s*vi\.(useFakeTimers|setSystemTime)\b/.test(src)) hits.push('fake timers in a file-level hook');
    const env = webSpecEnvironment(source);
    if (env !== 'node' && env !== 'happy-dom') hits.push(`environment ${env}`);
    // A global written through an alias: `const g = globalThis; g.x = 1`.
    for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:globalThis|global|self|window)\s*(?:as\b[^;\n]*)?(?:;|$)/gm)) {
        if (new RegExp(`\\b${m[1]}(\\.\\w+\\s*|\\[[^\\]]+\\]\\s*)(=(?!=)|\\+=|\\|\\|=|\\?\\?=)`).test(src) && !hits.includes('global write')) hits.push('global write');
    }
    // A spy with no restore survives into the next spec the worker runs.
    if (/\bvi\.spyOn\(/.test(src) && !/\brestoreAllMocks\b|\.mockRestore\(|restoreMocks/.test(src)) hits.push('spy without restore');
    return hits;
}

const stateCache = new Map();
/** Module-state hazards of one product file: the unit patterns plus the browser ones. */
export function webModuleHazards(file) {
    if (stateCache.has(file)) return stateCache.get(file);
    const hits = [...moduleStateHazards(file)];
    if (/\.(ts|tsx|mjs|js)$/.test(file)) {
        let text = '';
        try {
            text = stripComments(readFileSync(file, 'utf8'));
        } catch {
            /* unreadable */
        }
        for (const [name, re] of WEB_MODULE_PATTERNS) if (re.test(text)) hits.push(name);
    }
    stateCache.set(file, hits);
    return hits;
}

/**
 * Everything wrong with putting `specFile` (relative to `root`) in a shared web project, as strings,
 * and the environment it declares. Empty `problems` = eligible.
 */
export function webSharedProblems(root, specFile, graphCache = new Map()) {
    const abs = resolve(root, specFile);
    const source = readFileSync(abs, 'utf8');
    const problems = webSpecHazards(source).map((h) => `spec: ${h}`);
    const norm = (p) => p.replace(/\\/g, '/');
    for (const dep of reachableFiles(root, abs, graphCache, { sharedUi: true, skipTypeImports: true })) {
        const rel = norm(dep).slice(norm(root).length + 1);
        if (/\.test\.tsx?$/.test(rel)) continue;
        // A helper under tests/ or a fixture module is judged by the spec rules; product code by the module-state rules.
        if (rel.startsWith('tests/')) {
            for (const h of webSpecHazards(readFileSync(dep, 'utf8'))) problems.push(`helper ${rel}: ${h}`);
            continue;
        }
        if (!(rel.startsWith('server/') || rel.startsWith('app/') || rel.startsWith('packages/'))) continue;
        if (WEB_BENIGN_MODULE_STATE[rel] || GENERATED_I18N.test(rel)) continue;
        for (const h of webModuleHazards(dep)) problems.push(`${rel}: ${h}`);
        if (/fixtures?|test-utils|\.stub\./.test(rel)) {
            for (const h of webSpecHazards(readFileSync(dep, 'utf8'))) problems.push(`helper ${rel}: ${h}`);
        }
    }
    return { env: webSpecEnvironment(source), problems };
}
