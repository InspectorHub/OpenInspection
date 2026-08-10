#!/usr/bin/env node
/**
 * Dynamic-import placement gate for the co-located web suite (#88/#89/#95).
 *
 * The defect: `await import()` of a module whose graph reaches
 * `~/paraglide/messages` costs 1.9-3.7 s of MAIN-THREAD transform. The generated
 * `app/paraglide/messages/_index.js` is ~3.67 MB and ~441 source files import
 * it, and Vite transforms it once on the single main thread every vitest worker
 * shares — so the cost is queueing, not compute, and it grows with how busy the
 * suite is. Inside an `it()` body that wait is billed against the 5000 ms
 * `testTimeout`, and whichever spec asks for the transform first while the
 * workers are starting draws the short straw. It reads as a flake because the
 * victim moves. In `beforeAll` the same load is billed against `hookTimeout`,
 * and loading a fixture is what a hook is for.
 *
 * So the rule is about WHERE the cost lands, not how big it is today: a module
 * import inside a timed test body is reported, and the fix is a three-line
 * hoist.
 *
 * WHAT IS NOT A GRAPH WALK (same shape, none of the cost — measured: a real
 * graph 1877 ms vs `?raw` 47 ms):
 *   - a Vite query suffix (`?raw`, `?url`, `?inline`) — Vite hands back the
 *     file's TEXT and never resolves what it imports;
 *   - `node:*` builtins — externalized, never transformed;
 *   - `.json` — a data module, which by construction imports nothing.
 * These are counted and printed, never silently dropped.
 *
 * A `typeof import('x')` is a TYPE and erases to nothing; the parser gives it a
 * different node kind entirely, so it can never be confused for a call here.
 *
 * WHY THE TYPESCRIPT PARSER AND NOT A REGEX: `app/components/editor/
 * batch-action-bar.test.ts` contains `/role="radio"/g`. A hand-rolled scanner
 * that skips string literals reads that `"` as an opening quote, desyncs, and
 * masks whatever follows — which does not produce an error, it produces a file
 * with no findings. The scariest failure mode of a gate is looking clean.
 *
 * LIMITS, stated so a green run is not read as more than it is:
 *   - helper indirection is followed ONE level (a module-scope function called
 *     from a test body). A helper that calls a helper is not followed.
 *   - a non-literal specifier cannot be classified; those are listed under
 *     "unresolved" on every run and do not fail the gate.
 *   - scope is the co-located web suite (`app/`), because that is the suite the
 *     paraglide graph lives in. `tests/unit/` runs a node env over server code.
 *
 * WHICH RUNG: `npm run lint` (pre-push + CI), not `run-gates.mjs` (pre-commit).
 * It parses all ~333 specs exactly rather than pre-filtering on a substring,
 * because a prefilter that is wrong does not error — it produces a green run.
 * That costs ~5.5 s (2.1 s of it just loading the TypeScript compiler), which
 * is the wrong shape for a per-commit hook and a rounding error next to the
 * eslint step it sits beside. It also loses nothing by waiting: what it
 * prevents is a suite that is slow and flaky in CI, which is where it runs.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Callee roots whose function arguments run under `testTimeout`. */
export const TIMED_ROOTS = new Set(["it", "test", "fit", "xit"]);

const SPEC_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "paraglide", ".types", "dist", "build"]);

/**
 * What a specifier costs. Only `graph` walks an import graph; everything else
 * is returned with the reason it is cheap so the run can print it.
 */
export function classifySpecifier(spec) {
    if (spec.includes("?")) {
        const q = spec.slice(spec.indexOf("?"));
        return { kind: "cheap", why: `vite query ${q} — the file's text, not its graph` };
    }
    if (spec.startsWith("node:")) return { kind: "cheap", why: "node builtin — externalized" };
    if (/\.json$/.test(spec)) return { kind: "cheap", why: "json data module — imports nothing" };
    return { kind: "graph", why: "resolves a module graph" };
}

const scriptKind = (file) =>
    /\.tsx$/.test(file)
        ? ts.ScriptKind.TSX
        : /\.jsx$/.test(file)
          ? ts.ScriptKind.JSX
          : /\.[cm]?js$/.test(file)
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;

/** Leftmost identifier of `it.each(t)` / `describe.skip` / `foo`. */
function calleeRoot(expr) {
    let node = expr;
    for (;;) {
        if (ts.isPropertyAccessExpression(node)) node = node.expression;
        else if (ts.isCallExpression(node)) node = node.expression;
        else if (ts.isParenthesizedExpression(node)) node = node.expression;
        else break;
    }
    return ts.isIdentifier(node) ? node.text : null;
}

const isFn = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n);

/**
 * Every dynamic-import call site in one parsed file, plus the ranges that are
 * billed against `testTimeout` and the module-scope helpers that carry imports.
 */
function readFile(file, source) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
    const parseErrors = (sf.parseDiagnostics ?? []).length;
    const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    /** [start, end) ranges whose contents run under `testTimeout`. */
    const timed = [];
    /** Every `import(...)` call expression in the file. */
    const imports = [];
    /** name -> declaration node, for module-scope function-valued bindings. */
    const helpers = new Map();

    for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name) helpers.set(st.name.text, st);
        else if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (d.initializer && isFn(d.initializer) && ts.isIdentifier(d.name)) {
                    helpers.set(d.name.text, d);
                }
            }
        }
    }

    (function walk(node) {
        if (ts.isCallExpression(node)) {
            if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                const arg = node.arguments[0];
                const literal = arg && ts.isStringLiteralLike(arg) ? arg.text : null;
                imports.push({ pos: node.getStart(sf), line: line(node), literal });
            } else if (TIMED_ROOTS.has(calleeRoot(node.expression))) {
                for (const a of node.arguments) if (isFn(a)) timed.push([a.getStart(sf), a.end]);
            }
        }
        ts.forEachChild(node, walk);
    })(sf);

    const inTimed = (pos) => timed.some(([s, e]) => pos >= s && pos < e);

    /** Helper names called from inside a timed body. */
    const calledFromTimed = new Set();
    (function walk(node) {
        if (
            ts.isIdentifier(node) &&
            helpers.has(node.text) &&
            ts.isCallExpression(node.parent) &&
            node.parent.expression === node &&
            inTimed(node.getStart(sf))
        ) {
            calledFromTimed.add(node.text);
        }
        ts.forEachChild(node, walk);
    })(sf);

    /** Imports reached one level down, through a helper a test body calls. */
    const viaHelper = new Map();
    for (const name of calledFromTimed) {
        const decl = helpers.get(name);
        for (const site of imports) {
            if (site.pos >= decl.getStart(sf) && site.pos < decl.end) viaHelper.set(site, name);
        }
    }

    return { sf, parseErrors, imports, inTimed, viaHelper };
}

/**
 * @param {{files: Array<{path: string, source: string}>}} input
 * Returns counts for EVERY file handed in — a spec with no dynamic import is a
 * pass, and says so, rather than vanishing from the tally.
 */
export function analyze({ files }) {
    const violations = [];
    const cheap = [];
    const unresolved = [];
    const unparsed = [];
    let sites = 0;
    let clean = 0;

    for (const f of files) {
        const { parseErrors, imports, inTimed, viaHelper } = readFile(f.path, f.source);
        if (parseErrors > 0) unparsed.push({ path: f.path, errors: parseErrors });
        sites += imports.length;
        if (imports.length === 0) clean++;

        for (const site of imports) {
            const via = viaHelper.get(site) ?? null;
            if (!inTimed(site.pos) && !via) continue;
            const where = { path: f.path, line: site.line, via };
            if (site.literal === null) {
                unresolved.push({ ...where, why: "specifier is not a string literal" });
                continue;
            }
            const { kind, why } = classifySpecifier(site.literal);
            if (kind === "cheap") cheap.push({ ...where, spec: site.literal, why });
            else violations.push({ ...where, spec: site.literal });
        }
    }

    return { examined: files.length, clean, sites, violations, cheap, unresolved, unparsed };
}

export function specFiles(root, dir = "app") {
    const out = [];
    (function walk(d) {
        for (const name of readdirSync(d)) {
            const full = path.join(d, name);
            if (statSync(full).isDirectory()) {
                if (!SKIP_DIRS.has(name)) walk(full);
            } else if (SPEC_RE.test(name)) out.push(full);
        }
    })(path.join(root, dir));
    return out.sort();
}

function main() {
    const root = process.cwd();
    const files = specFiles(root).map((full) => ({
        path: path.relative(root, full).split(path.sep).join("/"),
        source: readFileSync(full, "utf8"),
    }));
    const r = analyze({ files });

    // Printed on every run, pass or fail. "Clean" must never be able to mean
    // "matched nothing": the examined count is the only thing that tells the two
    // apart, and a spec with no dynamic import at all is a PASS that is counted,
    // not a file that was skipped.
    console.log(
        `check-test-imports: examined ${r.examined} spec file(s) under app/ — ` +
            `${r.clean} with no dynamic import (passing), ` +
            `${r.examined - r.clean} with at least one; ` +
            `${r.sites} dynamic import site(s) in total.`,
    );
    if (r.cheap.length) {
        const tally = new Map();
        for (const c of r.cheap) tally.set(c.why, (tally.get(c.why) ?? 0) + 1);
        console.log("  cheap imports inside a test body, allowed —");
        for (const [why, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`    ${n}x ${why}`);
    }
    if (r.unresolved.length) {
        console.log("  sites the scanner could not classify and did not judge —");
        for (const u of r.unresolved) console.log(`    ${u.path}:${u.line} — ${u.why}`);
    }

    for (const u of r.unparsed) {
        console.error(
            `\n${u.path}: ${u.errors} parse error(s). A file the parser choked on ` +
                "contributes no findings and would otherwise read as clean.",
        );
    }
    for (const v of r.violations) {
        console.error(
            `\n${v.path}:${v.line}  import("${v.spec}")` +
                (v.via ? ` — reached from a test body via ${v.via}()` : " inside a test body"),
        );
    }
    if (r.violations.length || r.unparsed.length) {
        console.error(
            `\n✖ check-test-imports: ${r.violations.length} module import(s) billed against ` +
                `testTimeout, ${r.unparsed.length} unparsable file(s).`,
        );
        console.error(
            "  In order of preference:\n" +
                "  1. Make it a STATIC import at the top of the file. It is paid during\n" +
                "     COLLECTION, which has no timeout at all, so it is never anyone's\n" +
                "     deadline. See app/components/sidebar.test.ts.\n" +
                "  2. If a `vi.doMock` must be installed before the module resolves, the\n" +
                "     import has to stay dynamic — hoist it into `beforeAll` and assign a\n" +
                "     module-scoped binding. See app/routes/settings-automations.test.ts\n" +
                "     for the minimal form and app/routes/public/\n" +
                "     repair-builder-action-tag-seam.test.tsx for the version with\n" +
                "     module-scoped mocks. NOTE `beforeAll` is budgeted by hookTimeout\n" +
                "     (10000 ms default) — separate from testTimeout, but not absent. A\n" +
                "     graph measured at 19206 ms under load blows both.\n" +
                "  3. NOT a raised timeout of either kind. It keeps the cost and moves the\n" +
                "     cliff, the cliff moves again on a loaded runner, and it only ever\n" +
                "     protects the payer — the other workers queue behind the same\n" +
                "     transform regardless.",
        );
        process.exit(1);
    }
    console.log("✓ check-test-imports: no module graph is loaded inside a timed test body.");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(path.sep).join("/"))) main();
