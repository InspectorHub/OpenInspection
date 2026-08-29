#!/usr/bin/env node
/**
 * Item-key parity gate (`lint:item-key-parity`).
 *
 * -- WHAT THIS EXISTS FOR ---------------------------------------------------
 * SEVEN places in this repo decide what keys a template item has. Only two of
 * them fail loudly when they disagree: the TS interface (a compile error) and
 * the Zod union (a 400 naming the key). The other five discard silently -- a
 * key strips out in `stripRuntimeKeys`, never gets serialized on save, or is
 * simply not read by the report projection, and nothing anywhere says so.
 *
 * That is not hypothetical. `number` is on the authority type, in the Zod base
 * fields, in ITEM_KEYS and in SchemaItem -- and was NOT in the editor's own type
 * nor in the editor's save serializer. So authoring a `number` used to lose it,
 * with no error. This gate exists so the next key added does not repeat that.
 *
 * -- WHY IT DOES NOT DEMAND BYTE-IDENTICAL MIRRORS --------------------------
 * `SchemaItem` reads a handful of the keys on purpose; the report does not need
 * `attributes`. Demanding equality would be wrong, not strict. So the rule is:
 * every mirror carries an explicit list of the keys it deliberately does not
 * want, and only an UNDECLARED absence fails. A declared gap is a decision; an
 * undeclared one is a bug.
 *
 * -- WHY MEMBERS ARE READ BY BRACE DEPTH, NOT BY INDENTATION ----------------
 * The seven files are indented four, two and ONE space respectively, and
 * `FormField.tsx` indents a nested object exactly as deep as the interface's
 * own members. An indentation rule reads `information` / `limitations` /
 * `defects` off the `tabs` object and reports three keys `TemplateItem` does
 * not have -- a gate failing on its own parser. Depth is the property that
 * actually distinguishes a member from a member of a member.
 *
 * Prints BOTH numbers -- authority keys and mirrors compared -- and names every
 * skipped key per mirror. Zero mirrors compared is a FAILURE: an empty result
 * reads as green.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/**
 * Keys each mirror deliberately does not carry, with the reason.
 * An entry here is a reviewed decision. Adding one to silence a real drift is
 * the misuse this file cannot prevent and review has to.
 */
const DECLARED_SKIPS = {
    'server/lib/validations/template.schema.ts': {
        ratingOptions: 'lives on RichItemSchema, not on the shared base fields',
        tabs:          'lives on RichItemSchema',
        options:       'lives on the seven non-rich member schemas',
        type:          'the discriminator; declared per member',
    },
    'app/lib/editor/structure-ops.ts': {},
    'app/lib/editor/serialize-template.ts': {},
    'app/components/template/types.ts': {},
    'app/components/form/FormField.tsx': {
        attributes:            'the field renderer draws one control; attributes are a panel',
        source:                'import provenance is an editor concern, not a render one',
        number:                'the author-written display number is rendered by ItemList',
        defaultRecommendation: 'rendered by the report, never by the input control',
        parentId:              'nesting is drawn by ItemList; a single field has no depth',
        icon:                  'drawn by ItemList',
    },
    'server/services/inspection/report-schema-types.ts': {
        options:               'the report prints the answer, not the input constraints',
        attributes:            'projected separately by the attributes resolver',
        source:                'import provenance is never printed',
        required:              'a report shows what was answered, not what was mandatory',
        isSafety:              'severity comes from the rating level, not the item flag',
        defaultRecommendation: 'resolved per-defect, not per-item, in the projection',
        description:           'projected from the resolved tabs',
    },
};

/** Source with comments blanked, so a brace inside prose cannot move the depth. */
function withoutComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * The DIRECT members of a `{ ... }` block that starts at `opener`.
 *
 * Walks braces so a nested object's members are read at depth 2 and skipped,
 * whatever the file's indentation happens to be.
 */
function directMembers(src, opener) {
    const clean = withoutComments(src);
    const start = clean.indexOf(opener);
    if (start < 0) return [];
    let depth = 0;
    let atMemberStart = false;
    const keys = [];
    for (let i = start + opener.length - 1; i < clean.length; i += 1) {
        const ch = clean[i];
        if (ch === '{' || ch === '(' || ch === '[') { depth += 1; atMemberStart = depth === 1; continue; }
        if (ch === '}' || ch === ')' || ch === ']') { depth -= 1; if (depth === 0) break; atMemberStart = false; continue; }
        if (ch === ';' || ch === ',' || ch === '\n') { atMemberStart = depth === 1; continue; }
        if (depth !== 1 || !atMemberStart) continue;
        if (/\s/.test(ch)) continue;
        const member = /^([A-Za-z][A-Za-z0-9]*)\s*\??\s*:/.exec(clean.slice(i));
        if (member) keys.push(member[1]);
        atMemberStart = false;
    }
    return keys;
}

/** Keys of the authority interface, in declaration order. */
function authorityKeys() {
    return directMembers(read('server/types/template-schema.ts'), 'export interface TemplateItem {');
}

const MIRRORS = [
    {
        file: 'server/lib/validations/template.schema.ts',
        keys: () => directMembers(read('server/lib/validations/template.schema.ts'), 'const BaseItemFields = {'),
    },
    {
        file: 'app/lib/editor/structure-ops.ts',
        keys: () => {
            const src = read('app/lib/editor/structure-ops.ts');
            const body = /const ITEM_KEYS = new Set<string>\(\[([\s\S]*?)\]\);/.exec(src)?.[1] ?? '';
            return [...body.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
        },
    },
    {
        // The save serializer builds the wire object key by key. A key it does
        // not name is a key the editor silently never saves, which is the exact
        // failure this gate was written after.
        file: 'app/lib/editor/serialize-template.ts',
        keys: () => {
            const src = withoutComments(read('app/lib/editor/serialize-template.ts'));
            const fn = /export function serializeItemForSave\([\s\S]*?\n\}/.exec(src)?.[0] ?? '';
            const seeded = /const base: Record<string, unknown> = \{([^}]*)\}/.exec(fn)?.[1] ?? '';
            return [...new Set([
                ...[...seeded.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((m) => m[1]),
                ...[...fn.matchAll(/\bbase\.([A-Za-z][A-Za-z0-9]*)\s*=/g)].map((m) => m[1]),
            ])];
        },
    },
    {
        file: 'app/components/template/types.ts',
        keys: () => directMembers(read('app/components/template/types.ts'), 'export interface TemplateItem {'),
    },
    {
        file: 'app/components/form/FormField.tsx',
        keys: () => directMembers(read('app/components/form/FormField.tsx'), 'export interface TemplateItem {'),
    },
    {
        file: 'server/services/inspection/report-schema-types.ts',
        keys: () => directMembers(read('server/services/inspection/report-schema-types.ts'), 'export interface SchemaItem {'),
    },
];

/** Pure comparator — exported so a spec can prove it rejects and accepts. */
export function compareKeySets({ authority, mirror }) {
    if (!authority || authority.length === 0) {
        throw new Error('authority key set is empty — the TemplateItem parser matched nothing');
    }
    if (!mirror.keys || mirror.keys.length === 0) {
        throw new Error(`mirror ${mirror.name} key set is empty — its parser matched nothing`);
    }
    const problems = [];
    const have = new Set(mirror.keys);
    const skips = mirror.skips ?? {};
    for (const key of authority) {
        if (have.has(key) || key in skips) continue;
        problems.push(`${mirror.name}: missing '${key}' with no declared reason`);
    }
    const known = new Set(authority);
    for (const key of mirror.keys) {
        if (!known.has(key)) problems.push(`${mirror.name}: has '${key}', which TemplateItem does not`);
    }
    return problems;
}

function main() {
    const authority = authorityKeys();
    const problems = [];
    let compared = 0;
    for (const mirror of MIRRORS) {
        let keys;
        try {
            keys = mirror.keys();
        } catch (err) {
            problems.push(`${mirror.file}: could not be read — ${err.message}`);
            continue;
        }
        const skips = DECLARED_SKIPS[mirror.file] ?? {};
        compared += 1;
        for (const [key, reason] of Object.entries(skips)) {
            console.log(`  skip  ${mirror.file}  '${key}'  — ${reason}`);
        }
        try {
            problems.push(...compareKeySets({ authority, mirror: { name: mirror.file, keys, skips } }));
        } catch (err) {
            problems.push(err.message);
        }
    }
    // BOTH numbers, side by side, every run.
    console.log(`item-key-parity: ${authority.length} authority keys × ${compared} mirrors compared`);
    for (const p of problems) console.error(`FAIL: ${p}`);
    // A mirror that could not be read is its own failure, and a separate one:
    // "five of six agree" is not a pass, it is five sixths of an answer.
    if (compared !== MIRRORS.length) {
        console.error(`FAIL: compared ${compared} of ${MIRRORS.length} mirrors`);
        process.exit(1);
    }
    if (problems.length) process.exit(1);
    console.log('item-key-parity: OK');
}

if (process.argv[1] && process.argv[1].endsWith('check-item-key-parity.mjs')) main();
