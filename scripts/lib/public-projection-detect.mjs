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
 *  - unused-projection-allow: a marker that covers no finding on its line or the next.
 *
 * RESPONSE FORMS, with the context named by the handler's first parameter (not a fixed `c`):
 *    ctx.json(x) | sendSuccess(ctx, x) | respondRelativizedJson(ctx, x, tenantId) | Response.json(x) | new Response(JSON.stringify(x)) | ctx.body|text(JSON.stringify(x)).
 * For an object literal every property value is looked at at any depth, whatever its key (`data`, `error`, `meta`, ...), through nested
 * object literals and arrays of them (`data: { items: [{ id: row.id }] }`). A property copied under its own name (`id: row.id`) is a
 * field pick; a value taken whole (`item: row`), under another name (`item: row.inner`), spread, or held in a `let`, a destructured
 * binding or a parameter is reported.
 *
 * WHAT COUNTS AS BUILT FROM A FIELD LIST (conservative: anything not recognised is reported):
 *  - a literal, an object literal of explicit properties, an array of such, a template or arithmetic on them;
 *  - a bare call to `projectFields`, `projectReportForLink` or any function named
 *    `project<Something>` (the convention for a function that builds its result from a field list);
 *  - `<Name>Schema.parse(...)` / `.safeParse(...)` (a schema import or const, never `JSON`);
 *  - a primitive conversion: `String`, `Number`, `Boolean`, `parseInt`, `safeISODate`, `Object.keys`, `Math.*`, `Date.now`,
 *    `Array.isArray`, `.toISOString()`; `JSON.stringify(x)` only when `x` is built from a field list;
 *  - `.map(cb)` whose callback returns one of these; a call of a function declared once in the same file whose returns are all one of these;
 *  - a variable declared once as `const x = <one of the above>` (followed a few steps).
 * A name declared more than once, as a parameter, or through a destructuring pattern is never followed, and a `let` or a
 * property assigned after the declaration is not seen: the check reads the declaration, not the data flow.
 *
 * An intentional exception is a comment `// projection-allow: <reason>`. A trailing one (code before it on its line) covers findings that
 * START on its own line, however long the value is; a comment-only one covers findings that start on the NEXT line. Nothing else: not a later
 * line of the same call, not the line after a trailing marker, not past a blank line. Markers are read from comments, never from text inside
 * a string or template. The reason is mandatory (at least 10 characters), and a marker that covers no finding is reported (unused-projection-allow).
 *
 * Limits: a projector is trusted by name only when imported from a projection module (PROJECTION_MODULE) or not imported at all; a same-file
 * function is judged by what it returns. A schema `.parse(` counts unless the schema in the same file is `z.any()`, `.passthrough()` or loose.
 *
 * It does not prove a response safe: a field list can still name a column that should not be named. It finds the response with no list.
 */
import ts from 'typescript';
import { isContainerName } from './public-projection-containers.mjs';
import { collectDeclarations, resolveConst, returnedExpressions, unwrap } from './public-projection-scope.mjs';

export const MIN_REASON = 10;
const ALLOW_RE = /projection-allow:(.*)/;

const PROJECTORS = new Set(['projectFields', 'projectReportForLink']);
const PRIMITIVE_BARE = new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat', 'safeISODate', 'safeTimestamp', 'encodeURIComponent', 'decodeURIComponent']);
/** `Receiver.method` calls whose result is a primitive. */
const PRIMITIVE_QUALIFIED = new Set(['Object.keys', 'Date.now', 'Array.isArray', 'Number.isInteger', 'Number.isFinite']);
const PRIMITIVE_RECEIVERS = new Set(['Math']);
const PRIMITIVE_METHODS = new Set(['toISOString']);
const SCHEMA_PARSE = new Set(['parse', 'safeParse']);
/** Where a `project<Something>` function may be imported from for its name to be trusted: a module of the projection family. */
const PROJECTION_MODULE = /(^|\/)(response-projection|report-link-response|report-link-keys|[a-z0-9-]+-view)$/;
/** Operators whose result is a primitive: arithmetic, comparison and membership. The comma and assignment operators are not. */
const PRIMITIVE_OPERATORS = new Set([
    ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
    ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.InKeyword,
]);
/** Helpers that take the request context and something else and do not answer with it: they read the database, set or read a cookie, log or audit. */
const NON_RESPONSE_HELPERS = /^(getDrizzle|setCookie|getCookie|deleteCookie|logger|audit\w*|log[A-Z]\w*)$/;
const KNOWN_RESPONSE_HELPERS = new Set(['sendSuccess', 'sendError', 'respondRelativizedJson']);
const OPEN_SCHEMA = /\bz\.any\(|\.passthrough\(|\.loose\(|z\.looseObject\(|z\.unknown\(/;
/** By convention a function named `project<Something>` builds its result from a field list. */
const PROJECT_NAME = /^project[A-Z]\w*$/;
const MAX_DEPTH = 4;
const CONTEXT_METHODS = new Set(['json', 'body', 'text']);

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
    if (ts.isObjectLiteralExpression(e)) return e.properties.every((p) => isProjectedProperty(p, decl, depth + 1));
    if (ts.isArrayLiteralExpression(e)) return e.elements.every((el) => !ts.isSpreadElement(el) && isProjected(el, decl, depth + 1));
    if (ts.isConditionalExpression(e)) return isProjected(e.whenTrue, decl, depth + 1) && isProjected(e.whenFalse, decl, depth + 1);
    if (ts.isBinaryExpression(e)) {
        const op = e.operatorToken.kind;
        if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
            return isProjected(e.left, decl, depth + 1) && isProjected(e.right, decl, depth + 1);
        }
        return PRIMITIVE_OPERATORS.has(op);
    }
    if (ts.isCallExpression(e)) return isProjectedCall(e, decl, depth);
    if (ts.isPropertyAccessExpression(e)) return e.name.text === 'length';
    return false;
}

/** One property of an object literal reached as a value: a spread, a value or a shorthand name must itself be field-list built, or a field picked by name. */
function isProjectedProperty(p, decl, depth) {
    if (ts.isSpreadAssignment(p)) return isProjected(p.expression, decl, depth);
    if (ts.isShorthandPropertyAssignment(p)) return isProjected(p.name, decl, depth);
    if (!ts.isPropertyAssignment(p)) return false;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    return isProjected(p.initializer, decl, depth) || isFieldPick(p.initializer, key, decl);
}

function isProjectedCall(e, decl, depth) {
    const callee = unwrap(e.expression);
    if (ts.isIdentifier(callee)) {
        // A function declared in this file is judged by what it returns, whatever it is called.
        const fn = decl.functions.get(callee.text);
        if (fn) {
            const returns = returnedExpressions(fn);
            return returns.length > 0 && returns.every((r) => isProjected(r, decl, depth + 1));
        }
        if (PRIMITIVE_BARE.has(callee.text)) return true;
        if (PROJECTORS.has(callee.text) || PROJECT_NAME.test(callee.text)) {
            const from = decl.imports.get(callee.text);
            return from === undefined || PROJECTION_MODULE.test(from);
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
        if (SCHEMA_PARSE.has(method) && receiverName.endsWith('Schema')) {
            const declared = decl.consts.get(receiverName);
            return declared === undefined || !OPEN_SCHEMA.test(declared.getText());
        }
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

/**
 * Every `projection-allow:` marker in a file, read from the comments the TypeScript parser finds (so text inside a string or template
 * literal is never a marker), by 1-based line: `{ line, trailing, reason }`. `trailing` means code precedes the comment on its line.
 */
function readMarkers(sf, src) {
    const seen = new Map();
    const note = (ranges) => {
        for (const r of ranges ?? []) {
            if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia || seen.has(r.pos)) continue;
            const m = ALLOW_RE.exec(src.slice(r.pos, r.end));
            if (!m) continue;
            const line = sf.getLineAndCharacterOfPosition(r.pos).line + 1;
            const lineStart = sf.getPositionOfLineAndCharacter(line - 1, 0);
            seen.set(r.pos, { line, trailing: src.slice(lineStart, r.pos).trim() !== '', reason: m[1].trim() });
        }
    };
    const walk = (node) => {
        note(ts.getLeadingCommentRanges(src, node.getFullStart()));
        note(ts.getTrailingCommentRanges(src, node.getEnd()));
        for (const child of node.getChildren(sf)) walk(child);
    };
    walk(sf);
    return [...seen.values()];
}

/**
 * The marker that covers a finding starting on a given line (1-based). A trailing marker covers findings that START on its own line (a
 * value that starts there is covered however many lines it runs over); a comment-only marker covers findings that start on the NEXT line.
 * Nothing else is covered: not a later line of the same call, and not the line after a trailing marker or after a blank line.
 */
function markerFor(markers, line) {
    const own = markers.find((m) => m.trailing && m.line === line);
    if (own) return { present: true, at: own.line, reason: own.reason };
    const above = markers.find((m) => !m.trailing && m.line === line - 1);
    return above ? { present: true, at: above.line, reason: above.reason } : { present: false, at: 0, reason: '' };
}

/** The values of one object literal that must be field-list built: every property value and spread, with the key each sits under. */
function literalParts(e, labelPrefix) {
    const parts = [];
    const nested = labelPrefix !== '';
    for (const p of e.properties) {
        if (ts.isSpreadAssignment(p)) parts.push({ label: `${labelPrefix}spread`, key: null, nested, expr: p.expression });
        else if (ts.isPropertyAssignment(p)) parts.push({ label: `${labelPrefix}${p.name.getText()}`, key: ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null, nested, expr: p.initializer });
        else if (ts.isShorthandPropertyAssignment(p)) parts.push({ label: `${labelPrefix}${p.name.text}`, key: null, nested, expr: p.name });
    }
    return parts;
}

/** Every leaf value of a response literal, at any depth: object literals and arrays of them are entered, everything else is a leaf. */
function collectParts(e, prefix, out) {
    for (const part of literalParts(e, prefix)) {
        const inner = unwrap(part.expr);
        if (ts.isObjectLiteralExpression(inner)) {
            collectParts(inner, `${part.label}.`, out);
        } else if (ts.isArrayLiteralExpression(inner)) {
            for (const el of inner.elements) {
                const item = ts.isSpreadElement(el) ? el.expression : unwrap(el);
                if (!ts.isSpreadElement(el) && ts.isObjectLiteralExpression(item)) collectParts(item, `${part.label}[].`, out);
                else out.push({ label: `${part.label}[]`, key: null, nested: true, expr: item });
            }
        } else {
            out.push(part);
        }
    }
}

/**
 * A property copied under its own name (`id: row.id`, `name: row.name ?? null`) is a field being picked by name, which is what a field
 * list is. It counts only for a property nested inside a literal (never a top-level key of the response, such as `data: r.data`), and only
 * when the receiver is a plain identifier: not a call, an await, a parenthesised expression or another property access, and the member is
 * not one of the container names above (nor ends in Row, Rows, Data or List), unless it is `.length`. A property taken
 * under another name (`item: row.inner`) or a whole value (`item: row`) is not a pick.
 */
function isFieldPick(expr, key, decl) {
    if (key === null) return false;
    const e = unwrap(expr);
    if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
        return isFieldPick(e.left, key, decl) && isProjected(e.right, decl, 1);
    }
    if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.expression) || e.name.text !== key) return false;
    return !isContainerName(key);
}

/** The values of one response argument that must be field-list built, at any depth of the literal. */
function checkedParts(arg) {
    const e = unwrap(arg);
    if (!ts.isObjectLiteralExpression(e)) return [{ label: 'response', key: null, nested: false, expr: e }];
    const parts = [];
    collectParts(e, '', parts);
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
            if ((method === 'body' || method === 'text' || method === 'html' || method === 'newResponse') && first && ts.isCallExpression(first) && first.expression.getText() === 'JSON.stringify' && first.arguments.length > 0) return { content: [first.arguments[0]] };
            return { content: [] };
        }
    }
    if (ts.isIdentifier(callee) && (callee.text === 'sendSuccess' || callee.text === 'respondRelativizedJson') && node.arguments.length >= 2 && ts.isIdentifier(node.arguments[0]) && contexts.has(node.arguments[0].text)) {
        return { content: [node.arguments[1]] };
    }
    return null;
}

/** True when the call's value is what the enclosing function returns: `return f(c, x)`, `return await f(c, x)` or an expression-bodied arrow. */
function isReturned(node) {
    let n = node;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAwaitExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isNonNullExpression(n.parent))) n = n.parent;
    return n.parent !== undefined && (ts.isReturnStatement(n.parent) || (ts.isArrowFunction(n.parent) && n.parent.body === n));
}

/**
 * A call that hands the request context and at least one more value to a function that is neither a known response form nor declared in
 * this file, and whose value the handler returns: what such a function answers with is not looked into here. Helpers that only read or
 * write the request (not answer it) are listed in NON_RESPONSE_HELPERS. A helper whose value is stored first and returned later is not seen.
 * Returns the helper's name, or null.
 */
function unknownResponseHelper(node, contexts, decl) {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.arguments.length < 2) return null;
    const name = node.expression.text;
    const first = node.arguments[0];
    if (!ts.isIdentifier(first) || !contexts.has(first.text) || KNOWN_RESPONSE_HELPERS.has(name) || decl.functions.has(name)) return null;
    // A projection of a value whose name happens to be a function's first parameter is not a response.
    if (PROJECTORS.has(name) || PROJECT_NAME.test(name) || PRIMITIVE_BARE.has(name)) return null;
    return NON_RESPONSE_HELPERS.test(name) || !isReturned(node) ? null : name;
}

export function detectPublicProjection(src, path = 'route.ts') {
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const decl = collectDeclarations(sf);
    const violations = [];
    let sites = 0;
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const markers = readMarkers(sf, src);
    const used = new Set();
    // A marker anywhere in the file needs a real reason, whether or not a finding sits under it.
    for (const m of markers) {
        if (m.reason.length < MIN_REASON) violations.push({ line: m.line, rule: 'allow-without-reason', message: `projection-allow needs a reason of at least ${MIN_REASON} characters` });
    }
    // The handler's context is its first parameter; `c` and `ctx` stay recognised for helpers that take it by those names.
    const visit = (node, contexts) => {
        let here = contexts;
        if (ts.isFunctionLike(node) && node.parameters && node.parameters.length > 0 && ts.isIdentifier(node.parameters[0].name)) {
            here = new Set([...contexts, node.parameters[0].name.text]);
        }
        const helper = unknownResponseHelper(node, here, decl);
        const helperMarker = helper ? markerFor(markers, lineOf(node)) : null;
        if (helperMarker?.present) used.add(helperMarker.at);
        if (helper && !helperMarker?.present) {
            violations.push({ line: lineOf(node), rule: 'unknown-response-helper', message: `${helper} receives the request context and a value, and its response is not looked into` });
        }
        const site = responseSite(node, here);
        if (site) {
            sites += 1;
            for (const arg of site.content) {
                for (const part of checkedParts(arg)) {
                    // A pick by name is a field list only inside a literal: the top-level keys of the response are not picks.
                    if (isProjected(part.expr, decl, 0) || (part.nested && isFieldPick(part.expr, part.key, decl))) continue;
                    const marker = markerFor(markers, lineOf(part.expr));
                    if (marker.present) { used.add(marker.at); continue; }
                    const what = part.label === 'response' ? 'this response' : `the ${part.label} of this response`;
                    violations.push({ line: lineOf(part.expr), rule: 'unprojected-response', message: `${what} is not built from a field list: ${part.expr.getText(sf).slice(0, 60)}` });
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, here));
    };
    visit(sf, new Set(['c', 'ctx']));
    // A marker that excuses nothing is a claim with nothing under it, and would excuse a later change on its line.
    for (const m of markers) {
        if (!used.has(m.line) && m.reason.length >= MIN_REASON) {
            violations.push({ line: m.line, rule: 'unused-projection-allow', message: 'this projection-allow covers no finding that starts on its own line (trailing) or on the next line (comment-only); remove it or move it to the line it excuses' });
        }
    }
    return { sites, violations };
}
