/**
 * The schema reference must print VALUES, not the expression that produced them.
 *
 * `gen-schema-doc.mjs` renders whatever `resolveEnum` hands back, and its own
 * rule is that an unresolved expression is passed through rather than dropped.
 * That is the right failure mode and a poor result: a reader who opens
 * `docs/reference/database-schema.md` to learn which values a column admits is
 * not helped by `['inspector', ...ROLE_KINDS]`.
 *
 * Those expressions appeared the moment the role vocabularies were converged
 * onto shared arrays (IA-107), so the resolver has to understand the two shapes
 * a derived vocabulary takes: a SPREAD of another list, and a MEMBER of a named
 * constants object. This spec runs the resolver over the real schema sources —
 * not fixtures — because the thing worth guaranteeing is that THESE columns
 * document themselves, and a fixture would keep passing after the schema moved.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(__dirname, '..', '..', '..');

// Loaded dynamically, the way `status-literal-gate.spec.ts` and
// `symbol-baseline.spec.ts` load their gates: a `.mjs` under `scripts/` has no
// declaration file, so a static import is an implicit `any` and the tests
// program refuses it (TS7016). The gate scripts are deliberately plain JS with
// no build step, so the import side is where this is resolved.
let resolveEnum: (expr: string, src: string, dir: string) => string;
beforeAll(async () => {
    const url = pathToFileURL(join(ROOT, 'scripts/lib/resolve-enum.mjs')).href;
    ({ resolveEnum } = (await import(/* @vite-ignore */ url)) as {
        resolveEnum: (expr: string, src: string, dir: string) => string;
    });
});

/** Resolve `expr` as `gen-schema-doc.mjs` would, from a real schema file. */
function resolvedFor(relPath: string, expr: string): string {
    const abs = join(ROOT, relPath);
    return resolveEnum(expr, readFileSync(abs, 'utf8'), dirname(abs));
}

/** The rendered cell is useless unless every member is a quoted string. */
function expectOnlyLiterals(resolved: string, members: string[]) {
    expect(resolved.startsWith('[')).toBe(true);
    expect(resolved).not.toMatch(/\.\.\./);
    for (const m of members) expect(resolved).toContain(`'${m}'`);
    // Negative control: an expansion that simply concatenated everything it
    // could find would also contain the members above.
    expect(resolved.match(/'/g)?.length).toBe(members.length * 2);
}

describe('schema-doc enum resolution', () => {
    it('resolves a plain imported array (the case that already worked)', () => {
        const resolved = resolvedFor('server/lib/db/schema/inspection/role-profiles.ts', 'ROLE_KINDS');
        expectOnlyLiterals(resolved, ['client', 'agent', 'other']);
    });

    it('expands a spread declared in the same file', () => {
        // `MESSAGE_FROM_ROLES = ['inspector', ...ROLE_KINDS]`
        const resolved = resolvedFor('server/lib/db/schema/message.ts', 'MESSAGE_FROM_ROLES');
        expectOnlyLiterals(resolved, ['inspector', 'client', 'agent', 'other']);
    });

    it('expands a spread reached through an import', () => {
        // `CONSENT_RECIPIENT_TYPES = [...ROLE_KINDS, 'staff']`, one file away.
        const resolved = resolvedFor('server/lib/db/schema/compliance.ts', 'CONSENT_RECIPIENT_TYPES');
        expectOnlyLiterals(resolved, ['client', 'agent', 'other', 'staff']);
    });

    it('expands members of a named-constants object', () => {
        // `REPAIR_CREATOR_KINDS = [ROLE_KIND.CLIENT, ROLE_KIND.AGENT, ROLE.INSPECTOR]`
        // — two objects, one of them in a second file again.
        const resolved = resolvedFor('server/lib/db/schema/repair-request.ts', 'REPAIR_CREATOR_KINDS');
        expectOnlyLiterals(resolved, ['client', 'agent', 'inspector']);
    });

    it('returns an unknown name untouched rather than guessing', () => {
        const resolved = resolvedFor('server/lib/db/schema/message.ts', 'NOT_A_REAL_VOCABULARY');
        expect(resolved).toBe('NOT_A_REAL_VOCABULARY');
    });
});
