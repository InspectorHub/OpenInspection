/**
 * The VALUES an enum column admits, even when the column names a constant.
 *
 * `text('kind', { enum: MARKETPLACE_KINDS })` renders in the schema reference as
 * that NAME unless something resolves it — correct about the source and useless
 * to a reader who opened the document to learn which values are allowed. The
 * indirection exists so consumers derive the list instead of retyping it; the
 * documentation should not pay for it.
 *
 * Lives here rather than in `gen-schema-doc.mjs` because that file is at its
 * size ceiling and this is a separable question: "what does this expression
 * mean" is not "how is the reference laid out".
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The array literal assigned to `name` in `text`, or null.
 *
 * The `;` bound matters: without it a constant that is not an array walks
 * forward to the next array anywhere in the file and reports ITS values as this
 * column's — a confident wrong answer, which is worse than the name it replaced.
 */
export function literalFor(name, text) {
    const at = text.indexOf(`const ${name} =`);
    if (at === -1) return null;
    const open = text.indexOf('[', at);
    const end = text.indexOf(';', at);
    if (open === -1 || (end !== -1 && open > end)) return null;
    const close = text.indexOf(']', open);
    return close === -1 ? null : text.slice(open, close + 1);
}

/**
 * The file a name is imported from, as [text, dir], or null.
 *
 * One hop only, matching the resolver's own contract: a vocabulary is either
 * declared where it is used or one import away, and chasing further would make
 * a wrong answer more likely rather than less.
 */
function importedSource(name, fileText, fileDir) {
    const im = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'([^']+)'`).exec(fileText);
    if (!im) return null;
    for (const ext of ['.ts', '/index.ts']) {
        const target = join(fileDir, im[1] + ext);
        if (existsSync(target)) return [readFileSync(target, 'utf8'), dirname(target)];
    }
    return null;
}

/** The object literal assigned to `name`, or null. Same `;` bound as `literalFor`. */
function objectLiteralFor(name, text) {
    const at = text.indexOf(`const ${name} =`);
    if (at === -1) return null;
    const open = text.indexOf('{', at);
    const end = text.indexOf(';', at);
    if (open === -1 || (end !== -1 && open > end)) return null;
    const close = text.indexOf('}', open);
    return close === -1 ? null : text.slice(open + 1, close);
}

/** `ROLE_KIND.CLIENT` → `'client'`, following one import for the object. */
function memberValue(expr, fileText, fileDir) {
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(expr);
    if (!m) return null;
    const [, objName, key] = m;
    let body = objectLiteralFor(objName, fileText);
    if (!body) {
        const src = importedSource(objName, fileText, fileDir);
        if (src) body = objectLiteralFor(objName, src[0]);
    }
    if (!body) return null;
    const hit = new RegExp(`\\b${key}\\s*:\\s*'([^']*)'`).exec(body);
    return hit ? `'${hit[1]}'` : null;
}

/**
 * Split a bracket literal on top-level commas, ignoring commas inside quotes.
 */
function membersOf(literal) {
    const inner = literal.slice(1, -1);
    const out = [];
    let buf = '', quote = null;
    for (const ch of inner) {
        if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
        if (ch === "'" || ch === '"') { quote = ch; buf += ch; continue; }
        if (ch === ',') { out.push(buf.trim()); buf = ''; continue; }
        buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(Boolean);
}

/**
 * Turn every member of a resolved bracket literal into a quoted string.
 *
 * Two shapes appear once vocabularies are DERIVED rather than retyped, and both
 * render as source code unless they are expanded here:
 *   `[...ROLE_KINDS, 'staff']`                — one list extending another
 *   `[ROLE_KIND.CLIENT, ROLE.INSPECTOR]`      — members picked from two axes
 * A member that resolves to neither is left exactly as written, so a shape this
 * does not understand degrades to the old behaviour instead of vanishing.
 *
 * `seen` stops a self-referential constant from recursing forever; a cycle
 * yields the unexpanded text, which is a poor cell and not a hung build.
 */
function expandMembers(literal, fileText, fileDir, seen) {
    const parts = membersOf(literal).map((member) => {
        if (member.startsWith("'") || member.startsWith('"')) return member;
        if (member.startsWith('...')) {
            const inner = resolveEnum(member.slice(3).trim(), fileText, fileDir, seen);
            return inner.startsWith('[') ? membersOf(inner).join(', ') : member;
        }
        return memberValue(member, fileText, fileDir) ?? member;
    });
    return `[${parts.join(', ')}]`;
}

/**
 * Resolve an enum expression to its literal, following one import if needed.
 *
 * A constant shared with the browser lives outside the schema directory on
 * purpose — `MARKETPLACE_KINDS` does, so the browse page can read it without
 * pulling drizzle into the client bundle — so stopping at the file boundary
 * would put the name back in the table.
 *
 * Anything it cannot resolve is returned untouched, never dropped: a name is
 * less useful than the values and still far more useful than a blank cell.
 */
export function resolveEnum(expr, fileText, fileDir, seen = new Set()) {
    if (!expr) return expr;
    if (expr.startsWith('[')) return expandMembers(expr, fileText, fileDir, seen);
    if (seen.has(expr)) return expr;
    seen.add(expr);
    const here = literalFor(expr, fileText);
    if (here) return expandMembers(here, fileText, fileDir, seen);
    const src = importedSource(expr, fileText, fileDir);
    if (!src) return expr;
    const found = literalFor(expr, src[0]);
    return found ? expandMembers(found, src[0], src[1], seen) : expr;
}
