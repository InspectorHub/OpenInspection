/**
 * enrichDescriptions — appends schema-derived FACTS to hand-written input
 * descriptions in an OpenAPI document.
 *
 * Division of labour: a person writes what a field or route is FOR; this module
 * states what the schema already says about its SHAPE (length, range, enum,
 * default, format), so that half of a description cannot drift from the zod
 * schema it was read from.
 *
 * Three rules keep it from becoming boilerplate:
 *   1. It only ever appends to a description that is already semantic, meaning
 *      non-placeholder and at least MIN_FIELD_DESCRIPTION_CHARS long on its own.
 *      A short or placeholder text is returned untouched, so the suffix can never
 *      lift a description over the length floor; the route-metadata gate keeps
 *      catching exactly what it caught before.
 *   2. It never writes a description where there is none. The single exception
 *      is a path parameter named `id`, whose meaning is fully determined by the
 *      route (`/contacts/{id}`), and only when the entity name can be derived by
 *      a conservative rule.
 *   3. A fact the prose already states is not repeated (see `covered`), which
 *      also makes the function idempotent.
 *
 * Pure and WinterCG-safe: it never writes to its input and returns a copy that
 * shares the subtrees it did not change.
 */
import { allFacts, appendFacts, isPlaceholderDescription, isRec, isSemantic, type Json } from './enrich-facts';

export { isPlaceholderDescription };

const COMPONENT_PREFIX = '#/components/schemas/';

// ---------------------------------------------------------------------------
// Path-parameter derivation
// ---------------------------------------------------------------------------

/** Surfaces where "the caller's company" is not the owner of the id. */
const NO_COMPANY_SEGMENTS: ReadonlySet<string> = new Set(['public', 'agent', 'portal', 'webhooks', 'mcp', 'unsubscribe', 'client']);
/** Look plural to the suffix rules but are not. */
const NOT_PLURAL: ReadonlySet<string> = new Set(['series', 'species', 'news']);

function singularize(word: string): string | undefined {
    if (!/^[a-z]+$/.test(word) || NOT_PLURAL.has(word)) return undefined;
    if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
    if (!word.endsWith('s')) return undefined;
    if (word.endsWith('es')) {
        // "types" -> "type", but "statuses", "boxes", "batches", "leaves", "heroes" need a dictionary.
        const before = word.charAt(word.length - 3);
        if ('sxzhvo'.includes(before) || word.length < 5) return undefined;
        return word.slice(0, -1);
    }
    const before = word.charAt(word.length - 2);
    if ('sui'.includes(before) || word.length < 4) return undefined;
    return word.slice(0, -1);
}

/** "Id of the contact. Must belong to the caller's company." — or undefined when the path does not say so safely. */
function derivePathIdDescription(pathTemplate: string): string | undefined {
    const segments = pathTemplate.split('/').filter(Boolean);
    if (segments.filter((s) => s === '{id}').length !== 1) return undefined;
    if (segments.some((s) => NO_COMPANY_SEGMENTS.has(s))) return undefined;
    const prev = segments[segments.indexOf('{id}') - 1];
    if (prev === undefined || prev.startsWith('{') || prev === 'api') return undefined;
    const words = prev.split('-');
    const last = words.pop();
    const singular = last === undefined ? undefined : singularize(last);
    if (singular === undefined) return undefined;
    const entity = [...words, singular].join(' ');
    return `Id of the ${entity}. Must belong to the caller's company.`;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

interface Ctx {
    schemas: Json | undefined;
    seen: Set<string>;
    /** Component schemas the walk rewrote, by name. */
    changed: Record<string, unknown>;
}

/**
 * Copy-on-write: every function below returns the node it was given when nothing
 * under it changed, and a shallow copy of just the changed spine otherwise. The
 * input is never written to, and an untouched subtree is shared with it rather
 * than cloned (the ~1.2 MB document is almost entirely untouched).
 */
function enrichNode(node: Json, name: string | undefined): Json {
    const d = node['description'];
    if (!isSemantic(d)) return node;
    const next = appendFacts(d, allFacts(node, name));
    return next === d ? node : { ...node, description: next };
}

/** Returns `node` itself, or a copy with `key` replaced when `value` differs. */
function withKey(node: Json, key: string, value: unknown): Json {
    return node[key] === value ? node : { ...node, [key]: value };
}

function walkProperties(map: Json, ctx: Ctx): Json {
    let out: Json | undefined;
    for (const [key, sub] of Object.entries(map)) {
        const next = walkSchema(sub, key, ctx);
        if (next !== sub) (out ??= { ...map })[key] = next;
    }
    return out ?? map;
}

function walkSchema(node: unknown, name: string | undefined, ctx: Ctx): unknown {
    if (!isRec(node)) return node;
    const ref = node['$ref'];
    if (typeof ref === 'string') {
        if (!ref.startsWith(COMPONENT_PREFIX)) return node;
        const target = ref.slice(COMPONENT_PREFIX.length);
        if (ctx.seen.has(target)) return node;
        ctx.seen.add(target);
        const original = ctx.schemas?.[target];
        const next = walkSchema(original, undefined, ctx);
        if (next !== original) ctx.changed[target] = next;
        return node;
    }
    let out = enrichNode(node, name);
    const properties = out['properties'];
    if (isRec(properties)) out = withKey(out, 'properties', walkProperties(properties, ctx));
    for (const key of ['items', 'additionalProperties']) {
        const sub = out[key];
        if (sub !== undefined) out = withKey(out, key, walkSchema(sub, undefined, ctx));
    }
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
        const variants = out[key];
        if (!Array.isArray(variants)) continue;
        let copy: unknown[] | undefined;
        variants.forEach((v: unknown, i) => {
            const next = walkSchema(v, undefined, ctx);
            if (next !== v) (copy ??= [...variants])[i] = next;
        });
        if (copy) out = withKey(out, key, copy);
    }
    return out;
}

function enrichParameter(param: unknown, pathTemplate: string, ctx: Ctx): unknown {
    if (!isRec(param) || typeof param['name'] !== 'string') return param;
    const name = param['name'];
    const original = isRec(param['schema']) ? param['schema'] : undefined;
    const description = param['description'];

    // The schema first: a description derived below must not then be enriched.
    const schema = original ? (walkSchema(original, name, ctx) as Json) : undefined;
    let out: Json = param;
    if (schema !== original) out = withKey(out, 'schema', schema);
    if (isSemantic(description)) {
        out = withKey(out, 'description', appendFacts(description, allFacts(schema ?? {}, name)));
    } else if (isPlaceholderDescription(description) && param['in'] === 'path' && name === 'id') {
        const derived = derivePathIdDescription(pathTemplate);
        if (derived !== undefined) {
            out = withKey(out, 'description', derived);
            if (schema && isPlaceholderDescription(schema['description'])) {
                out = withKey(out, 'schema', { ...schema, description: derived });
            }
        }
    }
    return out;
}

function enrichParameters(parameters: unknown[], pathTemplate: string, ctx: Ctx): unknown[] {
    let copy: unknown[] | undefined;
    parameters.forEach((p, i) => {
        const next = enrichParameter(p, pathTemplate, ctx);
        if (next !== p) (copy ??= [...parameters])[i] = next;
    });
    return copy ?? parameters;
}

function enrichOperation(op: unknown, pathTemplate: string, ctx: Ctx): unknown {
    if (!isRec(op)) return op;
    let out: Json = op;
    const parameters = op['parameters'];
    if (Array.isArray(parameters)) out = withKey(out, 'parameters', enrichParameters(parameters, pathTemplate, ctx));
    const body = op['requestBody'];
    const content = isRec(body) ? body['content'] : undefined;
    if (isRec(body) && isRec(content)) {
        let newContent: Json | undefined;
        for (const [type, media] of Object.entries(content)) {
            if (!isRec(media)) continue;
            const next = withKey(media, 'schema', walkSchema(media['schema'], undefined, ctx));
            if (next !== media) (newContent ??= { ...content })[type] = next;
        }
        if (newContent) out = withKey(out, 'requestBody', { ...body, content: newContent });
    }
    return out;
}

const OPERATION_KEYS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

/**
 * Returns a copy of `doc` whose input descriptions carry schema-derived facts.
 * Only request inputs are touched: parameters, request bodies, and the
 * `components.schemas` those bodies reach through `$ref`. The copy shares every
 * unchanged subtree with `doc`; treat both as read-only.
 */
export function enrichDescriptions<T extends object>(doc: T): T {
    const root: unknown = doc;
    if (!isRec(root)) return doc;
    const components = root['components'];
    const schemas = isRec(components) && isRec(components['schemas']) ? components['schemas'] : undefined;
    const ctx: Ctx = { schemas, seen: new Set(), changed: {} };
    const paths = root['paths'];
    let newPaths: Json | undefined;
    if (isRec(paths)) {
        for (const [pathTemplate, item] of Object.entries(paths)) {
            if (!isRec(item)) continue;
            let out: Json = item;
            const shared = item['parameters'];
            if (Array.isArray(shared)) out = withKey(out, 'parameters', enrichParameters(shared, pathTemplate, ctx));
            for (const method of OPERATION_KEYS) out = withKey(out, method, enrichOperation(item[method], pathTemplate, ctx));
            if (out !== item) (newPaths ??= { ...paths })[pathTemplate] = out;
        }
    }
    const result: Json = { ...root };
    if (newPaths) result['paths'] = newPaths;
    if (schemas && isRec(components) && Object.keys(ctx.changed).length > 0) {
        result['components'] = { ...components, schemas: { ...schemas, ...ctx.changed } };
    }
    return result as T;
}
