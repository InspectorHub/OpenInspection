/**
 * JSON-Schema dereferencing for MCP tool input schemas.
 *
 * The committed OpenAPI snapshot (openapi-snapshot.json) stores each operation's
 * request schema with `$ref` pointers into the OpenAPI document's
 * `components.schemas` (hono-zod-openapi references named component schemas
 * instead of inlining them). The MCP SDK needs a SELF-CONTAINED schema with no
 * dangling references, so this module:
 *
 *   1. rewrites every `#/components/schemas/X` reference to `#/$defs/X`, and
 *   2. attaches the transitive closure of referenced component schemas under
 *      a `$defs` block.
 *
 * `buildToolInput` additionally folds the operation's path/query parameters and
 * request body into a single object schema and reports which argument names map
 * to the path, the query string, and the JSON body (consumed by the tool
 * handler in inspector-mcp.ts when reconstructing the HTTP request).
 */

import { z } from 'zod';
import { logger } from '../logger';

type JsonObject = Record<string, unknown>;

const COMPONENT_PREFIX = '#/components/schemas/';
const DEFS_PREFIX = '#/$defs/';

function componentRefName(ref: string): string | null {
    return ref.startsWith(COMPONENT_PREFIX) ? ref.slice(COMPONENT_PREFIX.length) : null;
}

function defsRefName(ref: string): string | null {
    return ref.startsWith(DEFS_PREFIX) ? ref.slice(DEFS_PREFIX.length) : null;
}

function isPlainObject(node: unknown): node is JsonObject {
    return !!node && typeof node === 'object' && !Array.isArray(node);
}

/** Collect every `#/components/schemas/X` name reachable from `node`. */
function collectComponentRefs(node: unknown, acc: Set<string>): void {
    if (Array.isArray(node)) {
        for (const n of node) collectComponentRefs(n, acc);
        return;
    }
    if (!isPlainObject(node)) return;
    const ref = node['$ref'];
    if (typeof ref === 'string') {
        const name = componentRefName(ref);
        if (name) acc.add(name);
    }
    for (const [k, v] of Object.entries(node)) {
        if (k === '$ref') continue;
        collectComponentRefs(v, acc);
    }
}

/** Collect every `#/$defs/X` name reachable from `node`. */
function collectDefsRefs(node: unknown, acc: Set<string>): void {
    if (Array.isArray(node)) {
        for (const n of node) collectDefsRefs(n, acc);
        return;
    }
    if (!isPlainObject(node)) return;
    const ref = node['$ref'];
    if (typeof ref === 'string') {
        const name = defsRefName(ref);
        if (name) acc.add(name);
    }
    for (const [k, v] of Object.entries(node)) {
        if (k === '$ref') continue;
        collectDefsRefs(v, acc);
    }
}

/** Deep-clone `node`, rewriting `#/components/schemas/X` refs to `#/$defs/X`. */
function rewriteRefs(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(rewriteRefs);
    if (!isPlainObject(node)) return node;
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') {
            const name = componentRefName(v);
            out[k] = name ? `${DEFS_PREFIX}${name}` : v;
        } else {
            out[k] = rewriteRefs(v);
        }
    }
    return out;
}

/**
 * Expand a seed set of component names to their transitive closure, following
 * `#/components/schemas/X` references inside each component definition.
 */
function transitiveClosure(seed: Set<string>, components: Record<string, unknown>): Set<string> {
    const all = new Set(seed);
    const queue = [...seed];
    while (queue.length > 0) {
        const name = queue.shift() as string;
        const comp = components[name];
        if (comp === undefined) continue;
        const sub = new Set<string>();
        collectComponentRefs(comp, sub);
        for (const s of sub) {
            if (!all.has(s)) {
                all.add(s);
                queue.push(s);
            }
        }
    }
    return all;
}

/** Build a `$defs` block (refs rewritten) for the given component names. */
function buildDefs(names: Set<string>, components: Record<string, unknown>): JsonObject | null {
    if (names.size === 0) return null;
    const defs: JsonObject = {};
    for (const name of names) {
        if (components[name] !== undefined) defs[name] = rewriteRefs(components[name]);
    }
    return Object.keys(defs).length > 0 ? defs : null;
}

/**
 * Produce a self-contained JSON Schema: rewrite `#/components/schemas/X` refs to
 * `#/$defs/X` and attach the transitive closure of referenced component schemas
 * under `$defs`. The result contains no dangling references.
 */
export function makeSelfContained(schema: unknown, components: Record<string, unknown>): JsonObject {
    const seed = new Set<string>();
    collectComponentRefs(schema, seed);
    const closure = transitiveClosure(seed, components);
    const root = (rewriteRefs(schema) as JsonObject) ?? {};
    const defs = buildDefs(closure, components);
    return defs ? { ...root, $defs: defs } : { ...root };
}

/** If `schema` is a pure `{ $ref }` into a component, return the target; else `schema`. */
function dereferenceTop(schema: unknown, components: Record<string, unknown>): unknown {
    if (isPlainObject(schema) && typeof schema['$ref'] === 'string') {
        const name = componentRefName(schema['$ref']);
        if (name && components[name] !== undefined) return components[name];
    }
    return schema;
}

/**
 * Convert a self-contained JSON Schema into a Zod schema for the MCP SDK
 * (SDK 1.29 requires a Zod schema / raw shape — it rejects raw JSON Schema).
 *
 * The snapshot schemas use OpenAPI 3.0 conventions (`nullable: true`), so the
 * `openapi-3.0` target is tried first for correct null handling. That target,
 * however, fails to resolve CHAINED `$defs` references (a `$def` that itself
 * references another `$def` → "Reference not found"); for those schemas the
 * `draft-2020-12` target resolves the refs (at the cost of ignoring `nullable`,
 * which only makes the advisory schema more permissive — the API still
 * validates the payload). A permissive object is the last-resort fallback so a
 * single unrepresentable schema never takes the whole MCP server down.
 */
export function toZodInputSchema(jsonSchema: JsonObject, operationId?: string): z.ZodType {
    const input = jsonSchema as Parameters<typeof z.fromJSONSchema>[0];
    for (const defaultTarget of ['openapi-3.0', 'draft-2020-12'] as const) {
        try {
            return z.fromJSONSchema(input, { defaultTarget });
        } catch {
            // try the next target
        }
    }
    // Both targets failed: the tool stays callable but loses its typed schema.
    logger.warn('MCP tool input schema unrepresentable; using permissive fallback', { operationId });
    return z.object({}).loose();
}

interface RawParameter {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: unknown;
}

interface RawInputSchema {
    parameters?: RawParameter[];
    body?: unknown;
}

export interface ToolInput {
    /** Self-contained JSON Schema (`type: 'object'`) describing the tool arguments. */
    jsonSchema: JsonObject;
    /** Argument names substituted into the URL path template. */
    pathParams: string[];
    /** Argument names appended to the query string. */
    queryParams: string[];
    /** Argument names placed in the JSON request body (write methods). */
    bodyParams: string[];
}

/**
 * Fold an operation's path/query parameters and request body into a single
 * self-contained object schema, and report which argument names map to the
 * path, the query string, and the JSON body.
 *
 * Object-typed bodies are flattened so their fields appear at the top level of
 * the tool arguments; a non-object body (array/primitive/composite) is nested
 * under a single `body` argument.
 */
export function buildToolInput(
    inputSchema: RawInputSchema | undefined,
    components: Record<string, unknown>,
): ToolInput {
    const properties: JsonObject = {};
    const required: string[] = [];
    const pathParams: string[] = [];
    const queryParams: string[] = [];
    const bodyParams: string[] = [];

    for (const p of inputSchema?.parameters ?? []) {
        const sub = (rewriteRefs(p.schema ?? { type: 'string' }) as JsonObject) ?? {};
        if (p.description && typeof sub['description'] !== 'string') sub['description'] = p.description;
        properties[p.name] = sub;
        if (p.required) required.push(p.name);
        if (p.in === 'path') pathParams.push(p.name);
        else queryParams.push(p.name);
    }

    const body = inputSchema?.body;
    if (body) {
        const resolved = dereferenceTop(body, components);
        if (isPlainObject(resolved) && resolved['type'] === 'object' && isPlainObject(resolved['properties'])) {
            const props = resolved['properties'] as JsonObject;
            for (const [k, v] of Object.entries(props)) {
                properties[k] = rewriteRefs(v);
                bodyParams.push(k);
            }
            for (const r of (resolved['required'] as string[] | undefined) ?? []) required.push(r);
        } else {
            properties['body'] = rewriteRefs(body);
            bodyParams.push('body');
        }
    }

    // Seed from the rewritten properties (refs now point at #/$defs/X), then
    // walk the raw component graph to gather every transitively-needed schema.
    const defsSeed = new Set<string>();
    collectDefsRefs(Object.values(properties), defsSeed);
    const closure = transitiveClosure(defsSeed, components);

    const jsonSchema: JsonObject = { type: 'object', properties };
    if (required.length > 0) jsonSchema['required'] = [...new Set(required)];
    const defs = buildDefs(closure, components);
    if (defs) jsonSchema['$defs'] = defs;

    return { jsonSchema, pathParams, queryParams, bodyParams };
}
