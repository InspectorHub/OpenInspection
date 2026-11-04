/**
 * Reading helpers of the public-projection detector: peeling wrappers off an expression, the names a file declares once, and the
 * `const` initializer an identifier use refers to by lexical scope. Split out of public-projection-detect.mjs for its size.
 */
import ts from 'typescript';

export function unwrap(expr) {
    let e = expr;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)
        || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
    return e;
}

/** Names bound by a binding name (identifier or pattern). */
function boundNames(name, out) {
    if (ts.isIdentifier(name)) out.push(name.text);
    else for (const el of name.elements) if (ts.isBindingElement(el)) boundNames(el.name, out);
}

/** Names declared exactly once as `const x = <init>`, mapped to the initializer; plus functions declared once. */
export function collectDeclarations(sf) {
    const counts = new Map();
    const consts = new Map();
    const functions = new Map();
    const imports = new Map();
    const bump = (name, by = 1) => counts.set(name, (counts.get(name) ?? 0) + by);
    const visit = (node) => {
        if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) {
            const from = node.moduleSpecifier.text;
            const clause = node.importClause;
            if (clause.name) imports.set(clause.name.text, from);
            if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) imports.set(el.name.text, from);
        }
        if (ts.isVariableDeclaration(node)) {
            if (ts.isIdentifier(node.name)) {
                bump(node.name.text);
                const isConst = ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
                const init = node.initializer && unwrap(node.initializer);
                if (isConst && init) {
                    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) functions.set(node.name.text, init);
                    else consts.set(node.name.text, init);
                }
            } else {
                const names = [];
                boundNames(node.name, names);
                for (const n of names) bump(n, 2);
            }
        } else if (ts.isParameter(node)) {
            const names = [];
            boundNames(node.name, names);
            for (const n of names) bump(n, 2);
        } else if (ts.isFunctionDeclaration(node) && node.name) {
            bump(node.name.text);
            functions.set(node.name.text, node);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    const once = (m) => new Map([...m].filter(([name]) => counts.get(name) === 1));
    return { consts: once(consts), functions: once(functions), imports };
}

/** Names a parameter list binds. */
function parameterNames(fn) {
    const out = [];
    for (const p of fn.parameters ?? []) boundNames(p.name, out);
    return out;
}

/**
 * The initializer of the `const` that an identifier use refers to, by lexical scope: the nearest enclosing block that declares
 * the name wins; a parameter or a destructuring pattern of that name stops the search (not followed).
 */
export function resolveConst(ident) {
    const name = ident.text;
    for (let n = ident.parent; n; n = n.parent) {
        if (ts.isFunctionLike(n) && parameterNames(n).includes(name)) return undefined;
        const statements = ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) ? n.statements : ts.isCaseClause(n) ? n.statements : null;
        if (!statements) continue;
        let found;
        let hits = 0;
        for (const st of statements) {
            if (!ts.isVariableStatement(st)) continue;
            const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name)) {
                    if (d.name.text !== name) continue;
                    hits += 1;
                    found = isConst && d.initializer ? unwrap(d.initializer) : undefined;
                } else {
                    const names = [];
                    boundNames(d.name, names);
                    if (names.includes(name)) { hits += 1; found = undefined; }
                }
            }
        }
        if (hits > 0) return hits === 1 ? found : undefined;
    }
    return undefined;
}

/** Return expressions of a function-like (the body itself for an expression-bodied arrow). */
export function returnedExpressions(fn) {
    if (!fn.body) return [];
    if (!ts.isBlock(fn.body)) return [fn.body];
    const out = [];
    const visit = (node) => {
        if (ts.isFunctionLike(node) && node !== fn) return;
        if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
        ts.forEachChild(node, visit);
    };
    visit(fn.body);
    return out;
}
