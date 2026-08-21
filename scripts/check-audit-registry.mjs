#!/usr/bin/env node
/**
 * Audit registry conformance -- the enum and the call sites, walked BOTH ways.
 *
 * ── What rots, and why a type cannot catch it ────────────────────────────────
 * `Record<AuditAction, AuditActionDef>` already makes one direction free: a
 * union member with no registry entry does not compile. Every other way these
 * two can disagree is invisible to the compiler, because the other side is
 * source TEXT:
 *
 *   - an action written at a call site that nobody declared. This is how
 *     `booking.routing.applied` came to be written for months while absent from
 *     the union: the slug writer typed `action` as `string`.
 *   - a `live` entry with no call site at all. A vocabulary word for an event
 *     that never happens reads, to anyone building on it, exactly like one that
 *     does.
 *   - a NON-`live` entry that does have a call site. That is the reverse lie,
 *     and the more dangerous one: it says "look in the e-sign chain" about a
 *     row that is sitting in `audit_logs`.
 *   - a declared `meta` key nothing passes, or a passed key nothing declares.
 *     The registry's whole claim is that it says what a row actually carries.
 *   - an `entityType` at a call site that the entry does not declare.
 *
 * ── The order the checks run in, and why ─────────────────────────────────────
 * The undeclared check runs FIRST, before anything is reported as dead. A first
 * survey of this vocabulary called `inspection.sync_conflict_resolved` dead; it
 * is live, dispatched in `admin-data.ts` through a zod enum declared in
 * `lib/validations/audit-log-write.schema.ts` rather than written as a literal at the
 * call site. Walking for literals alone and then declaring
 * the leftovers unused is how a live action gets deleted.
 *
 * ── Two numbers, side by side, and zero is a failure ─────────────────────────
 * The summary prints what was DECLARED and what was FOUND on the same line. A
 * gate that prints only "OK" is unfalsifiable on the day its walk breaks: point
 * it at an empty directory and a broken walk reports the same clean result as a
 * correct one. So both counts are printed, and either being zero exits 1.
 * Failures name every disagreeing action -- never a count on its own.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY_FILE = 'server/lib/audit-registry.ts';
/** The write path itself: its own `action` mentions are the parameter, not a call. */
const WRITER_FILE = 'server/lib/audit.ts';

/**
 * Directories walked for call sites. Overridable ONLY so the gate's own
 * zero-match failure can be demonstrated -- see the header.
 */
const SCAN = (process.env.AUDIT_REGISTRY_SCAN ?? 'server,app').split(',').filter(Boolean);

/**
 * Call sites that do not write a string literal, each with the reason and the
 * source the gate reads the real values back from. An entry here is NOT an
 * exemption: the gate still fails if the named source stops producing values.
 */
const DYNAMIC_DISPATCH = [
    {
        /** Where the dynamic call lives. */
        site: 'server/api/admin/admin-data.ts',
        /** Where the literals it can dispatch are declared, read back below. */
        file: 'server/lib/validations/audit-log-write.schema.ts',
        constName: 'InspectorAuditActionSchema',
        reason: 'POST /audit-logs lets the inspector conflict-modal record its own resolution. The action is not a literal at the call site; it arrives from the request and is narrowed by this zod enum, which is the real vocabulary.',
    },
];

/**
 * Files that insert into `audit_logs` WITHOUT going through `server/lib/audit.ts`.
 *
 * This is the redaction bypass, not a style point: the helpers in `audit.ts`
 * strip email / IP / phone shapes out of `metadata` at write time, and a direct
 * insert stores whatever the caller composed. The list is here so that a NEW
 * direct writer fails this gate instead of arriving unnoticed; a stale entry
 * fails too, because the gate checks the file still contains the insert.
 */
const DIRECT_WRITERS = [
    {
        file: 'server/services/widget.service.ts',
        reason: 'Writes `widget.${event}` for the public booking widget. The action is a template literal, so it is outside `AuditAction` by construction, and the row is written by an unauthenticated public request. NOT redacted: it stores the caller-supplied metadata and an `ip` key verbatim.',
    },
];

const EXT = /\.(ts|tsx)$/;

function listFiles(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = path.join(dir, e);
        if (statSync(p).isDirectory()) { if (e !== 'node_modules') listFiles(p, out); }
        else if (EXT.test(e)) out.push(p);
    }
    return out;
}

/** Blank out comments, preserving offsets so line numbers stay true. */
function stripComments(src) {
    let out = '', i = 0, inS = null;
    while (i < src.length) {
        const ch = src[i], nx = src[i + 1];
        if (inS) {
            out += ch;
            if (ch === '\\') { out += nx ?? ''; i += 2; continue; }
            if (ch === inS) inS = null;
            i++; continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') { inS = ch; out += ch; i++; continue; }
        if (ch === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
        if (ch === '/' && nx === '*') {
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
            out += '  '; i += 2; continue;
        }
        out += ch; i++;
    }
    return out;
}

/** Text between the bracket at `open` and its match, exclusive. */
function balanced(text, open, o = '(', c = ')') {
    let depth = 0, inS = null;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (inS) { if (ch === '\\') { i++; continue; } if (ch === inS) inS = null; continue; }
        if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
        if (ch === o) depth++;
        else if (ch === c) { depth--; if (depth === 0) return text.slice(open + 1, i); }
    }
    return null;
}

/** Split on commas that are not inside brackets or strings. */
function splitTop(text) {
    const out = []; let depth = 0, inS = null, cur = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inS) { cur += ch; if (ch === '\\') { cur += text[++i] ?? ''; continue; } if (ch === inS) inS = null; continue; }
        if (ch === "'" || ch === '"' || ch === '`') { inS = ch; cur += ch; continue; }
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function propValue(objText, key) {
    const t = objText.trim();
    const inner = t.startsWith('{') ? balanced(t, 0, '{', '}') : t;
    if (inner === null) return null;
    for (const part of splitTop(inner)) {
        const m = new RegExp(`^${key}\\s*:`).exec(part);
        if (m) return part.slice(m[0].length).trim();
    }
    return null;
}

/**
 * A string literal in EITHER quote style. Both are required, not tidiness:
 * `server/` is single-quoted and `app/` is double-quoted, and the one call site
 * that lives in `app/` (the OAuth consent action) was invisible to this walk
 * while it only matched `'...'` -- the gate reported the action as never
 * written while it sat six lines away.
 */
const asLiteral = (s) => {
    const t = (s ?? '').trim();
    return /^'[^']*'$/.test(t) || /^"[^"]*"$/.test(t) ? t.slice(1, -1) : null;
};

/** Top-level keys of an object literal; a spread contributes the marker `...`. */
function objectKeys(s) {
    if (!s || !s.trim().startsWith('{')) return null;
    const inner = balanced(s.trim(), 0, '{', '}');
    if (inner === null) return null;
    return splitTop(inner).map((p) => {
        if (p.startsWith('...')) return '...';
        const m = /^\[?['"]?([A-Za-z0-9_$]+)['"]?\]?\s*[:,]?/.exec(p);
        return m ? m[1] : null;
    }).filter(Boolean);
}

/**
 * Every audit write in the tree, keyed by action.
 *
 * Exported so a spec can assert on the walk itself rather than only on this
 * script's exit code.
 */
export function walkCallSites(scanDirs = SCAN) {
    const byAction = new Map();
    const metaByAction = new Map();
    const familyByAction = new Map();
    const unresolved = [];
    const directWriters = [];
    let sites = 0;

    const record = (action, family, metaKeys, where) => {
        sites++;
        if (!byAction.has(action)) byAction.set(action, new Set());
        byAction.get(action).add(where);
        if (!metaByAction.has(action)) metaByAction.set(action, { keys: new Set(), spread: false });
        const m = metaByAction.get(action);
        for (const k of metaKeys) { if (k === '...') m.spread = true; else m.keys.add(k); }
        if (family) {
            if (!familyByAction.has(action)) familyByAction.set(action, new Set());
            familyByAction.get(action).add(family);
        }
    };

    for (const dir of scanDirs) {
        for (const abs of listFiles(path.join(ROOT, dir))) {
            const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
            if (rel === WRITER_FILE || rel === REGISTRY_FILE) continue;
            const raw = readFileSync(abs, 'utf8');
            const text = stripComments(raw);
            const lineOf = (idx) => text.slice(0, idx).split('\n').length;

            for (const name of ['auditFromContext', 'writeAuditLogWithSlug', 'writeAuditLog']) {
                const re = new RegExp(`(?<![A-Za-z0-9_$.])${name}\\s*\\(`, 'g');
                let m;
                while ((m = re.exec(text))) {
                    const open = m.index + m[0].length - 1;
                    const args = balanced(text, open);
                    if (args === null) continue;
                    const parts = splitTop(args);
                    const where = `${rel}:${lineOf(m.index)}`;
                    let action, family, metaKeys;
                    if (name === 'auditFromContext') {
                        action = asLiteral(parts[1]);
                        family = asLiteral(parts[2]);
                        metaKeys = parts[3] ? (objectKeys(propValue(parts[3], 'metadata') ?? '') ?? []) : [];
                    } else {
                        const obj = name === 'writeAuditLogWithSlug' ? parts[1] : parts[0];
                        if (!obj) continue;
                        action = asLiteral(propValue(obj, 'action') ?? '');
                        family = asLiteral(propValue(obj, 'entityType') ?? '');
                        metaKeys = objectKeys(propValue(obj, 'metadata') ?? '') ?? [];
                    }
                    if (action === null) { unresolved.push({ where, call: name }); continue; }
                    record(action, family, metaKeys, where);
                }
            }

            const di = /insert\(auditLogs\)\s*\.values\s*\(/g;
            let dm;
            while ((dm = di.exec(text))) directWriters.push(`${rel}:${lineOf(dm.index)}`);
        }
    }

    return { sites, byAction, metaByAction, familyByAction, unresolved, directWriters };
}

/** Parse the registry's top-level entries out of its TypeScript source. */
export function readRegistry() {
    const src = stripComments(readFileSync(path.join(ROOT, REGISTRY_FILE), 'utf8'));
    const start = src.indexOf('AUDIT_REGISTRY');
    if (start === -1) return new Map();
    const body = balanced(src, src.indexOf('{', start), '{', '}');
    if (body === null) return new Map();
    const out = new Map();
    for (const part of splitTop(body)) {
        const m = /^'([^']+)'\s*:\s*\{/.exec(part);
        if (!m) continue;
        const def = part.slice(part.indexOf('{'));
        const families = [asLiteral(propValue(def, 'family') ?? '')].filter(Boolean);
        const alt = propValue(def, 'altFamilies');
        if (alt) for (const f of [...alt.matchAll(/'([^']+)'/g)]) families.push(f[1]);
        const metaRaw = propValue(def, 'meta') ?? '{}';
        const meta = new Set((objectKeys(metaRaw) ?? []).filter((k) => k !== '...'));
        const status = propValue(def, 'status') ?? '';
        const kind = asLiteral(propValue(status, 'kind') ?? '') ?? 'unknown';
        out.set(m[1], { families, meta, kind });
    }
    return out;
}

/** Literals of a `const <name> = z.enum([...])` in one file. */
function readEnum(relFile, constName) {
    let src;
    try { src = stripComments(readFileSync(path.join(ROOT, relFile), 'utf8')); } catch { return null; }
    const re = new RegExp(`${constName}\\s*=\\s*z\\.enum\\s*\\(`);
    const m = re.exec(src);
    if (!m) return null;
    const args = balanced(src, m.index + m[0].length - 1);
    if (args === null) return null;
    const line = src.slice(0, m.index).split('\n').length;
    return { line, values: [...args.matchAll(/'([^']+)'/g)].map((x) => x[1]) };
}

const registry = readRegistry();
const walk = walkCallSites();
const failures = [];

/**
 * The count from the SOURCE WALK alone, taken before the dynamic-dispatch
 * resolution below adds to it. The zero-match check has to read this and not
 * the running total: DYNAMIC_DISPATCH resolves against fixed file paths, so it
 * contributes call sites even when the walk found nothing, and a total of 1
 * would have satisfied a "> 0" test on a completely broken scan. Caught by the
 * gate's own third failure proof.
 */
const literalSites = walk.sites;

// Dynamic dispatch, resolved from the source that narrows it. Done before any
// "declared but never written" conclusion, so a live action reached this way is
// never mistaken for a dead one.
const dynamicSites = new Set();
for (const d of DYNAMIC_DISPATCH) {
    const found = readEnum(d.file, d.constName);
    if (!found || found.values.length === 0) {
        failures.push(`dynamic dispatch: ${d.file} no longer defines \`${d.constName}\` as a non-empty z.enum — the gate can no longer tell which actions it dispatches`);
        continue;
    }
    for (const v of found.values) {
        dynamicSites.add(`${d.file}:${found.line}`);
        if (!walk.byAction.has(v)) walk.byAction.set(v, new Set());
        walk.byAction.get(v).add(`${d.file}:${found.line} (via ${d.constName})`);
        walk.sites++;
    }
}
for (const u of walk.unresolved) {
    if (!dynamicSites.has(u.where) && !DYNAMIC_DISPATCH.some((d) => u.where.startsWith(d.site + ':'))) {
        failures.push(`unresolved action at ${u.where} (${u.call}) — it is not a string literal and no DYNAMIC_DISPATCH entry explains it`);
    }
}

// Direct table writers: both directions. A new one fails; a listed one that
// stopped inserting fails too, so the list cannot decay into a blanket permit.
const allowedDirect = new Set(DIRECT_WRITERS.map((d) => d.file));
for (const where of walk.directWriters) {
    const file = where.slice(0, where.lastIndexOf(':'));
    if (!allowedDirect.has(file)) {
        failures.push(`direct insert into audit_logs at ${where} — it bypasses the redaction in ${WRITER_FILE}; route it through the audit helpers or declare it in DIRECT_WRITERS with the reason`);
    }
}
for (const d of DIRECT_WRITERS) {
    if (!walk.directWriters.some((w) => w.startsWith(d.file + ':'))) {
        failures.push(`DIRECT_WRITERS lists ${d.file}, which no longer inserts into audit_logs — drop the entry`);
    }
}

// 1. Written but not declared. First, for the reason in the header.
const undeclared = [...walk.byAction.keys()].filter((a) => !registry.has(a)).sort();
for (const a of undeclared) {
    failures.push(`undeclared action '${a}' written at ${[...walk.byAction.get(a)].join(', ')}`);
}

// 2. Declared but disagreeing with the call sites.
const unreconciled = new Set();
const note = (action, msg) => { unreconciled.add(action); failures.push(msg); };
for (const [action, def] of registry) {
    const seen = walk.byAction.get(action);
    if (def.kind === 'live' && !seen) {
        note(action, `'${action}' is declared live but is written nowhere — delete it, or write it`);
        continue;
    }
    if (def.kind !== 'live' && seen) {
        note(action, `'${action}' is declared '${def.kind}' but IS written at ${[...seen].join(', ')}`);
        continue;
    }
    if (!seen) continue;

    const observed = walk.metaByAction.get(action) ?? { keys: new Set(), spread: false };
    const missing = [...observed.keys].filter((k) => !def.meta.has(k)).sort();
    // A spread means the call site passes keys this walk cannot name, so the
    // registry declaring MORE than was observed is expected there and only there.
    const extra = observed.spread ? [] : [...def.meta].filter((k) => !observed.keys.has(k)).sort();
    if (missing.length) note(action, `'${action}' passes metadata the registry does not declare: ${missing.join(', ')} (at ${[...seen].join(', ')})`);
    if (extra.length) note(action, `'${action}' declares metadata no call site passes: ${extra.join(', ')}`);

    const observedFamilies = walk.familyByAction.get(action);
    if (observedFamilies) {
        const strayFamilies = [...observedFamilies].filter((f) => !def.families.includes(f)).sort();
        if (strayFamilies.length) note(action, `'${action}' is written with entityType ${strayFamilies.map((f) => `'${f}'`).join(', ')}, which its entry does not declare`);
    }
}

const declaredCount = registry.size;
const writtenCount = walk.byAction.size;
if (declaredCount === 0) failures.push(`read no entries from ${REGISTRY_FILE} — a gate that scans nothing reports the same clean result as a correct one`);
if (literalSites === 0) failures.push(`the source walk found no audit call sites under ${SCAN.join(', ')} — a gate that scans nothing reports the same clean result as a correct one`);

console.log(
    `[audit-registry] ${declaredCount} action(s) declared, ${writtenCount} written at ${walk.sites} call site(s), ` +
    `${undeclared.length} undeclared, ${unreconciled.size} unreconciled`
);

if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`[audit-registry] ${failures.length} problem(s). See ${REGISTRY_FILE}.`);
    process.exit(1);
}
