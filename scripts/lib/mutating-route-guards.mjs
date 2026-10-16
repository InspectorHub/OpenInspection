/**
 * Reading mutating routes and their guards out of server/api source.
 *
 * The question this module answers: which POST / PUT / PATCH / DELETE routes does
 * a file register with NO guard on who may call them? The existing checks cannot
 * see that. `check-capability-declarations.mjs` and `authorization-surface.spec.ts`
 * compare only routes that already declare a capability, and `api-default-deny.spec.ts`
 * covers anonymous access. A new write route that forgets every role or capability
 * guard is open to every authenticated user, agents and office staff included, and
 * nothing else would say so.
 *
 * Two registration styles are in use and both are read:
 *   (a) `createRoute({ method, path, middleware: [...] })`, usually wrapped in
 *       `withMcpMetadata(...)`, mounted with `.openapi(route, handler)`;
 *   (b) plain Hono: `.post('/x', guard, handler)`, `.put`, `.patch`, `.delete`,
 *       and `.on(method, path, ...)`.
 * A router-level `router.use('*', guard)` (or `.use('/p/*', guard)`) covers the routes
 * registered after it in the same file whose path it matches.
 *
 * GUARDS. The list is explicit, derived by grepping `middleware: [...]` and `.use(`
 * across server/api (2026-10). Each name is here for a stated reason; a name that
 * is not here is not a guard, which is the safe direction to be wrong in.
 *
 *  PRINCIPAL guards decide WHO may call. A route needs at least one:
 *    requireRole          role gate (372 uses)
 *    requireCapability    capability gate layered on a role gate
 *    portalSessionGuard   the client portal's session (token track): no session, no entry
 *    requireCsrfToken     browser form posts that carry the session-bound CSRF token
 *    webhookIngressGuard  signature/ingress check for provider webhooks
 *    requireServiceBinding  the portal-to-core `x-portal-m2m` HMAC (server/portal/service-binding-guard.ts)
 *  NARROWING guards only remove callers from a set a principal guard already admitted.
 *  They are recognised so that a route carrying them is not mistaken for a bare one,
 *  but alone they do not make a route guarded (denyStaff alone still admits agents):
 *    denyStaff, guardPatchReschedule, guardScheduleMove, guardInspectionDelete,
 *    guardSendReport, guardReportLink, guardSendSms, guardMessageSend, guardLinkExpiry,
 *    guardStaffConfirm, guardStaffUncancel, requireSeatAvailable,
 *    refuseStatutorySnapshotEdit, refuseStatutoryTemplateEdit
 *
 * A guard may sit behind a local alias (`const OWN = requireRole(...)`): identifiers
 * in a middleware list are resolved one file-local `const` deep.
 *
 * The scanner is textual and says what it cannot read: a route whose method or path
 * is not a literal is returned with `path: '<dynamic>'` rather than dropped.
 */
import { stripComments } from './route-source.mjs';

export const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

export const PRINCIPAL_GUARDS = [
    'requireRole', 'requireCapability', 'portalSessionGuard', 'requireCsrfToken', 'webhookIngressGuard', 'requireServiceBinding',
];

export const NARROWING_GUARDS = [
    'denyStaff', 'guardPatchReschedule', 'guardScheduleMove', 'guardInspectionDelete', 'guardSendReport',
    'guardReportLink', 'guardSendSms', 'guardMessageSend', 'guardLinkExpiry', 'guardStaffConfirm',
    'guardStaffUncancel', 'requireSeatAvailable', 'refuseStatutorySnapshotEdit', 'refuseStatutoryTemplateEdit',
];

const ALL_GUARDS = [...PRINCIPAL_GUARDS, ...NARROWING_GUARDS];

// ── low-level text helpers ──────────────────────────────────────────────────

function skipQuoted(src, i) {
    const q = src[i];
    let j = i + 1;
    while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) return j + 1;
        if (q !== '`' && src[j] === '\n') return j;
        j++;
    }
    return src.length;
}

/** Index of the bracket closing the one at `open`, skipping strings; -1 if unbalanced. */
export function matchClose(src, open) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === '`') { i = skipQuoted(src, i) - 1; continue; }
        if (pairs[c]) stack.push(pairs[c]);
        else if (c === ')' || c === ']' || c === '}') {
            if (stack.pop() !== c) return -1;
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

/** Split `text` on commas that sit at bracket depth 0, outside strings. Empty trailing parts are dropped. */
export function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === '`') { i = skipQuoted(text, i) - 1; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

const stringLiteral = (text) => {
    const m = /^(['"`])([\s\S]*)\1$/.exec(text.trim());
    return m && !(m[1] === '`' && m[2].includes('${')) ? m[2] : null;
};

/** The guards named in `text`, after resolving file-local `const` aliases up to two levels deep. */
function guardsIn(text, consts, depth = 0) {
    const found = new Set();
    for (const g of ALL_GUARDS) if (new RegExp(`\\b${g}\\b`).test(text)) found.add(g);
    if (depth < 2) {
        for (const id of text.match(/\b[A-Za-z_]\w*\b/g) ?? []) {
            const init = consts.get(id);
            if (init) for (const g of guardsIn(init, consts, depth + 1)) found.add(g);
        }
    }
    return [...found];
}

/** `const NAME = <initialiser>;` at any depth: name -> initialiser text. */
function collectConsts(src) {
    const consts = new Map();
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*(?::[^=;]+)?=\s*/g)) {
        let i = m.index + m[0].length;
        const start = i;
        let depth = 0;
        for (; i < src.length; i++) {
            const c = src[i];
            if (c === '"' || c === "'" || c === '`') { i = skipQuoted(src, i) - 1; continue; }
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
            else if (c === ';' && depth === 0) break;
            else if (c === '\n' && depth === 0 && /^\s*(const|export|function|let|type|interface)\b/.test(src.slice(i + 1, i + 40))) break;
        }
        if (!consts.has(m[1])) consts.set(m[1], src.slice(start, i));
    }
    return consts;
}

// A guard invoked inside the handler: `await requireRole('agent')(c, async () => {})`.
// The scanner cannot prove it runs unconditionally; it only recognises the idiom.
const INLINE_GUARD = /\b(requireRole|requireCapability)\s*\([^)]*\)\s*\(\s*c\b/;

const inlineGuards = (handlerText) => (handlerText && INLINE_GUARD.test(handlerText) ? [INLINE_GUARD.exec(handlerText)[1]] : []);

/** Every `.openapi(ident, handler)`: ident -> { handler source, where it is registered }. */
function handlersByRouteConst(src) {
    const map = new Map();
    for (const m of src.matchAll(/\.\s*openapi\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const args = splitTopLevel(src.slice(open + 1, close));
        if (/^[A-Za-z_]\w*$/.test(args[0] ?? '')) map.set(args[0], { handler: args.slice(1).join(','), index: m.index });
    }
    return map;
}

// ── route readers ───────────────────────────────────────────────────────────

/** Value text of top-level property `key` in an object literal body, or null. */
function objectProp(objectText, key) {
    for (const part of splitTopLevel(objectText.slice(1, -1))) {
        const m = new RegExp(`^${key}\\s*:\\s*([\\s\\S]*)$`).exec(part);
        if (m) return m[1];
    }
    return null;
}

/** A route object given as `{...}`, `withMcpMetadata({...}, meta)` or `createRoute(...)` of either; null if it is none of them. */
function routeObjectText(arg) {
    let inner = arg.trim();
    for (let i = 0; i < 3; i++) {
        const m = /^(withMcpMetadata|createRoute)\s*\(/.exec(inner);
        if (!m) break;
        const open = m[0].length - 1;
        const close = matchClose(inner, open);
        if (close < 0) return null;
        // withMcpMetadata({ ...route }, { scopes, tier }) : the route is its first argument.
        inner = (m[1] === 'withMcpMetadata' ? splitTopLevel(inner.slice(open + 1, close))[0] : inner.slice(open + 1, close)) ?? '';
        inner = inner.trim();
    }
    return inner.startsWith('{') ? inner : null;
}

function routeFromObject(inner, src, index, consts, style) {
    const methodText = objectProp(inner, 'method');
    const method = methodText ? stringLiteral(methodText) : null;
    if (!method || !MUTATING_METHODS.has(method.toLowerCase())) return null;
    const pathText = objectProp(inner, 'path');
    const middleware = objectProp(inner, 'middleware');
    return {
        method: method.toUpperCase(),
        path: (pathText && stringLiteral(pathText)) ?? '<dynamic>',
        line: lineOf(src, index),
        index,
        style,
        guards: middleware ? guardsIn(middleware, consts) : [],
    };
}

function readCreateRoutes(src, consts) {
    const routes = [];
    const handlers = handlersByRouteConst(src);
    for (const m of src.matchAll(/\bcreateRoute\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const inner = routeObjectText(src.slice(open + 1, close));
        const route = inner && routeFromObject(inner, src, m.index, consts, 'createRoute');
        if (!route) continue;
        const name = /(?:const|let)\s+([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*$/.exec(src.slice(Math.max(0, m.index - 80), m.index))?.[1];
        const mounted = name ? handlers.get(name) : undefined;
        route.guards.push(...inlineGuards(mounted?.handler));
        // Hono runs middleware in registration order, so what matters is where the route is MOUNTED, not where its definition sits.
        if (mounted) route.index = mounted.index;
        routes.push(route);
    }
    // `.openapi({ ... }, handler)` and `.openapi(withMcpMetadata({ ... }, meta), handler)` with no createRoute around them.
    for (const m of src.matchAll(/\.\s*openapi\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const first = splitTopLevel(src.slice(open + 1, close))[0] ?? '';
        if (/^createRoute\s*\(/.test(first.trim())) continue; // read above
        const inner = routeObjectText(first);
        const route = inner && routeFromObject(inner, src, m.index, consts, 'openapi');
        if (!route) continue;
        route.guards.push(...inlineGuards(splitTopLevel(src.slice(open + 1, close)).slice(1).join(',')));
        routes.push(route);
    }
    return routes;
}

function readChainedRoutes(src, consts) {
    const routes = [];
    for (const m of src.matchAll(/\.\s*(post|put|patch|delete)\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const args = splitTopLevel(src.slice(open + 1, close));
        const path = args[0] ? stringLiteral(args[0]) : null;
        // A route registration has a literal path first. `.delete(id)` on a Map or a service is not one.
        if (path === null || !/^[/*]/.test(path)) continue;
        routes.push({
            method: m[1].toUpperCase(), path, line: lineOf(src, m.index), index: m.index, style: 'chained',
            // Everything between the path and the handler (the last argument) is middleware.
            guards: [...guardsIn(args.slice(1, -1).join(','), consts), ...inlineGuards(args[args.length - 1])],
        });
    }
    for (const m of src.matchAll(/\.\s*on\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const args = splitTopLevel(src.slice(open + 1, close));
        const methods = (args[0]?.match(/['"]\w+['"]/g) ?? []).map((x) => x.slice(1, -1).toLowerCase());
        const path = args[1] ? stringLiteral(args[1]) : null;
        if (path === null || !/^[/*]/.test(path)) continue;
        for (const method of methods.filter((x) => MUTATING_METHODS.has(x))) {
            routes.push({
                method: method.toUpperCase(), path, line: lineOf(src, m.index), index: m.index, style: 'on',
                guards: guardsIn(args.slice(2, -1).join(','), consts),
            });
        }
    }
    return routes;
}

function readUses(src, consts) {
    const uses = [];
    for (const m of src.matchAll(/\.\s*use\s*\(/g)) {
        const open = m.index + m[0].length - 1;
        const close = matchClose(src, open);
        if (close < 0) continue;
        const args = splitTopLevel(src.slice(open + 1, close));
        const first = args[0] ? stringLiteral(args[0]) : null;
        const path = first ?? '*';
        const rest = first === null ? args : args.slice(1);
        const guards = guardsIn(rest.join(','), consts);
        if (guards.length > 0) uses.push({ path, index: m.index, guards });
    }
    return uses;
}

/** Does a router-level `.use(usePath, ...)` apply to a route at `routePath`? Hono prefix semantics, `:param` as wildcard. */
export function useCovers(usePath, routePath) {
    if (usePath === '*' || usePath === '/*') return true;
    const prefix = usePath.endsWith('/*') ? usePath.slice(0, -2) : null;
    const seg = (p) => p.split('/').filter(Boolean);
    const segMatch = (a, b) => a === b || a.startsWith(':') || b.startsWith(':');
    if (prefix !== null) {
        const pre = seg(prefix);
        const target = seg(routePath);
        return pre.every((s, i) => i < target.length && segMatch(s, target[i]));
    }
    const a = seg(usePath);
    const b = seg(routePath);
    return a.length === b.length && a.every((s, i) => segMatch(s, b[i]));
}

/**
 * Every mutating route registered in `text`, each with the guards that apply to it.
 * `guards` is the union of its own middleware and any earlier router-level `.use`
 * that covers it. `principal` says whether at least one of those decides who may call.
 */
export function scanSource(text, file = '<source>') {
    const src = stripComments(text);
    const consts = collectConsts(src);
    const uses = readUses(src, consts);
    const routes = [...readCreateRoutes(src, consts), ...readChainedRoutes(src, consts)]
        .sort((a, b) => a.index - b.index);
    return routes.map(({ index, ...route }) => {
        const inherited = uses.filter((u) => u.index < index && useCovers(u.path, route.path)).flatMap((u) => u.guards);
        const guards = [...new Set([...route.guards, ...inherited])];
        return {
            file,
            ...route,
            guards,
            principal: guards.some((g) => PRINCIPAL_GUARDS.includes(g)),
        };
    });
}

/** The allow-list key of a route: `file::METHOD path`. */
export const routeKey = (r) => `${r.file}::${r.method} ${r.path}`;

/** Routes with no principal guard: they admit every caller the global layers let through. */
export const unguarded = (routes) => routes.filter((r) => !r.principal);

/** The closed set of reasons an unguarded route may be allow-listed for. */
export const CATEGORIES = {
    'public-by-design': 'Anonymous callers are meant to reach it (booking, signing links, public reports); the handler validates its own input.',
    'token-track': 'Reached with a possession token (report, agreement, invoice or portal link) that the handler verifies.',
    'webhook-signature': 'A provider webhook; the handler verifies the provider signature before acting.',
    'authenticated-any-role': 'Any signed-in user may call it, by design (their own profile, session or preferences); the handler acts only on the caller.',
    'self-guarded-in-handler': 'The handler itself checks who may call, in code the scanner cannot see; the reason names the check.',
    'needs-owner-decision': 'TEMPORARY. Unclear whether every authenticated role should reach it. Counted so it cannot be forgotten.',
};

/**
 * Judge a scan against the allow-list. Pure: the caller supplies the routes and the list.
 * Returns the offenders (unguarded and not listed), stale entries (listed but no route
 * matches, or the route is guarded now), entries with an unknown category or no reason,
 * and whether the list has grown past its ceiling.
 */
export function judge(routes, allowList) {
    const entries = allowList.entries ?? {};
    const byKey = new Map(routes.map((r) => [routeKey(r), r]));
    const offenders = unguarded(routes).filter((r) => !(routeKey(r) in entries));
    const stale = Object.keys(entries).filter((k) => {
        const r = byKey.get(k);
        return !r || r.principal;
    });
    const malformed = Object.entries(entries)
        .filter(([, e]) => !(e && e.category in CATEGORIES) || typeof e.reason !== 'string' || e.reason.trim().length < 10)
        .map(([k]) => k);
    const count = Object.keys(entries).length;
    const grown = typeof allowList.maxEntries !== 'number' || count > allowList.maxEntries;
    return { offenders, stale, malformed, grown, count, max: allowList.maxEntries };
}
