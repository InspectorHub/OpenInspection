/**
 * Reading the mounts of server/index.ts and the paths server/lib/auth/public-paths.ts leaves open, for scripts/check-public-projection.mjs.
 * Split out of the gate for its size; the gate re-exports what its spec uses.
 */
import { posix } from 'node:path';

export const stripLineComments = (src) => src.split('\n').map((l) => l.replace(/(^|[^:'"`\w])\/\/.*$/, '$1')).join('\n');

/**
 * Every `.route(path, Module)` mount in one file, found from its own text. The identifier is resolved through the
 * relative import that names it; `Module()` (a factory call) reads as the module that exports the factory. A call the
 * reader cannot parse is reported in `problems`, never skipped.
 */
export function parseMounts(src, file = 'server/index.ts') {
    const text = stripLineComments(src);
    const imports = new Map();
    for (const m of text.matchAll(/import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s*from\s*['"](\.[^'"]*)['"]/g)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[3]));
        if (m[1]) imports.set(m[1], target);
        for (const part of (m[2] ?? '').split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) imports.set(name, target);
        }
    }
    const mounts = [];
    const problems = [];
    const read = new Set();
    for (const m of text.matchAll(/\.route\(\s*(?:(['"`])([^'"`]*)\1|(\w+))\s*,\s*(\w+)\s*(?:\(\s*\))?\s*\)/g)) {
        read.add(m.index);
        mounts.push({ path: m[2] ?? null, pathName: m[3] ?? null, name: m[4], target: imports.get(m[4]) ?? null });
    }
    for (const m of text.matchAll(/\.route\(/g)) {
        if (!read.has(m.index)) problems.push(`${file}: a .route( call the reader could not parse: ${text.slice(m.index, m.index + 120).split('\n')[0].trim()}`);
    }
    return { mounts, problems };
}

/**
 * The modules that server/index.ts mounts under `/api/public`. Throws when a mount cannot be read: a `.route(` call that
 * does not parse, an identifier that is not a relative import, or one that is not under ./api/. A mount skipped in
 * silence is a module that is never scanned.
 */
export function publicMounts(indexSrc, file = 'server/index.ts') {
    const { mounts, problems } = parseMounts(indexSrc, file);
    const ours = mounts.filter((m) => m.path !== null && m.path.startsWith('/api/public'));
    const bad = problems.filter((p) => p.includes('api/public'));
    for (const m of ours) {
        if (m.target === null) bad.push(`${m.path} is mounted from ${m.name}, which is not a relative import`);
        else if (!m.target.startsWith('server/api/')) bad.push(`${m.path} is mounted from ${m.name} (${m.target}), which is not under ./api/`);
    }
    if (bad.length) throw new Error(`cannot read the /api/public mounts: ${bad.join('; ')}`);
    return ours.map((m) => ({ name: m.name, target: m.target }));
}

/** The module file a mount target names: `<t>.ts` or `<t>/index.ts`. */
export const moduleFile = (target, present) => [`${target}.ts`, `${target}/index.ts`].find((f) => present(f)) ?? null;

/**
 * Paths public-paths.ts leaves open that are pages of the server-rendered app, or answered by a handler written inline in server/index.ts
 * (which is scanned), and so have no `.route` mount to resolve. Every such literal is listed with the reason; an open literal outside
 * /api that is neither mounted nor listed here fails the gate, and so does a listed path that is no longer open.
 */
export const PAGE_PATHS = {
    '/agent-signup': 'a page of the server-rendered app (its API is /api/agent-signup, scanned)',
    '/agent/magic-login': 'a page; the redeem route is mounted at the root from agent/magic-login.ts (scanned)',
    '/confirm/': 'a page of the server-rendered app',
    '/book': 'a page of the server-rendered app',
    '/book/': 'a page of the server-rendered app',
    '/inspector/': 'a page, and the inline calendar feed in server/index.ts (scanned)',
    '/embed/': 'a page of the server-rendered app',
    '/photos/': 'the inline inspector-photo route in server/index.ts (scanned): streams one stored object',
    '/status': 'the inline status route in server/index.ts (scanned)',
    '/static/': 'static assets',
    '/report/': 'a page of the server-rendered app',
    '/report-view/': 'a page of the server-rendered app',
    '/invoice/': 'a page of the server-rendered app',
    '/agreements/sign/': 'a page of the server-rendered app',
    '/checkout/': 'a page of the server-rendered app',
    '/sign/': 'a page, and the inline redirect route in server/index.ts (scanned)',
    '/verify/': 'a page of the server-rendered app',
    '/v/': 'a page of the server-rendered app',
    '/unsubscribe/': 'a page of the server-rendered app (its API is /api/public/unsubscribe, scanned)',
    '/repair-request/': 'a page of the server-rendered app',
    '/repair-builder/': 'a page of the server-rendered app (its API is under /api/public, scanned)',
    '/portal/': 'a page of the server-rendered app (its API is /api/portal, scanned)',
    '/': 'the landing redirect',
};

/** The string constants a paths module exports (`export const NAME = '...'` or a template over earlier ones), by name. */
export function readPathConstants(src) {
    const out = {};
    for (const m of stripLineComments(src).matchAll(/export const (\w+)\s*=\s*(?:'([^']*)'|`([^`]*)`)/g)) {
        out[m[1]] = m[2] ?? m[3].replace(/\$\{(\w+)\}/g, (_, name) => out[name] ?? `\${${name}}`);
    }
    return out;
}

/**
 * Every literal public-paths.ts opens, in any quote style, with a count of the comparisons the file makes so a form the reader
 * missed is noticed: the number of `startsWith(` calls and `path ===` comparisons must equal the number captured, and a
 * `.includes(path)` / `.has(path)` test (a form this reader does not read) is a problem on its own.
 */
export function readOpenPaths(publicPathsSrc, constants = {}) {
    const text = stripLineComments(publicPathsSrc);
    const literals = [];
    const problems = [];
    const value = (quoted, name, form) => {
        if (quoted !== undefined) return quoted;
        if (name !== undefined && constants[name] !== undefined) return constants[name];
        problems.push(`${form} names ${name}, which does not resolve to a string`);
        return null;
    };
    for (const m of text.matchAll(/\bstartsWith\s*\(\s*(?:(['"`])([^'"`]*)\1|([A-Z_][A-Z0-9_]*))\s*\)/g)) {
        const path = value(m[2], m[3], 'startsWith');
        if (path !== null) literals.push({ path, prefix: true });
    }
    for (const m of text.matchAll(/\bpath\s*===?\s*(?:(['"`])([^'"`]*)\1|([A-Z_][A-Z0-9_]*))/g)) {
        const path = value(m[2], m[3], 'path ===');
        if (path !== null) literals.push({ path, prefix: false });
    }
    const starts = [...text.matchAll(/\bstartsWith\s*\(/g)].length;
    const equals = [...text.matchAll(/\bpath\s*===?/g)].length;
    const unread = [...text.matchAll(/\.(?:includes|has|indexOf)\s*\(\s*path\s*\)/g)].length;
    const captured = (prefix) => literals.filter((l) => l.prefix === prefix).length;
    if (starts !== captured(true)) problems.push(`public-paths.ts has ${starts} startsWith( calls and ${captured(true)} were read`);
    if (equals !== captured(false)) problems.push(`public-paths.ts has ${equals} path === comparisons and ${captured(false)} were read`);
    if (unread > 0) problems.push(`public-paths.ts tests path with includes/has/indexOf ${unread} time(s), a form this reader does not read`);
    return { literals, problems };
}

/**
 * Every path or prefix that public-paths.ts leaves outside the session middleware, resolved to the modules that answer it: the mounts
 * at, or under, the prefix; failing that, the mounts at the longest enclosing mount (the root and `/api` do not count as enclosing, they
 * would claim everything). An /api literal that resolves to nothing is returned in `unresolved`. A literal outside /api that no mount
 * answers must be listed in PAGE_PATHS (`unlistedPages` otherwise), and a listed path that is no longer open is `stalePages`. Modules
 * mounted at the root can answer any path, so they are returned in `rootModules` and are checked like the rest.
 */
export function publicPathModules(publicPathsSrc, mounts, { constants = {}, pages = PAGE_PATHS } = {}) {
    const { literals, problems } = readOpenPaths(publicPathsSrc, constants);
    const lit = mounts.filter((m) => m.path !== null);
    const unresolved = [];
    const unlistedPages = [];
    const modules = new Map();
    for (const { path, prefix } of literals) {
        // `startsWith('/api/')` there is the guard that keeps an /api path from being taken for a static asset; it opens nothing.
        if (path === '/api/') continue;
        const p = path.replace(/\/$/, '');
        let hit = lit.filter((m) => m.path !== '/' && (m.path === p || (prefix && m.path.startsWith(`${p}/`))));
        if (hit.length === 0) {
            const container = lit.filter((m) => m.path !== '/' && m.path !== '/api' && p.startsWith(`${m.path}/`))
                .sort((a, b) => b.path.length - a.path.length)[0];
            if (container) hit = lit.filter((m) => m.path === container.path);
        }
        if (hit.length === 0) {
            if (p.startsWith('/api/')) unresolved.push(path);
            else if (!(path in pages)) unlistedPages.push(path);
            continue;
        }
        for (const m of hit) modules.set(`${m.path} ${m.name}`, { via: path, mount: m });
    }
    const opened = new Set(literals.map((l) => l.path));
    return {
        unresolved, unlistedPages, problems, modules: [...modules.values()],
        stalePages: Object.keys(pages).filter((path) => !opened.has(path)),
        rootModules: lit.filter((m) => m.path === '/').map((m) => ({ via: '/', mount: m })),
    };
}
