/**
 * The pre-commit hook skips the server (api) type-check for a commit whose staged TypeScript cannot reach it.
 * "Cannot reach it" has to mean exactly what `tsconfig.api.json` includes: `server/**` plus the package trees
 * listed there. A tree that the program includes but the hook does not know about makes a commit that changes
 * only that tree run the app pass alone while the server files that import it go unchecked until CI.
 *
 * The hook keeps the list in `API_INPUTS`; this spec derives the same list from `tsconfig.api.json` and
 * fails when they differ in either direction.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..');

/** Directory prefixes (with a trailing slash) of every `include` glob that is a directory tree. */
function includedTrees(tsconfigText: string): string[] {
    const withoutComments = tsconfigText
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
    const include = (JSON.parse(withoutComments) as { include: string[] }).include;
    const trees = new Set<string>();
    for (const glob of include) {
        const star = glob.indexOf('**');
        if (star > 0) trees.add(glob.slice(0, star));
    }
    return [...trees].sort();
}

/** The alternatives named in the hook's `API_INPUTS='^(a|b|c)'` assignment. */
function hookInputs(hookText: string): string[] {
    const match = hookText.match(/API_INPUTS='\^\(([^)]*)\)'/);
    if (!match) throw new Error('API_INPUTS not found in .githooks/pre-commit');
    return match[1]!.split('|').sort();
}

describe('pre-commit api type-check tier', () => {
    const trees = includedTrees(readFileSync(resolve(ROOT, 'tsconfig.api.json'), 'utf8'));
    const inputs = hookInputs(readFileSync(resolve(ROOT, '.githooks/pre-commit'), 'utf8'));

    it('treats exactly the trees tsconfig.api.json includes as api inputs', () => {
        expect(inputs).toEqual(trees);
    });

    it('includes the package trees a server file can import, not only server/', () => {
        expect(trees.length).toBeGreaterThan(1);
        expect(trees).toContain('server/');
        expect(trees).toContain('packages/field-ui/src/shared/');
    });

    it('can say no: a tree missing from the hook, or an extra one, is reported', () => {
        const config = JSON.stringify({ include: ['server/**/*.ts', 'packages/new-tree/**/*.ts'] });
        expect(includedTrees(config)).toEqual(['packages/new-tree/', 'server/']);
        expect(hookInputs("API_INPUTS='^(server/|packages/new-tree/)'")).toEqual(['packages/new-tree/', 'server/']);
        expect(hookInputs("API_INPUTS='^(server/)'")).not.toEqual(includedTrees(config));
        expect(() => hookInputs('nothing here')).toThrow();
    });
});
