/**
 * Reads how a router registers its routes, in either of the two ways a router is written:
 *
 *   chain       const r = createApiRouter().openapi(a, h).route('/x', child);
 *   statements  const r = createApiRouter(); r.openapi(a, h); r.route('/x', child);
 *
 * Used by `scripts/check-agent-terms-classification.mjs`. The statement form leaves the initializer chain
 * EMPTY, so a reader that only walks initializers sees a router with no routes and passes over nothing;
 * `readStatementRegistrations` is the half that closes that. Neither half drops what it cannot follow: an inline
 * `createRoute(...)` as the first argument lands in `chain.inline`, and a registration made inside a function,
 * a branch or an assignment lands in `chain.nested`, so the caller can fail on them instead of counting zero.
 *
 * A router entry is `{ openapi: string[], mounts: { prefix, ident }[], inline: string[], nested: string[] }`.
 * Plain `.get()` / `.post()` handlers are not read in either form.
 */

/**
 * Records one `.openapi(…)` / `.route(…)` link into a router entry. A zod schema's `.openapi('Name')` takes a
 * STRING and is deliberately not matched.
 */
export function recordLink(ts, chain, member, call, literalString) {
    if (member === 'openapi' && call.arguments.length) {
        const first = call.arguments[0];
        if (ts.isIdentifier(first)) chain.openapi.push(first.text);
        else if (!ts.isStringLiteral(first) && !ts.isNoSubstitutionTemplateLiteral(first)) chain.inline.push(first.getText().slice(0, 40));
    }
    if (member === 'route' && call.arguments.length >= 2) {
        const prefix = literalString(call.arguments[0]);
        const ident = ts.isIdentifier(call.arguments[1]) ? call.arguments[1].text : null;
        if (prefix !== null && ident) chain.mounts.push({ prefix, ident });
    }
}

/**
 * `app.openapi(x, …);` / `app.route('/', y);` on a router declared above, added to that router's entry in the
 * order written. Only the OUTERMOST call of a chain is read (its receivers are the same links seen again).
 */
export function readStatementRegistrations(ts, sf, routers, walk, literalString) {
    walk(sf, (node) => {
        if (!ts.isCallExpression(node)) return;
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node
            && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) return;
        const links = [];
        let cursor = node;
        while (ts.isCallExpression(cursor) && ts.isPropertyAccessExpression(cursor.expression)) {
            links.unshift({ member: cursor.expression.name.text, call: cursor });
            cursor = cursor.expression.expression;
        }
        const chain = ts.isIdentifier(cursor) ? routers.get(cursor.text) : undefined;
        const registers = links.filter((l) => l.member === 'openapi' || l.member === 'route');
        if (!chain || registers.length === 0) return;
        if (!(ts.isExpressionStatement(parent) && parent.parent === sf)) {
            for (const l of registers) chain.nested.push(`${cursor.text}.${l.member}(`);
            return;
        }
        for (const l of links) recordLink(ts, chain, l.member, l.call, literalString);
    });
}
