/**
 * What the native routes actually return, against what the committed contract documents.
 *
 * Each covered operation (reads, then the cheap writes) is requested through the real application as a
 * staff owner (or a native grant for /api/client), and its JSON body is walked against the response schema
 * of the status the operation answers in contracts/native-contract.openapi.json. Asked of every body:
 *  - is a documented required key missing, or a value of the wrong type? (never allowed)
 *  - does it hold a key the schema does not declare? (only if recorded in
 *    ../helpers/undeclared-response-keys.allowlist.json, which may only shrink)
 *  - were the arrays of objects really walked? (a route whose lists were all empty proves nothing)
 *
 * Controls: the walker is run on synthetic bodies, the checker is run with one entry removed, and a count of
 * operations that answered with a non-empty body keeps the suite from passing on nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { NATIVE_CONTRACT } from '../../../scripts/lib/native-contract-registry';
import { compareToSchema, declaredObjectArrays } from '../helpers/response-shape';
import {
    ALLOW_LIST_PATH, COVERED_KEYS, OPERATIONS, contract, checkConformance, observeAll, opKey, type AllowEntry, type Observation,
} from '../helpers/response-conformance';
import { EMPTY_OK, NOT_COVERED } from '../helpers/response-conformance-skips';

const allowList: AllowEntry[] = JSON.parse(readFileSync(ALLOW_LIST_PATH, 'utf-8'));
const MIN_EXERCISED = 8;

let observed: Observation[] = [];
beforeAll(async () => { observed = await observeAll(); }, 120_000);

const name = (o: Observation): string => opKey(o.method, o.path);
const walkedElements = (o: Observation): number[] => Object.values(o.elements);

describe('native response conformance', () => {
    it('every covered operation answers its expected status with a declared JSON body', () => {
        expect(observed.length).toBe(OPERATIONS.length);
        for (const o of observed) {
            expect(o.status, name(o)).toBe(o.expected);
            expect(o.declared, `${name(o)} declares no JSON body for ${o.expected}`).toBe(true);
            expect(o.contentType, name(o)).toContain('application/json');
        }
    });

    it('a snapshot stored as a JSON-encoded string is served as an object by the single read and the staff report payload', () => {
        const withSnapshot = observed.filter((o) => o.snapshot !== undefined);
        expect(withSnapshot.map(name).sort()).toEqual(['GET /api/inspections/{id}', 'GET /api/inspections/{id}/report-data']);
        for (const o of withSnapshot) {
            // Control: the row really holds a string, so an object here was made by the route.
            expect(o.snapshot, name(o)).toEqual({ served: 'object', stored: 'string' });
            expect(o.typeMismatch, name(o)).toEqual([]);
        }
    });

    it('no documented required key is missing, no value has the wrong type, no undeclared key is unlisted, no listed key is stale', () => {
        expect(checkConformance(observed, allowList)).toEqual([]);
    });

    it('every array of objects a covered response declares was walked with at least one element, or is listed in EMPTY_OK', () => {
        const empty = observed.flatMap((o) => o.arrays.filter((p) => (o.elements[p] ?? 0) === 0).map((p) => `${name(o)}::${p}`));
        expect(empty.filter((k) => !(k in EMPTY_OK))).toEqual([]);
        // An EMPTY_OK entry whose array is now filled, or no longer declared, must go.
        expect(Object.keys(EMPTY_OK).filter((k) => !empty.includes(k))).toEqual([]);
    });

    it('the allow-list file is sorted by operation and location, and its keys are sorted', () => {
        const order = allowList.map((e) => `${e.method} ${e.path} ${e.at}`);
        expect(order).toEqual([...order].sort());
        for (const e of allowList) expect(e.keys).toEqual([...e.keys].sort());
    });

    it('control: a handful of operations answered with a non-empty body, and several lists were really walked', () => {
        const exercised = observed.filter((o) => o.status === o.expected && o.declared && o.bodyKeys > 0);
        expect(exercised.length).toBeGreaterThanOrEqual(MIN_EXERCISED);
        expect(exercised.length).toBe(OPERATIONS.length);
        expect(observed.filter((o) => walkedElements(o).some((n) => n > 0)).length).toBeGreaterThanOrEqual(MIN_EXERCISED);
    });

    it('control: removing an allow-list entry makes the check fail, and so does a stale, weak or duplicate one', () => {
        expect(allowList.length).toBeGreaterThan(0);
        const problems = checkConformance(observed, allowList.slice(1));
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.every((p) => p.startsWith('undeclared key not listed'))).toBe(true);
        const stale: AllowEntry[] = [...allowList, { method: 'get', path: '/api/tags', at: 'data[]', keys: ['notReturned'], reason: 'a key the route no longer returns at all' }];
        expect(checkConformance(observed, stale).some((p) => p.startsWith('stale entry'))).toBe(true);
        const weak = allowList.map((e, i) => (i === 0 ? { ...e, reason: 'todo' } : e));
        expect(checkConformance(observed, weak).some((p) => p.startsWith('reason too short'))).toBe(true);
        expect(checkConformance(observed, [...allowList, allowList[0] as AllowEntry]).some((p) => p.startsWith('duplicate entry'))).toBe(true);
    });

    it('control: a missing required key and a type mismatch are reported even when the allow-list is complete', () => {
        const base = { method: 'get', path: '/api/tags', expected: 200, status: 200, contentType: 'application/json', declared: true, bodyKeys: 1, extras: [], elements: {}, arrays: [] };
        const missing: Observation = { ...base, missingRequired: ['data'], typeMismatch: [] };
        const wrong: Observation = { ...base, missingRequired: [], typeMismatch: ['data.name'] };
        expect(checkConformance([...observed, missing], allowList)).toEqual(['required key missing: GET /api/tags data']);
        expect(checkConformance([...observed, wrong], allowList)).toEqual(['value does not fit the declared type: GET /api/tags data.name']);
    });

    it('every recorded entry has a specific reason and names a covered operation', () => {
        for (const e of allowList) {
            expect(e.reason.trim().length, `${opKey(e.method, e.path)} @ ${e.at}`).toBeGreaterThanOrEqual(20);
            expect(COVERED_KEYS.has(opKey(e.method, e.path)), opKey(e.method, e.path)).toBe(true);
        }
    });
});

describe('coverage of the registered native operations', () => {
    const registered = NATIVE_CONTRACT.map((e) => opKey(e.method, e.path));

    it('every registered operation is covered or listed in NOT_COVERED, and not both', () => {
        expect(registered.filter((k) => !COVERED_KEYS.has(k) && !(k in NOT_COVERED))).toEqual([]);
        expect(registered.filter((k) => COVERED_KEYS.has(k) && k in NOT_COVERED)).toEqual([]);
    });

    it('every NOT_COVERED and EMPTY_OK entry names a real operation and gives a real reason', () => {
        for (const [k, reason] of Object.entries(NOT_COVERED)) {
            expect(registered, k).toContain(k);
            const [method, path] = k.split(' ');
            expect(contract.paths[path ?? '']?.[(method ?? '').toLowerCase()], `${k} is not in the committed contract`).toBeDefined();
            expect(reason.trim().length, k).toBeGreaterThanOrEqual(20);
        }
        for (const [k, reason] of Object.entries(EMPTY_OK)) {
            expect(COVERED_KEYS.has(k.split('::')[0] ?? ''), `${k} is not a covered operation`).toBe(true);
            expect(reason.trim().length, k).toBeGreaterThanOrEqual(20);
        }
        for (const k of COVERED_KEYS) expect(registered, k).toContain(k);
    });

    it('the remaining list is split by reason, so it reads as a plan', () => {
        expect(new Set(Object.values(NOT_COVERED)).size).toBeGreaterThanOrEqual(3);
    });
});

describe('the response walker', () => {
    const components = {
        Item: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, note: { type: 'string', nullable: true } } },
        Opaque: { type: 'object', additionalProperties: true },
    };
    const schema = {
        type: 'object',
        required: ['success', 'data'],
        properties: {
            success: { type: 'boolean' },
            data: {
                type: 'object',
                required: ['items', 'title'],
                properties: {
                    title: { type: 'string' },
                    items: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
                    blob: { $ref: '#/components/schemas/Opaque' },
                    choice: { anyOf: [{ type: 'null' }, { allOf: [{ $ref: '#/components/schemas/Item' }, { type: 'object', properties: { extra: { type: 'number' } } }] }] },
                },
            },
        },
    };
    const NONE = { extraKeys: [], missingRequired: [], typeMismatch: [] };

    it('reports exactly one extra key and one missing required key', () => {
        const body = { success: true, data: { items: [{ id: 'a', stray: 1 }, { id: 'b', stray: 2 }], blob: { anything: { goes: 1 } } } };
        expect(compareToSchema(body, schema, components)).toMatchObject({ extraKeys: ['data.items[].stray'], missingRequired: ['data.title'], typeMismatch: [] });
    });

    it('reports nothing for a body that matches, nullable values and opaque nodes included, and counts the elements it walked', () => {
        const body = { success: true, data: { title: 't', items: [{ id: 'a', note: null }], blob: { x: [1, { y: 1 }] }, choice: null } };
        expect(compareToSchema(body, schema, components)).toMatchObject({ ...NONE, elements: { 'data.items[]': 1 } });
        expect(compareToSchema({ success: true, data: { title: 't', items: [] } }, schema, components).elements).toEqual({ 'data.items[]': 0 });
    });

    it('judges a union by its best-fitting branch, and reports a key only another branch declares', () => {
        const declared = { success: true, data: { title: 't', items: [], choice: { id: 'c', extra: 3 } } };
        expect(compareToSchema(declared, schema, components).extraKeys).toEqual([]);
        const undeclared = { success: true, data: { title: 't', items: [], choice: { id: 'c', other: 3 } } };
        expect(compareToSchema(undeclared, schema, components).extraKeys).toEqual(['data.choice.other']);
    });

    it('picks the branch whose discriminator matches, so a key of the other branch is undeclared', () => {
        const union = {
            oneOf: [
                { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['a'] }, onlyA: { type: 'string' } } },
                { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['b'] }, onlyB: { type: 'string' } } },
            ],
        };
        expect(compareToSchema({ kind: 'b', onlyB: 'x' }, union, {})).toMatchObject(NONE);
        expect(compareToSchema({ kind: 'b', onlyA: 'x' }, union, {})).toMatchObject({ extraKeys: ['onlyA'], missingRequired: [] });
    });

    it('lets a body that fits an opaque branch through without extra keys', () => {
        const union = { anyOf: [{ type: 'object', properties: { id: { type: 'string' } } }, { type: 'object', additionalProperties: true }] };
        expect(compareToSchema({ id: 'x', anything: 1 }, union, {})).toMatchObject(NONE);
        expect(compareToSchema({ anything: 1 }, union, {})).toMatchObject(NONE);
    });

    it('reports a value that fits no type or no branch, and never counts it as an extra key', () => {
        expect(compareToSchema({ title: 5 }, { type: 'object', properties: { title: { type: 'string' } } }, {})).toMatchObject({ typeMismatch: ['title'], extraKeys: [] });
        expect(compareToSchema(null, { type: 'object', properties: { a: { type: 'string' } } }, {}).typeMismatch).toEqual(['$']);
        expect(compareToSchema({ n: 1.5, i: 2 }, { type: 'object', properties: { n: { type: 'number' }, i: { type: 'integer' } } }, {}).typeMismatch).toEqual([]);
        const union = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
        expect(compareToSchema({ v: { a: 1 } }, { type: 'object', properties: { v: union } }, {}).typeMismatch).toEqual(['v']);
    });

    it('walks the properties next to a union once, so the enclosing keys are declared in every branch', () => {
        const mixed = {
            type: 'object',
            properties: { shared: { type: 'string' } },
            required: ['shared'],
            anyOf: [{ type: 'object', properties: { left: { type: 'string' } } }, { type: 'object', properties: { right: { type: 'string' } } }],
        };
        expect(compareToSchema({ shared: 's', left: 'l' }, mixed, {})).toMatchObject(NONE);
        expect(compareToSchema({ left: 'l' }, mixed, {}).missingRequired).toEqual(['shared']);
        expect(compareToSchema({ shared: 's', stray: 1 }, mixed, {}).extraKeys).toEqual(['stray']);
    });

    it('refuses to fold two unions it would have to drop one of', () => {
        const twice = { allOf: [{ anyOf: [{ type: 'string' }] }, { anyOf: [{ type: 'number' }] }] };
        expect(() => compareToSchema('x', twice, {})).toThrow(/union/);
    });

    it('reports a null that fits no branch, and passes one that a branch allows', () => {
        const strict = { type: 'object', properties: { v: { anyOf: [{ type: 'string' }, { type: 'number' }] } } };
        expect(compareToSchema({ v: null }, strict, {}).typeMismatch).toEqual(['v']);
        const lenient = { type: 'object', properties: { v: { anyOf: [{ type: 'string' }, { type: 'null' }] } } };
        expect(compareToSchema({ v: null }, lenient, {}).typeMismatch).toEqual([]);
        expect(compareToSchema({}, strict, {}).typeMismatch).toEqual([]);
    });

    it('builds the enclosing node of a union from required keys alone', () => {
        const required = { required: ['a'], anyOf: [{ type: 'object', properties: { b: { type: 'string' } } }] };
        expect(compareToSchema({}, required, {}).missingRequired).toEqual(['a']);
        expect(compareToSchema({ a: 1, b: 'x' }, required, {})).toMatchObject({ missingRequired: [], extraKeys: ['a'] });
    });

    it('counts an array as an array of objects only when some branch of its items is an object', () => {
        const strings = { type: 'object', properties: { list: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] } } } };
        expect(compareToSchema({ list: [] }, strings, {}).elements).toEqual({});
        expect(declaredObjectArrays(strings, {})).toEqual([]);
        const objects = { type: 'object', properties: { list: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { id: { type: 'string' } } }] } } } };
        expect(compareToSchema({ list: [] }, objects, {}).elements).toEqual({ 'list[]': 0 });
        expect(declaredObjectArrays(objects, {})).toEqual(['list[]']);
    });

    it('reports an extra key that contains a dot at the object it sits in', () => {
        const found = compareToSchema({ inner: { 'a.b': 1 } }, { type: 'object', properties: { inner: { type: 'object', properties: { id: { type: 'string' } } } } }, {});
        expect(found.extras).toEqual([{ at: 'inner', key: 'a.b' }]);
        expect(compareToSchema({ 'x.y': 1 }, { type: 'object', properties: { id: { type: 'string' } } }, {}).extras).toEqual([{ at: '$', key: 'x.y' }]);
    });

    it('holds an integer to a whole number', () => {
        const ints = { type: 'object', properties: { n: { type: 'integer' } } };
        expect(compareToSchema({ n: 1.5 }, ints, {}).typeMismatch).toEqual(['n']);
        expect(compareToSchema({ n: 2 }, ints, {}).typeMismatch).toEqual([]);
    });

    it('does not let a plain enum on one branch flip the choice of branch, but does let a shared tag', () => {
        const plain = {
            anyOf: [
                { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed'] }, a: { type: 'string' } } },
                { type: 'object', properties: { b: { type: 'string' } } },
            ],
        };
        expect(compareToSchema({ status: 'other', a: 'x' }, plain, {}).extraKeys).toEqual([]);
        const tagged = {
            anyOf: [
                { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed'] }, a: { type: 'string' } } },
                { type: 'object', properties: { status: { type: 'string', enum: ['draft'] }, b: { type: 'string' } } },
            ],
        };
        expect(compareToSchema({ status: 'draft', a: 'x' }, tagged, {}).extraKeys).toEqual(['a']);
    });

    it('reports a string that is not one of the listed enum values, and passes one that is', () => {
        const schema = {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['open', 'closed'] },
                kind: { type: 'string', nullable: true, enum: ['a'] },
                tags: { type: 'array', items: { type: 'string', enum: ['x', 'y'] } },
                fixed: { type: 'string', const: 'only' },
            },
        };
        expect(compareToSchema({ status: 'open', kind: null, tags: ['x'], fixed: 'only' }, schema, {}).typeMismatch).toEqual([]);
        expect(compareToSchema({ status: 'draft' }, schema, {}).typeMismatch).toEqual(['status']);
        expect(compareToSchema({ tags: ['x', 'z'] }, schema, {}).typeMismatch).toEqual(['tags[]']);
        expect(compareToSchema({ fixed: 'other' }, schema, {}).typeMismatch).toEqual(['fixed']);
        // A null, or a key the body leaves out, is not a miss; formats are not checked.
        expect(compareToSchema({ kind: null }, schema, {}).typeMismatch).toEqual([]);
        expect(compareToSchema({}, schema, {}).typeMismatch).toEqual([]);
    });

    it('lists the declared arrays of objects, follows map values and unions, and survives a cycle', () => {
        const components = {
            Node: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } },
            Row: { type: 'object', properties: { id: { type: 'string' } } },
        };
        const root = {
            type: 'object',
            properties: {
                data: { type: 'object', properties: { rows: { type: 'array', items: { $ref: '#/components/schemas/Row' } }, tree: { $ref: '#/components/schemas/Node' } } },
                byKey: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/Row' } } },
                either: { oneOf: [{ type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } }, { type: 'null' }] },
                names: { type: 'array', items: { type: 'string' } },
            },
        };
        expect(declaredObjectArrays(root, components)).toEqual(['byKey.*[]', 'data.rows[]', 'data.tree.children[]', 'either[]']);
    });
});
