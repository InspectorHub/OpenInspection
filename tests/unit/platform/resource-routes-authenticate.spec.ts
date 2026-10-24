/**
 * Every React Router resource route that exports an `action` or a `loader` must authenticate the caller, and the
 * token getter has to be called INSIDE that function (or inside a helper of the same file that it calls).
 *
 * The Hono route gates (idempotency coverage, mutating-route guards, URL taxonomy) enumerate server routes only, so
 * a resource route under app/routes/resources/ is invisible to them. Several of these are plain-fetch endpoints (the
 * media upload, the editor command channel), which makes "it calls a token getter" the whole of their access control.
 *
 * The check reads the TypeScript syntax tree. A getter name in a comment or a string, a getter that is only
 * mentioned (`const f = getToken`), a getter in a function the export never calls, and a getter in the loader when
 * the action has none all fail. A route that re-exports another module's action or loader is judged by the function
 * in that module.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'app', 'routes', 'resources');

/** Routes that are deliberately public, keyed `file#export`. Each needs the reason its work is still safe. */
const PUBLIC_ON_PURPOSE: Record<string, string> = {
    'view-tracking.tsx#action': 'records an anonymous report view; the API call it makes authenticates with its own token',
};

const GETTERS = ['requireToken', 'getToken', 'requireAdmin'];
const EXPORTS = ['action', 'loader'] as const;
type ExportName = (typeof EXPORTS)[number];

interface Finding {
    exportName: ExportName;
    /** Where the function is defined: this file, or the module a re-export points at. */
    definedIn: string;
    /** True when a getter is called inside the function or a same-file helper it calls. */
    authenticated: boolean;
}

function sourceOf(file: string, text: string): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** The function-like body bound to each top-level name of a file: function declarations and `const f = () => ...`. */
function topLevelFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
    const out = new Map<string, ts.Node>();
    for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name && st.body) out.set(st.name.text, st);
        else if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name) && d.initializer) out.set(d.name.text, d.initializer);
            }
        }
    }
    return out;
}

const isExported = (st: ts.Node): boolean => !!(ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

/** True when `node` CALLS a getter, or calls (transitively) a same-file helper that does. */
function callsGetter(node: ts.Node, fns: Map<string, ts.Node>, seen = new Set<ts.Node>()): boolean {
    if (seen.has(node)) return false;
    seen.add(node);
    let found = false;
    const visit = (n: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(n)) {
            const callee = n.expression;
            if (ts.isIdentifier(callee)) {
                if (GETTERS.includes(callee.text)) { found = true; return; }
                const helper = fns.get(callee.text);
                if (helper && callsGetter(helper, fns, seen)) { found = true; return; }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

function resolveModule(from: string, spec: string): string | null {
    const base = resolve(dirname(from), spec);
    for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
        const p = base + ext;
        if (existsSync(p) && statSync(p).isFile()) return p;
    }
    return null;
}

/**
 * One finding per exported `action` / `loader` of a source. `read` supplies the text of a re-export target.
 * Handles `export async function`, `export const x = ...`, `export { x }` of a local, and `export { x } from "..."`.
 */
function findings(file: string, text: string, read: (path: string) => string | null, depth = 0): Finding[] {
    const sf = sourceOf(file, text);
    const fns = topLevelFunctions(sf);
    const out: Finding[] = [];
    for (const name of EXPORTS) {
        let body: ts.Node | undefined;
        for (const st of sf.statements) {
            if (ts.isFunctionDeclaration(st) && st.name?.text === name && isExported(st) && st.body) body = st;
            if (ts.isVariableStatement(st) && isExported(st)) {
                for (const d of st.declarationList.declarations) {
                    if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) body = d.initializer;
                }
            }
            // `export * from` could re-export an action this scan would never see: refuse rather than skip it silently.
            if (ts.isExportDeclaration(st) && !st.exportClause && st.moduleSpecifier) {
                throw new Error(`${file} uses \`export * from\`, which this check cannot follow: name the exports instead`);
            }
            if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
                for (const el of st.exportClause.elements) {
                    if ((el.name.text) !== name) continue;
                    const local = (el.propertyName ?? el.name).text;
                    if (!st.moduleSpecifier) {
                        body = fns.get(local);
                    } else if (ts.isStringLiteral(st.moduleSpecifier)) {
                        const target = resolveModule(file, st.moduleSpecifier.text);
                        const targetText = target ? read(target) : null;
                        if (!target || targetText === null || depth > 3) throw new Error(`${file} re-exports ${name} from ${st.moduleSpecifier.text}, which does not resolve`);
                        const inner = findings(target, targetText, read, depth + 1).find((f) => f.exportName === local);
                        if (!inner) throw new Error(`${target} does not export ${local}`);
                        out.push({ exportName: name, definedIn: inner.definedIn, authenticated: inner.authenticated });
                        body = undefined;
                        break;
                    }
                }
            }
        }
        if (body) out.push({ exportName: name, definedIn: file, authenticated: callsGetter(body, fns) });
    }
    return out;
}

function listRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listRouteFiles(p));
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) out.push(p);
    }
    return out;
}

const readDisk = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const rel = (p: string) => relative(DIR, p).split('\\').join('/');

describe('resource routes with an action or a loader authenticate the caller', () => {
    const files = listRouteFiles(DIR);
    const all = files.flatMap((f) => findings(f, readFileSync(f, 'utf8'), readDisk).map((x) => ({ file: rel(f), ...x })));
    const actions = all.filter((x) => x.exportName === 'action');

    it('scans a plausible set (an empty glob must not pass)', () => {
        // 21 actions today: 20 own plus the editor command channel. Both numbers are printed so a drift is visible.
        const bad = all.filter((x) => !x.authenticated && !PUBLIC_ON_PURPOSE[`${x.file}#${x.exportName}`]);
        console.info(`resource routes: ${files.length} files scanned, ${actions.length} actions, ${all.length - actions.length} loaders, ${bad.length} unauthenticated`);
        expect(actions.length).toBeGreaterThanOrEqual(21);
        expect(all.length - actions.length).toBeGreaterThanOrEqual(25);
        expect(actions.map((x) => x.file)).toContain('inspection-editor-command.ts');
    });

    it.each(all.map((x) => [`${x.file}#${x.exportName}`, x] as const))('%s calls a token getter inside the function, or is public on purpose', (key, x) => {
        if (PUBLIC_ON_PURPOSE[key]) return;
        expect(x.authenticated, `${key} (defined in ${rel(x.definedIn)}) calls no token getter inside the function or a same-file helper it calls`).toBe(true);
    });

    it('every public-on-purpose entry still exists', () => {
        const keys = all.map((x) => `${x.file}#${x.exportName}`);
        for (const k of Object.keys(PUBLIC_ON_PURPOSE)) expect(keys, k).toContain(k);
    });
});

describe('the check can say no', () => {
    const run = (src: string) => findings('/virtual/route.tsx', src, () => null).map((f) => `${f.exportName}:${f.authenticated}`);

    it('refuses a star re-export it cannot follow', () => {
        expect(() => run('export * from "./other";')).toThrow(/export \* from/);
    });
    it('a clean route passes', () => {
        expect(run('export async function action({ request }) { const t = await requireToken(request); return t; }')).toEqual(['action:true']);
        expect(run('export const loader = async ({ request }) => { await getToken(request); };')).toEqual(['loader:true']);
    });
    it('a getter only in the loader does not cover the action', () => {
        const src = 'export async function loader({ request }) { await requireToken(request); }\nexport async function action({ request }) { return null; }';
        expect(run(src)).toEqual(['action:false', 'loader:true']);
    });
    it('a getter in an unrelated function does not cover the export', () => {
        expect(run('async function unrelated(r) { await requireToken(r); }\nexport async function action() { return null; }')).toEqual(['action:false']);
    });
    it('a getter in a same-file helper the export calls does count, a helper it never calls does not', () => {
        expect(run('async function auth(r) { return requireAdmin(r); }\nexport async function action({ request }) { await auth(request); }')).toEqual(['action:true']);
        expect(run('async function auth(r) { return requireAdmin(r); }\nexport async function action({ request }) { return null; }')).toEqual(['action:false']);
        expect(run('const auth = async (r) => getToken(r);\nconst inner = async (r) => auth(r);\nexport const action = async ({ request }) => inner(request);')).toEqual(['action:true']);
    });
    it('a getter in a comment or a string, or only referenced, does not count', () => {
        expect(run('// requireToken(\nexport async function action() { return "getToken(request)"; }')).toEqual(['action:false']);
        expect(run('export async function action() { const f = getToken; return f; }')).toEqual(['action:false']);
        expect(run('export async function action() { return obj.getToken(1); }')).toEqual(['action:false']);
    });
    it('a getter in a function nested inside an exported function counts as inside it', () => {
        expect(run('export async function action({ request }) { const go = async () => requireToken(request); await go(); }')).toEqual(['action:true']);
    });
    it('a local `export { action }` list is judged by the function it names', () => {
        expect(run('async function action() { return null; }\nexport { action };')).toEqual(['action:false']);
        expect(run('async function action(r) { return requireToken(r); }\nexport { action };')).toEqual(['action:true']);
    });
    it('a re-export is judged by the module it points at, and a missing target is an error, not a pass', () => {
        const dir = mkdtempSync(join(tmpdir(), 'resource-route-'));
        try {
            writeFileSync(join(dir, 'open.ts'), 'export async function action(r) { return null; }');
            writeFileSync(join(dir, 'closed.ts'), 'export async function action(r) { return requireToken(r); }');
            const spec = (m: string) => findings(join(dir, 'route.ts'), `export { action } from "./${m}";`, readDisk).map((f) => f.authenticated);
            expect(spec('open')).toEqual([false]);
            expect(spec('closed')).toEqual([true]);
            expect(() => spec('missing')).toThrow(/does not resolve/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it('a non-exported function named action is not a route export', () => {
        expect(run('async function action() { return null; }')).toEqual([]);
    });
});
