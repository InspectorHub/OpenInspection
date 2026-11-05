/**
 * Compares a JSON response body with a JSON Schema taken from the committed native contract.
 *
 * Pure: it reads nothing and writes nothing. The body is what `res.json()` returns, so it only
 * ever holds plain values. The schema is the OpenAPI 3.x subset @hono/zod-openapi emits:
 * `$ref` into `#/components/schemas`, `allOf`, `anyOf`/`oneOf`, `nullable` and type arrays,
 * `items`, `properties`/`required` and `additionalProperties`. Formats and numeric limits are
 * ignored: this is a question about KEYS and TYPES, with one exception for values. A string whose schema
 * lists `enum` or `const` values must be one of them, or its path is reported as a mismatch. Formats
 * (date-time, email, uri and the like) are not checked.
 *
 * Paths read `data.inspection.tenantId`; an array element collapses to `[]` (`data.items[].foo`)
 * and a key of a map-shaped object to `.*`. Each distinct path is reported once.
 *
 * Opaque nodes (`additionalProperties: true`, an empty schema, an object with no declared
 * properties) are never searched for extra keys. A union with a free-form branch is therefore not
 * checked for extra keys either: that branch accepts them, which is what the schema says.
 *
 * `elements` counts, for every array of objects the walk reached, how many elements it held, so a
 * caller can tell a list that was really walked from one that was empty and therefore proved nothing.
 * `declaredObjectArrays` lists the same paths from the schema alone.
 */

export interface ShapeProblems {
    /** Keys the body returns that the schema does not declare, as display paths (`data.inspection.tenantId`). */
    extraKeys: string[];
    /** The same keys as the object they sit in (`$` is the root) and the key itself, which may contain a dot. */
    extras: Array<{ at: string; key: string }>;
    /** Keys the schema lists as required that the body does not return. */
    missingRequired: string[];
    /** Paths whose value does not fit the declared type, or fits no branch of a union (`$` is the root). */
    typeMismatch: string[];
    /** Array-of-object path (`data[]`) to the number of elements walked there. */
    elements: Record<string, number>;
}

interface Collected {
    extra: Map<string, { at: string; key: string }>;
    missing: Set<string>;
    mismatch: Set<string>;
    elements: Map<string, number>;
}

type ValueKind = 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean';

const REF_PREFIX = '#/components/schemas/';
const MAX_DEPTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): ValueKind {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
}

function join(path: string, key: string): string {
    return path === '' ? key : `${path}.${key}`;
}

/** A single schema node with `$ref` followed and `allOf` folded in. */
interface Node {
    types: string[] | null;
    nullable: boolean;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: unknown;
    items: unknown;
    branches: unknown[] | null;
    enumValues: unknown[] | null;
    /** True when nothing at all is said about the shape. */
    empty: boolean;
}

function resolveRef(ref: string, components: Record<string, unknown>): unknown {
    if (!ref.startsWith(REF_PREFIX)) throw new Error(`Unsupported $ref: ${ref}`);
    const target = components[ref.slice(REF_PREFIX.length)];
    if (target === undefined) throw new Error(`Unresolved $ref: ${ref}`);
    return target;
}

function typesOf(schema: Record<string, unknown>): { types: string[] | null; nullable: boolean } {
    const raw = schema.type;
    let types: string[] | null = null;
    let nullable = schema.nullable === true;
    if (typeof raw === 'string') types = [raw];
    else if (Array.isArray(raw)) types = raw.filter((t): t is string => typeof t === 'string');
    if (types?.includes('null')) {
        nullable = true;
        types = types.filter((t) => t !== 'null');
    }
    return { types, nullable };
}

function enumOf(schema: Record<string, unknown>): unknown[] | null {
    if (Array.isArray(schema.enum)) return schema.enum;
    return 'const' in schema ? [schema.const] : null;
}

/** True when two schema fragments are the same document: the same schema met twice through an extended schema. */
function same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function normalize(schema: unknown, components: Record<string, unknown>, depth = 0): Node {
    const node: Node = {
        types: null, nullable: false, properties: {}, required: [], additionalProperties: undefined, items: undefined,
        branches: null, enumValues: null, empty: true,
    };
    if (!isRecord(schema) || depth > MAX_DEPTH) return node;
    if (typeof schema.$ref === 'string') return normalize(resolveRef(schema.$ref, components), components, depth + 1);

    const own = typesOf(schema);
    node.types = own.types;
    node.nullable = own.nullable;
    if (isRecord(schema.properties)) node.properties = { ...schema.properties };
    if (Array.isArray(schema.required)) node.required = schema.required.filter((k): k is string => typeof k === 'string');
    node.additionalProperties = schema.additionalProperties;
    node.items = schema.items;
    node.enumValues = enumOf(schema);
    node.branches = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null;

    if (Array.isArray(schema.allOf)) {
        for (const part of schema.allOf) {
            const folded = normalize(part, components, depth + 1);
            node.types = node.types ?? folded.types;
            node.nullable = node.nullable || folded.nullable;
            for (const [key, sub] of Object.entries(folded.properties)) {
                node.properties[key] = key in node.properties && !same(node.properties[key], sub) ? { allOf: [node.properties[key], sub] } : sub;
            }
            node.required = [...new Set([...node.required, ...folded.required])];
            node.additionalProperties = node.additionalProperties ?? folded.additionalProperties;
            node.items = node.items !== undefined && folded.items !== undefined && !same(node.items, folded.items) ? { allOf: [node.items, folded.items] } : (node.items ?? folded.items);
            node.enumValues = node.enumValues ?? folded.enumValues;
            if (folded.branches !== null) {
                if (node.branches !== null && !same(node.branches, folded.branches)) throw new Error('Two allOf parts each carry a union; folding them would drop one');
                node.branches = folded.branches;
            }
        }
    }
    node.empty = node.types === null && Object.keys(node.properties).length === 0 && node.items === undefined && node.branches === null
        && node.additionalProperties === undefined;
    return node;
}

function fits(node: Node, value: unknown): boolean {
    const kind = kindOf(value);
    if (kind === 'null') return node.nullable || node.types === null || node.empty;
    if (node.empty) return true;
    if (node.types !== null) {
        if (kind === 'number') {
            if (node.types.includes('number')) return true;
            return node.types.includes('integer') && Number.isInteger(value);
        }
        return node.types.includes(kind);
    }
    if (kind === 'array') return node.items !== undefined || node.branches !== null;
    if (kind === 'object') return Object.keys(node.properties).length > 0 || node.additionalProperties !== undefined || node.branches !== null;
    return node.branches !== null;
}

function newCollected(): Collected {
    return { extra: new Map(), missing: new Set(), mismatch: new Set(), elements: new Map() };
}

function score(c: Collected): number {
    return c.extra.size + c.missing.size + c.mismatch.size;
}

function merge(into: Collected, from: Collected): void {
    for (const [k, v] of from.extra) into.extra.set(k, v);
    for (const k of from.missing) into.missing.add(k);
    for (const k of from.mismatch) into.mismatch.add(k);
    for (const [k, n] of from.elements) into.elements.set(k, (into.elements.get(k) ?? 0) + n);
}

/** Keys every branch of a union declares: only these can carry a plain enum that works as a tag. */
function sharedKeys(branches: readonly Node[]): Set<string> {
    const keys = new Set<string>();
    const first = branches[0];
    if (first === undefined) return keys;
    for (const key of Object.keys(first.properties)) {
        if (branches.every((b) => key in b.properties)) keys.add(key);
    }
    return keys;
}

/**
 * How many tag properties disagree with the value. A tag is a single-value enum or const, or a key every branch
 * declares; an enum on one branch alone is a value constraint, not a tag, and a null value is not a miss.
 */
function discriminatorMisses(node: Node, value: unknown, components: Record<string, unknown>, shared: ReadonlySet<string>): number {
    if (!isRecord(value)) return 0;
    let misses = 0;
    for (const [key, sub] of Object.entries(node.properties)) {
        const actual = value[key];
        if (actual === undefined || actual === null) continue;
        const allowed = normalize(sub, components).enumValues;
        if (allowed === null || !(allowed.length === 1 || shared.has(key))) continue;
        if (!allowed.includes(actual)) misses += 1;
    }
    return misses;
}

function walk(value: unknown, schema: unknown, components: Record<string, unknown>, path: string, out: Collected, depth: number): void {
    if (depth > MAX_DEPTH) return;
    const node = normalize(schema, components);
    if (node.branches !== null) walkBranches(value, node, components, path, out, depth);
    else walkNode(value, node, components, path, out, depth);
}

/** What the enclosing node says next to a union, as a schema of its own; null when it says nothing. */
function enclosingSchema(node: Node): Record<string, unknown> | null {
    const enclosing: Record<string, unknown> = {};
    const hasProperties = Object.keys(node.properties).length > 0;
    if (node.types !== null) enclosing.type = node.types.length === 1 ? node.types[0] : node.types;
    else if (hasProperties) enclosing.type = 'object';
    if (node.nullable) enclosing.nullable = true;
    if (hasProperties) enclosing.properties = node.properties;
    if (node.required.length > 0) enclosing.required = node.required;
    if (node.items !== undefined) enclosing.items = node.items;
    if (node.additionalProperties !== undefined) enclosing.additionalProperties = node.additionalProperties;
    const says = hasProperties || node.required.length > 0 || node.types !== null || node.items !== undefined || node.additionalProperties !== undefined;
    return says ? enclosing : null;
}

/**
 * A union is judged by ONE branch: the best-fitting one (matching tag first, then the fewest problems). Its
 * findings are the union's findings, so a key declared only by another branch is reported. What the enclosing
 * node declares next to the union is folded into every branch, never walked apart.
 */
function walkBranches(value: unknown, node: Node, components: Record<string, unknown>, path: string, out: Collected, depth: number): void {
    const enclosing = enclosingSchema(node);
    const shared = sharedKeys((node.branches ?? []).map((b) => normalize(b, components)));
    let best: { collected: Collected; misses: number } | null = null;
    for (const branch of node.branches ?? []) {
        const candidate = enclosing === null ? branch : { allOf: [enclosing, branch] };
        const folded = normalize(candidate, components);
        if (!fits(folded, value)) continue;
        const collected = newCollected();
        walk(value, candidate, components, path, collected, depth + 1);
        const misses = discriminatorMisses(folded, value, components, shared);
        if (best === null || misses < best.misses || (misses === best.misses && score(collected) < score(best.collected))) best = { collected, misses };
    }
    if (best === null) {
        if (value !== undefined) out.mismatch.add(path === '' ? '$' : path);
        return;
    }
    merge(out, best.collected);
}

/** An object, or a union with at least one branch that is. */
function isObjectLike(node: Node, components: Record<string, unknown>): boolean {
    if (Object.keys(node.properties).length > 0 || (node.types?.includes('object') ?? false)) return true;
    return (node.branches ?? []).some((b) => isObjectLike(normalize(b, components), components));
}

function walkNode(value: unknown, node: Node, components: Record<string, unknown>, path: string, out: Collected, depth: number): void {
    if (value === undefined || node.empty) return;
    if (!fits(node, value)) {
        out.mismatch.add(path === '' ? '$' : path);
        return;
    }
    if (typeof value === 'string' && node.enumValues !== null && !node.enumValues.includes(value)) {
        out.mismatch.add(path === '' ? '$' : path);
        return;
    }
    if (Array.isArray(value)) {
        if (node.items === undefined) return;
        if (isObjectLike(normalize(node.items, components), components)) {
            const at = `${path}[]`;
            out.elements.set(at, (out.elements.get(at) ?? 0) + value.length);
        }
        for (const element of value) walk(element, node.items, components, `${path}[]`, out, depth + 1);
        return;
    }
    if (!isRecord(value)) return;

    const declared = Object.keys(node.properties);
    const extras = node.additionalProperties;
    const opaque = extras === true || (declared.length === 0 && !isRecord(extras));
    for (const key of node.required) {
        if (!(key in value) || value[key] === undefined) out.missing.add(join(path, key));
    }
    for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue;
        if (key in node.properties) {
            walk(child, node.properties[key], components, join(path, key), out, depth + 1);
        } else if (isRecord(extras)) {
            walk(child, extras, components, join(path, '*'), out, depth + 1);
        } else if (!opaque) {
            const at = path === '' ? '$' : path;
            out.extra.set(`${at}\u0000${key}`, { at, key });
        }
    }
}

/** Compares `body` with `schema`; `components` is the contract's `components.schemas`. */
export function compareToSchema(body: unknown, schema: unknown, components: Record<string, unknown>): ShapeProblems {
    const out = newCollected();
    walk(body, schema, components, '', out, 0);
    const display = (e: { at: string; key: string }): string => (e.at === '$' ? e.key : `${e.at}.${e.key}`);
    const extras = [...out.extra.values()].sort((a, b) => (display(a) < display(b) ? -1 : 1));
    return {
        extraKeys: extras.map(display),
        extras,
        missingRequired: [...out.missing].sort(),
        typeMismatch: [...out.mismatch].sort(),
        elements: Object.fromEntries([...out.elements].sort(([a], [b]) => (a < b ? -1 : 1))),
    };
}

/**
 * Every array of objects a schema declares, as the same paths `elements` uses (`data.sections[].items[]`), found by a
 * static walk over properties, items, map values (`.*`) and every branch of a union. A caller can demand that each
 * one was reached with at least one element.
 */
export function declaredObjectArrays(schema: unknown, components: Record<string, unknown>): string[] {
    const found = new Set<string>();
    const open = new Set<string>();
    const visit = (node: unknown, path: string, depth: number): void => {
        if (depth > MAX_DEPTH || !isRecord(node)) return;
        const ref = typeof node.$ref === 'string' ? node.$ref : null;
        if (ref !== null) {
            if (open.has(ref)) return;
            open.add(ref);
        }
        const folded = normalize(node, components);
        for (const [key, sub] of Object.entries(folded.properties)) visit(sub, join(path, key), depth + 1);
        if (isRecord(folded.additionalProperties)) visit(folded.additionalProperties, join(path, '*'), depth + 1);
        if (folded.items !== undefined) {
            if (isObjectLike(normalize(folded.items, components), components)) found.add(`${path}[]`);
            visit(folded.items, `${path}[]`, depth + 1);
        }
        for (const branch of folded.branches ?? []) visit(branch, path, depth + 1);
        if (ref !== null) open.delete(ref);
    };
    visit(schema, '', 0);
    return [...found].sort();
}
