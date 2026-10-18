/**
 * Detector for lint:loader-budget.
 *
 * A route loader runs before the page can render, and each in-process API call it
 * makes is a full trip through the API's middleware chain. This detector reads
 * the TypeScript AST of every exported `loader` / `clientLoader` and reports the
 * shapes that make a loader slower than it has to be:
 *
 *  - fanout:           `Promise.all` / `Promise.allSettled` over an array literal of more than
 *                      MAX_FANOUT elements. A loader that waits on seven or more reads is
 *                      almost always loading data the first paint does not need.
 *  - call-in-loop:     an API call inside `.map` / `.flatMap` / `.forEach` or a `for` / `while`
 *                      loop: one call per item, the N+1 shape.
 *  - serial-independent: two adjacent `await api...` statements where the second does not
 *                      use anything the first produced. They can run together. Decided by
 *                      data flow (does the second statement name a binding the first
 *                      declared?), not by textual adjacency.
 *  - helper-in-loop / helper-serial: the same two shapes when the call is hidden behind a helper
 *                      that is handed the client (`await loadX(api, id)`). A helper that
 *                      takes `api` is assumed to call it.
 *  - hand-built-response: `new Response(JSON.stringify(...))`. A loader returns data; the
 *                      router serialises it.
 *  - allow-without-reason: a `loader-budget-allow:` marker with no reason after it.
 *
 * An intentional exception is a comment `// loader-budget-allow: <reason>` on the line above
 * the statement (or at the end of its first line). The reason is mandatory and exempts only
 * that statement.
 *
 * "API call" means a call whose callee chain starts at an identifier named `api` (the
 * result of createApi), or whose final member is a typed-client verb (`$get`, `$post`, ...).
 * A call that passes the identifier `api` as an argument (a helper) is tracked as its own kind,
 * so the baseline says honestly how much of it is direct and how much is behind helpers. A
 * helper that reaches the client some other way (a closure, a context) is not seen.
 */
import ts from 'typescript';

export const MAX_FANOUT = 6;
const LOADER_NAMES = new Set(['loader', 'clientLoader']);
const LOOP_METHODS = new Set(['map', 'flatMap', 'forEach']);
const ALLOW_RE = /loader-budget-allow:(.*)/;

/** The identifier a member/call chain starts from, or null. */
function rootIdentifier(expr) {
    let e = expr;
    for (;;) {
        if (ts.isIdentifier(e)) return e.text;
        if (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)
            || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)
            || ts.isAwaitExpression(e)) {
            e = e.expression;
            continue;
        }
        return null;
    }
}

function isApiCall(node) {
    if (!ts.isCallExpression(node)) return false;
    if (rootIdentifier(node.expression) === 'api') return true;
    const callee = node.expression;
    return ts.isPropertyAccessExpression(callee) && /^\$(get|post|put|patch|delete)$/.test(callee.name.text);
}

/** A call that hands the `api` client to a helper: `loadX(api, ...)`. Not itself an `api.` call. */
function isHelperCall(node) {
    if (!ts.isCallExpression(node) || isApiCall(node)) return false;
    return node.arguments.some((a) => ts.isIdentifier(a) && a.text === 'api');
}

function containsHelperCall(node) {
    let found = false;
    const visit = (n) => {
        if (found) return;
        if (isHelperCall(n)) { found = true; return; }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

function containsApiCall(node) {
    let found = false;
    const visit = (n) => {
        if (found) return;
        if (isApiCall(n)) { found = true; return; }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

function bindingNames(name, out = new Set()) {
    if (ts.isIdentifier(name)) out.add(name.text);
    else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
    return out;
}

/** `const x = await api...;` or `await api...;` (or `await helper(api, ...)`) -> its kind and the names it declares, else null. */
function awaitedApiStatement(stmt) {
    let init = null;
    let names = new Set();
    if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
        const d = stmt.declarationList.declarations[0];
        init = d.initializer ?? null;
        names = bindingNames(d.name);
    } else if (ts.isExpressionStatement(stmt)) {
        init = stmt.expression;
    }
    if (!init || !ts.isAwaitExpression(init)) return null;
    if (rootIdentifier(init.expression) === 'api') return { names, kind: 'direct' };
    return containsHelperCall(init.expression) && ts.isCallExpression(init.expression) && isHelperCall(init.expression)
        ? { names, kind: 'helper' }
        : null;
}

function referencesAny(node, names) {
    let hit = false;
    const visit = (n) => {
        if (hit) return;
        if (ts.isIdentifier(n) && names.has(n.text)) { hit = true; return; }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
}

/** The nearest enclosing statement (the node itself when it is one). */
function enclosingStatement(node) {
    let n = node;
    while (n && !ts.isStatement(n)) n = n.parent;
    return n;
}

function allowComment(src, stmt) {
    const ranges = ts.getLeadingCommentRanges(src, stmt.getFullStart()) ?? [];
    const lineEnd = src.indexOf('\n', stmt.getStart());
    const first = src.slice(stmt.getStart(), lineEnd === -1 ? src.length : lineEnd);
    const texts = ranges.map((r) => src.slice(r.pos, r.end));
    if (ALLOW_RE.test(first)) texts.push(first);
    for (const t of texts) {
        const m = ALLOW_RE.exec(t);
        if (m) return { present: true, reason: m[1].replace(/\*\/\s*$/, '').trim() };
    }
    return { present: false, reason: '' };
}

function collectLoaders(sf) {
    const loaders = [];
    const exported = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0;
    for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name && LOADER_NAMES.has(stmt.name.text) && exported(stmt) && stmt.body) {
            loaders.push(stmt.body);
        } else if (ts.isVariableStatement(stmt) && exported(stmt)) {
            for (const d of stmt.declarationList.declarations) {
                if (ts.isIdentifier(d.name) && LOADER_NAMES.has(d.name.text) && d.initializer
                    && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
                    loaders.push(d.initializer.body);
                }
            }
        }
    }
    return loaders;
}

/**
 * @param {string} src
 * @param {string} [fileName]
 * @returns {{ sites: number, violations: Array<{ line: number, rule: string, message: string }> }}
 *   `sites` is the number of loaders scanned.
 */
export function detectLoaderBudget(src, fileName = 'route.tsx') {
    const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true,
        fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const loaders = collectLoaders(sf);
    const violations = [];
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

    const report = (node, rule, message, stmtForAllow) => {
        const stmt = stmtForAllow ?? enclosingStatement(node);
        if (stmt) {
            const allow = allowComment(src, stmt);
            if (allow.present) {
                if (allow.reason === '') {
                    violations.push({ line: lineOf(stmt), rule: 'allow-without-reason', message: 'loader-budget-allow needs a reason after the colon' });
                }
                return;
            }
        }
        violations.push({ line: lineOf(node), rule, message });
    };

    const scan = (node, inLoop) => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
                && callee.expression.text === 'Promise' && (callee.name.text === 'all' || callee.name.text === 'allSettled')) {
                const arg = node.arguments[0];
                if (arg && ts.isArrayLiteralExpression(arg) && arg.elements.length > MAX_FANOUT) {
                    report(node, 'fanout', `Promise.${callee.name.text} over ${arg.elements.length} reads (limit ${MAX_FANOUT}); load what the first paint needs, defer the rest`);
                }
            }
            if (!inLoop && ts.isPropertyAccessExpression(callee) && LOOP_METHODS.has(callee.name.text)) {
                const fns = node.arguments.filter((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
                if (fns.some((a) => containsApiCall(a.body))) {
                    report(node, 'call-in-loop', `an API call inside .${callee.name.text}(): one call per item`);
                    inLoop = true;
                } else if (fns.some((a) => containsHelperCall(a.body))) {
                    report(node, 'helper-in-loop', `a helper that is handed the API client, inside .${callee.name.text}(): one call per item`);
                    inLoop = true;
                }
            }
        }
        if (!inLoop && (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)
            || ts.isWhileStatement(node) || ts.isDoStatement(node))) {
            if (containsApiCall(node)) {
                report(node, 'call-in-loop', 'an API call inside a loop: one call per iteration');
                inLoop = true;
            } else if (containsHelperCall(node)) {
                report(node, 'helper-in-loop', 'a helper that is handed the API client, inside a loop: one call per iteration');
                inLoop = true;
            }
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Response') {
            const first = node.arguments?.[0];
            if (first && ts.isCallExpression(first) && ts.isPropertyAccessExpression(first.expression)
                && ts.isIdentifier(first.expression.expression) && first.expression.expression.text === 'JSON'
                && first.expression.name.text === 'stringify') {
                report(node, 'hand-built-response', 'a loader returns data; do not build a Response by hand');
            }
        }
        if (ts.isBlock(node) || ts.isSourceFile(node)) checkAdjacent(node.statements);
        ts.forEachChild(node, (c) => scan(c, inLoop));
    };

    const checkAdjacent = (statements) => {
        for (let i = 1; i < statements.length; i++) {
            const a = awaitedApiStatement(statements[i - 1]);
            const b = awaitedApiStatement(statements[i]);
            if (!a || !b) continue;
            if (referencesAny(statements[i], a.names)) continue;
            report(statements[i], a.kind === 'direct' && b.kind === 'direct' ? 'serial-independent' : 'helper-serial',
                'awaits an API call that does not use the previous await\'s result; start both before awaiting (Promise.all)', statements[i]);
        }
    };

    for (const body of loaders) {
        if (ts.isBlock(body)) scan(body, false);
        else scan(body, false);
    }
    return { sites: loaders.length, violations };
}
