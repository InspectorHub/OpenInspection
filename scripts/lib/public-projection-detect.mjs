/**
 * Detector for lint:public-projection.
 *
 * A route a person reaches without signing in answers with a response built from a LIST OF FIELDS (see
 * server/lib/response-projection.ts), not with a row or a service result. This detector reads the TypeScript AST of a
 * route module and reports each response whose content is not visibly built that way:
 *
 *  - unprojected-response: a value of the response (the `data`, any other property, a spread, or the whole argument)
 *    is a bare variable, a property of one, or the result of a call that is not a known projection.
 *  - allow-without-reason: a `projection-allow:` marker with no reason, or a short one.
 *
 * RESPONSE FORMS, with the context named by the handler's first parameter (not a fixed `c`):
 *    ctx.json(x) | sendSuccess(ctx, x) | Response.json(x) | new Response(JSON.stringify(x)) | ctx.body|text(JSON.stringify(x)).
 * For an object literal every property value is looked at, whatever its key (`data`, `error`, `meta`, ...), and so is every
 * property of an object literal that is the value of one (`data: { request: row }`).
 *
 * WHAT COUNTS AS BUILT FROM A FIELD LIST (conservative: anything not recognised is reported):
 *  - a literal, an object literal of explicit properties, an array of such, a template or arithmetic on them;
 *  - a bare call to `projectFields`, `projectReportForLink`, `finishReportLink`, `relativizeReportKeys` or any function named
 *    `project<Something>` (the convention for a function that builds its result from a field list);
 *  - `<Name>Schema.parse(...)` / `.safeParse(...)` (a schema import or const, never `JSON`);
 *  - a primitive conversion: `String`, `Number`, `Boolean`, `parseInt`, `safeISODate`, `Object.keys`, `Math.*`, `Date.now`,
 *    `Array.isArray`, `.toISOString()`; `JSON.stringify(x)` only when `x` is built from a field list;
 *  - `.map(cb)` whose callback returns one of these;
 *  - a call of a function declared once in the same file whose returned expressions are all one of these;
 *  - a variable declared once as `const x = <one of the above>` (followed a few steps).
 * A name declared more than once, as a parameter, or through a destructuring pattern is never followed, and a `let` or a
 * property assigned after the declaration is not seen: the check reads the declaration, not the data flow.
 *
 * An intentional exception is a comment `// projection-allow: <reason>` on the line above the statement (the statement
 * ends at the nearest enclosing function body, so one comment cannot cover a chain of handlers). The reason is mandatory
 * (at least 10 characters) and exempts only that statement.
 *
 * It does not prove a response safe: a field list can still name a column that should not be named, and the values of a
 * object literal two levels down are not looked into. It finds the response that has no list at all.
 */
import ts from 'typescript';

export const MIN_REASON = 10;
const ALLOW_RE = /projection-allow:(.*)/;

const PROJECTORS = new Set(['projectFields', 'projectReportForLink', 'finishReportLink', 'relativizeReportKeys']);
const PRIMITIVE_BARE = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'safeISODate', 'safeTimestamp', 'encodeURIComponent', 'decodeURIComponent']);
/** `Receiver.method` calls whose result is a primitive. */
const PRIMITIVE_QUALIFIED = new Set(['Object.keys', 'Date.now', 'Array.isArray', 'Number.isInteger', 'Number.isFinite']);
const PRIMITIVE_RECEIVERS = new Set(['Math']);
const PRIMITIVE_METHODS = new Set(['toISOString']);
const SCHEMA_PARSE = new Set(['parse', 'safeParse']);
/** By convention a function named `project<Something>` builds its result from a field list. */
const PROJECT_NAME = /^project[A-Z]\w*$/;
const MAX_DEPTH = 4;
const CONTEXT_METHODS = new Set(['json', 'body', 'text']);

function unwrap(expr) {
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
function collectDeclarations(sf) {
    const counts = new Map();
    const consts = new Map();
    const functions = new Map();
    const bump = (name, by = 1) => counts.set(name, (counts.get(name) ?? 0) + by);
    const visit = (node) => {
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
    return { consts: once(consts), functions: once(functions) };
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
function resolveConst(ident) {
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
function returnedExpressions(fn) {
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

/**
 * A value one level inside a response literal (`data: { request: row }`) that is a row or a service result: a call, an awaited
 * value, or a variable declared once from one, in each case not visibly projected. A property of something (`row.id`) or a bare
 * parameter is a field being picked and is not reported here.
 */
function isRowLike(expr, decl) {
    const e = unwrap(expr);
    if (ts.isAwaitExpression(expr) || ts.isCallExpression(e)) return !isProjected(e, decl, 0);
    if (ts.isIdentifier(e)) {
        const init = resolveConst(e);
        if (init === undefined) return false;
        const inner = unwrap(init);
        return (ts.isCallExpression(inner) || ts.isAwaitExpression(init)) && !isProjected(inner, decl, 0);
    }
    return false;
}

/** True when the expression is visibly built from a field list (or is a primitive). */
function isProjected(expr, decl, depth) {
    if (depth > MAX_DEPTH) return false;
    const e = unwrap(expr);
    if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e)
        || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword
        || ts.isPrefixUnaryExpression(e) || ts.isTypeOfExpression(e) || ts.isVoidExpression(e)) return true;
    if (ts.isIdentifier(e)) {
        if (e.text === 'undefined') return true;
        const init = resolveConst(e);
        return init !== undefined && isProjected(init, decl, depth + 1);
    }
    if (ts.isObjectLiteralExpression(e)) {
        return e.properties.every((p) => !ts.isSpreadAssignment(p) || isProjected(p.expression, decl, depth + 1));
    }
    if (ts.isArrayLiteralExpression(e)) return e.elements.every((el) => !ts.isSpreadElement(el) && isProjected(el, decl, depth + 1));
    if (ts.isConditionalExpression(e)) return isProjected(e.whenTrue, decl, depth + 1) && isProjected(e.whenFalse, decl, depth + 1);
    if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind;
        if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
            return isProjected(e.left, decl, depth + 1) && isProjected(e.right, decl, depth + 1);
        }
        return op !== ts.SyntaxKind.EqualsToken;
    }
    if (ts.isCallExpression(e)) return isProjectedCall(e, decl, depth);
    if (ts.isPropertyAccessExpression(e)) return e.name.text === 'length';
    return false;
}

function isProjectedCall(e, decl, depth) {
    const callee = unwrap(e.expression);
    if (ts.isIdentifier(callee)) {
        if (PROJECTORS.has(callee.text) || PROJECT_NAME.test(callee.text) || PRIMITIVE_BARE.has(callee.text)) return true;
        const fn = decl.functions.get(callee.text);
        if (fn) {
            const returns = returnedExpressions(fn);
            return returns.length > 0 && returns.every((r) => isProjected(r, decl, depth + 1));
        }
        return false;
    }
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const method = callee.name.text;
    const receiver = unwrap(callee.expression);
    const receiverName = ts.isIdentifier(receiver) ? receiver.text : null;
    if (receiverName !== null) {
        if (PRIMITIVE_QUALIFIED.has(`${receiverName}.${method}`) || PRIMITIVE_RECEIVERS.has(receiverName)) return true;
        if (receiverName === 'JSON' && method === 'stringify') return e.arguments.length > 0 && isProjected(e.arguments[0], decl, depth + 1);
        if (SCHEMA_PARSE.has(method) && receiverName.endsWith('Schema')) return true;
    }
    if (PRIMITIVE_METHODS.has(method)) return true;
    if (method === 'map' && e.arguments.length > 0) {
        const cb = unwrap(e.arguments[0]);
        if (ts.isIdentifier(cb) && PROJECT_NAME.test(cb.text)) return true;
        if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
            const returns = returnedExpressions(cb);
            return returns.length > 0 && returns.every((r) => isProjected(r, decl, depth + 1));
        }
    }
    return false;
}

function leadingText(src, node) {
    const ranges = ts.getLeadingCommentRanges(src, node.getFullStart()) ?? [];
    return ranges.map((r) => src.slice(r.pos, r.end)).join('\n');
}

/** The `projection-allow:` marker on the statement holding `node` (up to the enclosing function body), or on the line above it. */
function allowComment(src, sf, node) {
    let stmt = node;
    while (stmt.parent && !ts.isBlock(stmt.parent) && !ts.isSourceFile(stmt.parent) && !ts.isCaseClause(stmt.parent) && !ts.isFunctionLike(stmt.parent)) stmt = stmt.parent;
    const lines = src.split('\n');
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const above = line > 0 ? lines[line - 1].trim() : '';
    const same = lines[line].includes('//') ? lines[line].slice(lines[line].indexOf('//')) : '';
    const text = `${leadingText(src, stmt)}\n${above.startsWith('//') ? above : ''}\n${same}`;
    const m = ALLOW_RE.exec(text);
    return m ? { present: true, reason: m[1].trim() } : { present: false, reason: '' };
}

/** The values of one object literal that must be field-list built: every property value and spread. */
function literalParts(e, labelPrefix) {
    const parts = [];
    for (const p of e.properties) {
        if (ts.isSpreadAssignment(p)) parts.push({ label: `${labelPrefix}spread`, expr: p.expression });
        else if (ts.isPropertyAssignment(p)) parts.push({ label: `${labelPrefix}${p.name.getText()}`, expr: p.initializer });
        else if (ts.isShorthandPropertyAssignment(p)) parts.push({ label: `${labelPrefix}${p.name.text}`, expr: p.name });
    }
    return parts;
}

/**
 * The values of one response argument that must be field-list built: every property of the response literal and, one level
 * down, every property of an object literal that is the value of one (`data: { request: row }`).
 */
function checkedParts(arg) {
    const e = unwrap(arg);
    if (!ts.isObjectLiteralExpression(e)) return [{ label: 'response', expr: e }];
    const parts = [];
    for (const part of literalParts(e, '')) {
        const inner = unwrap(part.expr);
        if (ts.isObjectLiteralExpression(inner)) parts.push(...literalParts(inner, `${part.label}.`).map((p) => ({ ...p, nested: true })));
        else parts.push(part);
    }
    return parts;
}

/** The response-producing call shape of `node` as { kind, args } where args are the expressions that carry content, or null. */
function responseSite(node, contexts) {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Response') {
        const first = node.arguments?.[0] && unwrap(node.arguments[0]);
        if (first && ts.isCallExpression(first) && first.expression.getText() === 'JSON.stringify' && first.arguments.length > 0) return { content: [first.arguments[0]] };
        return { content: [] };
    }
    if (!ts.isCallExpression(node)) return null;
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        const receiver = callee.expression.text;
        const method = callee.name.text;
        if (receiver === 'Response' && method === 'json' && node.arguments.length > 0) return { content: [node.arguments[0]] };
        if (contexts.has(receiver) && (CONTEXT_METHODS.has(method) || method === 'redirect' || method === 'html' || method === 'newResponse')) {
            if (method === 'json' && node.arguments.length > 0) return { content: [node.arguments[0]] };
            const first = node.arguments[0] && unwrap(node.arguments[0]);
            if ((method === 'body' || method === 'text') && first && ts.isCallExpression(first) && first.expression.getText() === 'JSON.stringify' && first.arguments.length > 0) return { content: [first.arguments[0]] };
            return { content: [] };
        }
    }
    if (ts.isIdentifier(callee) && callee.text === 'sendSuccess' && node.arguments.length >= 2 && ts.isIdentifier(node.arguments[0]) && contexts.has(node.arguments[0].text)) {
        return { content: [node.arguments[1]] };
    }
    return null;
}

export function detectPublicProjection(src, path = 'route.ts') {
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const decl = collectDeclarations(sf);
    const violations = [];
    let sites = 0;
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    // The handler's context is its first parameter; `c` and `ctx` stay recognised for helpers that take it by those names.
    const visit = (node, contexts) => {
        let here = contexts;
        if (ts.isFunctionLike(node) && node.parameters && node.parameters.length > 0 && ts.isIdentifier(node.parameters[0].name)) {
            here = new Set([...contexts, node.parameters[0].name.text]);
        }
        const site = responseSite(node, here);
        if (site) {
            sites += 1;
            const allow = allowComment(src, sf, node);
            if (allow.present && allow.reason.length < MIN_REASON) {
                violations.push({ line: lineOf(node), rule: 'allow-without-reason', message: `projection-allow needs a reason of at least ${MIN_REASON} characters` });
            } else if (!allow.present) {
                for (const arg of site.content) {
                    for (const part of checkedParts(arg)) {
                        if (part.nested ? isRowLike(part.expr, decl) : !isProjected(part.expr, decl, 0)) {
                            const what = part.label === 'response' ? 'this response' : `the ${part.label} of this response`;
                            violations.push({ line: lineOf(part.expr), rule: 'unprojected-response', message: `${what} is not built from a field list: ${part.expr.getText(sf).slice(0, 60)}` });
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, here));
    };
    visit(sf, new Set(['c', 'ctx']));
    return { sites, violations };
}
