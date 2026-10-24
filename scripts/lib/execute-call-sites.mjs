/**
 * The field-ui command channel: every call of the data source's `execute` is a write, exactly like a raw
 * `fetcher.submit(`. app/ has no `.execute(` today, which is why the shape is not scoped by path. The only escape
 * is a `busy-controls-allow: <reason>` comment on the call's line or up to three lines above it (the reason must
 * contain a word).
 *
 * Detection reads the TypeScript syntax tree, not the text, so formatting and quoting cannot hide a call. Shapes
 * recognised (on comment-blanked text):
 *   - member calls: `ds.execute(c)`, `ds?.execute(c)`, `ds!.execute(c)`, `f().execute(c)`, `list[0].execute(c)`,
 *     `ds['execute'](c)`, `ds.execute?.(c)`, `(ds.execute)(c)`, with any whitespace or line break between the parts;
 *   - a destructured `execute`, renamed or not, and called under the bound name: `const { execute } = ds;`,
 *     `const { execute: run } = ds; run(c)`, a destructured parameter `function F({ execute }) { execute(c) }`
 *     (arrow functions too), a nested pattern `const { data: { execute } } = x`, and the assignment form
 *     `({ execute } = ds)`. A binding counts inside the scope that declares it, so a bare `execute(c)` that nothing
 *     destructured is a different function and stays clean;
 *   - a reference that is not a call (`const run = ds.execute`, `ds.execute.call(`, `ds['execute']`, handing the
 *     bound name to something), which would hide the call from the shapes above.
 * A method or function merely named `execute` (`async execute(id) {`, `interface { execute(): void }`) is none of
 * these and stays clean.
 *
 * Used by scripts/check-submit-guard.mjs and scripts/lib/busy-controls-detect.mjs. The returned shape is
 * unchanged: `{ index, label }` with `index` at the first character of the call expression (or the reference).
 *
 * Note for callers: a string-literal member (`ds['execute'](c)`) is only visible when the caller leaves string
 * contents in the text it passes. check-submit-guard does (it blanks comments only); busy-controls-detect blanks
 * strings too, so it cannot see that shape until it passes this module the unblanked text.
 */
import ts from 'typescript';

const EXECUTE_ALLOW = /(?:\/\/|\/\*)\s*busy-controls-allow:\s*\S*\w/;

const newlinesBefore = (text, at) => (text.slice(0, at).match(/\n/g) ?? []).length;

/** Parsed once per text: TSX first (the field-ui sources are mostly .tsx), plain TS when that reads worse. */
const parsed = new Map();
function parse(text) {
    const cached = parsed.get(text);
    if (cached) return cached;
    const tsx = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let best = tsx;
    if (tsx.parseDiagnostics.length > 0) {
        const plain = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        if (plain.parseDiagnostics.length < tsx.parseDiagnostics.length) best = plain;
    }
    // Not an error when diagnostics remain: some callers hand this module text whose strings and comments were
    // blanked first, which is not always valid syntax, and the tree is still good enough to find calls in.
    if (parsed.size > 64) parsed.clear();
    parsed.set(text, best);
    return best;
}

/** Strips the wrappers that do not change what is called: parentheses, `!`, `as T`, `<T>x`, `satisfies T`. */
function unwrap(node) {
    let n = node;
    while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)
        || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
    return n;
}

/** True for a string-like literal whose value is exactly `execute`. */
const isExecuteLiteral = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === 'execute';
/** True for a property name (identifier or string) that reads `execute`. */
const isExecuteName = (n) => n !== undefined && (ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === 'execute';

/** `x.execute` / `x['execute']`: the member that IS the data source's execute. */
function isExecuteMember(n) {
    if (ts.isPropertyAccessExpression(n)) return n.name.text === 'execute';
    if (ts.isElementAccessExpression(n)) return isExecuteLiteral(unwrap(n.argumentExpression));
    return false;
}

const isScope = (n) => ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseBlock(n)
    || ts.isFunctionLike(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || ts.isCatchClause(n);

/** The syntactic scope a binding belongs to: its function for a parameter, else the nearest block-like ancestor. */
function scopeOf(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isParameter(n)) return n.parent;
        if (isScope(n)) return n;
    }
    return node.getSourceFile();
}

const contains = (outer, inner) => inner.pos >= outer.pos && inner.end <= outer.end;

/** Every identifier bound to `execute` by destructuring, with the scope that declares it. */
function collectBindings(sf) {
    /** @type {{ name: string, scope: ts.Node, decl: ts.Node }[]} */
    const out = [];
    const fromLiteral = (lit, scope) => {
        for (const p of lit.properties) {
            if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'execute') out.push({ name: 'execute', scope, decl: p.name });
            else if (ts.isPropertyAssignment(p)) {
                const init = unwrap(p.initializer);
                if (isExecuteName(p.name) && ts.isIdentifier(init)) out.push({ name: init.text, scope, decl: init });
                else if (ts.isObjectLiteralExpression(init)) fromLiteral(init, scope);
            }
        }
    };
    const visit = (n) => {
        if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && ts.isIdentifier(n.name)
            && isExecuteName(n.propertyName ?? n.name) && !n.dotDotDotToken) {
            out.push({ name: n.name.text, scope: scopeOf(n), decl: n.name });
        } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isObjectLiteralExpression(unwrap(n.left))) {
            fromLiteral(unwrap(n.left), sf);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

/** True when `id` is a name being declared or a property name, not a use of a value. */
function isNameSlot(id) {
    const p = id.parent;
    if (!p) return false;
    if (ts.isPropertyAccessExpression(p)) return p.name === id;
    if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return true;
    if (ts.isBindingElement(p)) return p.name === id || p.propertyName === id;
    if (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)
        || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)
        || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) return p.name === id;
    if (ts.isPropertyAssignment(p) || ts.isJsxAttribute(p)) return p.name === id;
    if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
    if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
    if (ts.isShorthandPropertyAssignment(p)) {
        // `({ execute } = ds)` declares; `{ execute }` as an expression hands the bound value over.
        const lit = p.parent;
        const host = ts.isObjectLiteralExpression(lit) ? lit.parent : undefined;
        return !!host && ts.isBinaryExpression(host) && host.operatorToken.kind === ts.SyntaxKind.EqualsToken && host.left === lit;
    }
    return false;
}

/**
 * Offsets (and the text to show) of every `execute` use in `text`, before any marker is applied.
 * @param {string} text source with comments blanked, offsets preserved
 * @returns {{ index: number, label: string }[]}
 */
export function executeCallIndices(text) {
    if (!/execute/.test(text)) return [];
    const sf = parse(text);
    const bindings = collectBindings(sf);
    const out = [];
    const boundAt = (id) => bindings.some((b) => b.name === id.text && b.decl !== id && contains(b.scope, id));
    const squash = (n) => n.getText(sf).replace(/\s+/g, '');

    const visit = (n) => {
        if (ts.isCallExpression(n)) {
            const callee = unwrap(n.expression);
            if (isExecuteMember(callee)) {
                out.push({ index: n.getStart(sf), label: `${squash(callee.expression)}.execute(` });
                // The receiver and the arguments may hold more uses; the callee member itself is consumed here.
                visit(callee.expression);
                if (ts.isElementAccessExpression(callee)) visit(callee.argumentExpression);
                n.arguments.forEach(visit);
                return;
            }
            if (ts.isIdentifier(callee) && boundAt(callee)) {
                out.push({ index: n.getStart(sf), label: `${callee.text}(` });
                n.arguments.forEach(visit);
                return;
            }
        } else if (isExecuteMember(n)) {
            out.push({ index: n.getStart(sf), label: 'a reference to .execute' });
        } else if (ts.isIdentifier(n) && !isNameSlot(n) && boundAt(n)) {
            out.push({ index: n.getStart(sf), label: `a reference to ${n.text}` });
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out.sort((x, y) => x.index - y.index);
}

/**
 * True when a function around `index` (the innermost first, then each outer one) CALLS one of `names`, as in
 * `const run = useFieldCommand();`. The word in a comment, a string, a type, or a property name does not count,
 * and a call in a function that does not enclose `index` does not either.
 * @param {string} text source with comments blanked, offsets preserved
 * @param {number} index offset of a call site, as returned by executeCallIndices
 * @param {string[]} names guard function names, e.g. ['useFieldCommand']
 */
export function guardCalledInEnclosingFunction(text, index, names) {
    const sf = parse(text);
    let node = sf;
    const descend = (n) => {
        for (const c of n.getChildren(sf)) {
            if (c.getStart(sf) <= index && index < c.end) { node = c; descend(c); return; }
        }
    };
    descend(sf);
    for (let fn = node; fn; fn = fn.parent) {
        if (!ts.isFunctionLike(fn) || !fn.body) continue;
        let found = false;
        const scan = (n) => {
            if (found) return;
            if (ts.isCallExpression(n)) {
                const callee = unwrap(n.expression);
                const id = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
                if (id && names.includes(id.text)) { found = true; return; }
            }
            ts.forEachChild(n, scan);
        };
        scan(fn.body);
        if (found) return true;
    }
    return false;
}

/**
 * Offsets of every unexcused `execute` use in `stripped` (comments blanked, offsets preserved).
 * @param {string} stripped source with comments blanked
 * @param {string[]} lines the original source lines, comments intact (the marker lives in a comment)
 * @returns {number[]}
 */
export function executeCallSites(stripped, lines) {
    const out = [];
    for (const { index } of executeCallIndices(stripped)) {
        const at = newlinesBefore(stripped, index);
        if (lines.slice(Math.max(0, at - 3), at + 1).some((l) => EXECUTE_ALLOW.test(l))) continue;
        out.push(index);
    }
    return out;
}
