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
import { join } from 'node:path';

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
export function resolveEnum(expr, fileText, fileDir) {
    if (!expr || expr.startsWith('[')) return expr;
    const here = literalFor(expr, fileText);
    if (here) return here;
    const im = new RegExp(`import\\s*\\{[^}]*\\b${expr}\\b[^}]*\\}\\s*from\\s*'([^']+)'`).exec(fileText);
    if (!im) return expr;
    for (const ext of ['.ts', '/index.ts']) {
        const target = join(fileDir, im[1] + ext);
        if (existsSync(target)) {
            const found = literalFor(expr, readFileSync(target, 'utf8'));
            if (found) return found;
        }
    }
    return expr;
}
