/**
 * No update schema may inject a value the caller did not send.
 *
 * zod's `.partial()` KEEPS a `.default()`: a schema derived from a create
 * schema that defaults a field parses `{}` to an object that already holds that
 * field, and the handler writes it over the stored value. This repo has lost
 * data that way (contact type, event-type delay, label colours).
 *
 * Two independent nets, because neither alone sees everything:
 *
 *  1. EVERY PUT and PATCH request body the real application declares, read from
 *     its generated OpenAPI document, recursively through nested objects, arrays
 *     and `$ref`s. This reaches the schemas defined inline in a route file
 *     (`EventTypeUpdateSchema`, the agreement `.partial()`) and nested partials,
 *     none of which a module export walk can see. A `default` on any property is a
 *     failure unless it is listed below with its reason.
 *  2. Every `Update*` / `Patch*` export of `server/lib/validations` is parsed
 *     with an empty body and must yield an object with no keys. A schema that
 *     REFUSES an empty body is not silently skipped: it must be on an explicit
 *     list with a reason, and a listed schema that stops refusing fails too.
 *
 * Both assert the ABSENCE of a key, never a value.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { app } from '../../../server/index';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import { plainPaths } from '../helpers/openapi-doc';

type Json = Record<string, unknown>;

/** Every `default` found under a JSON schema, as `path = value`, following $ref, allOf/anyOf/oneOf, items and properties. */
function defaultsIn(schema: Json | undefined, components: Record<string, Json>, where: string, seen = new Set<string>()): string[] {
    if (!schema || typeof schema !== 'object') return [];
    const ref = schema.$ref as string | undefined;
    if (ref) {
        const name = ref.split('/').pop() ?? '';
        if (seen.has(name)) return [];
        return defaultsIn(components[name], components, where, new Set([...seen, name]));
    }
    const found: string[] = [];
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
        for (const sub of (schema[key] as Json[] | undefined) ?? []) found.push(...defaultsIn(sub, components, where, seen));
    }
    if (schema.items) found.push(...defaultsIn(schema.items as Json, components, `${where}[]`, seen));
    for (const [name, prop] of Object.entries((schema.properties as Record<string, Json> | undefined) ?? {})) {
        if ('default' in prop) found.push(`${where}.${name} = ${JSON.stringify(prop.default)}`);
        found.push(...defaultsIn(prop, components, `${where}.${name}`, seen));
    }
    return found;
}

function bodyDefaults(doc: { paths?: Record<string, object>; components?: unknown }): { ops: number; defaults: string[] } {
    const components = ((doc.components as Json | undefined)?.schemas ?? {}) as Record<string, Json>;
    let ops = 0;
    const defaults: string[] = [];
    for (const [path, item] of Object.entries(plainPaths(doc))) {
        for (const [method, op] of Object.entries(item)) {
            if (method !== 'put' && method !== 'patch') continue;
            ops++;
            const body = ((((op as Json).requestBody as Json | undefined)?.content as Json | undefined)?.['application/json'] as Json | undefined)?.schema as Json | undefined;
            defaults.push(...defaultsIn(body, components, `${method.toUpperCase()} ${path}`));
        }
    }
    return { ops, defaults };
}

/**
 * Defaults a PUT/PATCH body may legitimately carry. Each one is a default INSIDE an element of an array
 * the request replaces as a whole, so an omitted field in an element being given its default is the
 * request's own content, not an overwrite of something stored that the request never mentioned.
 */
const ALLOWED_BODY_DEFAULTS: Record<string, string> = {
    'PUT /api/rating-systems/{id}.levels[].isDefect = false':
        'the levels array is replaced as a whole; a level that omits isDefect is a level the caller is defining now',
};

describe('PUT and PATCH request bodies (from the real application\'s OpenAPI document)', () => {
    const doc = buildOpenApiDocument(app, { openapi: '3.0.0', info: { version: 'audit', title: 'audit' } });
    const { ops, defaults } = bodyDefaults(doc);

    it('finds the update routes (the walk is not silently empty)', () => {
        expect(ops).toBeGreaterThan(40);
    });

    it('positive control: the walk flags a nested partial that kept a default, and an inline route body', () => {
        const nested = z.object({ inner: z.object({ color: z.string().default('red'), name: z.string() }).partial() }).partial();
        const probe = new OpenAPIHono();
        probe.openapi(createRoute({
            method: 'patch', path: '/x', request: { body: { content: { 'application/json': { schema: nested } } } },
            responses: { 200: { description: 'ok' } },
        }), (c) => c.json({}, 200));
        const found = bodyDefaults(probe.getOpenAPIDocument({ openapi: '3.0.0', info: { version: '1', title: 't' } }));
        expect(found.ops).toBe(1);
        expect(found.defaults).toEqual(['PATCH /x.inner.color = "red"']);
    });

    it('no body carries a default beyond the documented allow-list', () => {
        const unexpected = defaults.filter((d) => !(d in ALLOWED_BODY_DEFAULTS));
        expect(unexpected).toEqual([]);
    });

    it('every allow-listed default still exists (a stale entry hides a future leak)', () => {
        for (const entry of Object.keys(ALLOWED_BODY_DEFAULTS)) expect(defaults).toContain(entry);
    });
});

describe('Update* / Patch* schemas exported from server/lib/validations', () => {
    const modules = import.meta.glob('../../../server/lib/validations/**/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
    const named = Object.entries(modules).flatMap(([file, mod]) =>
        Object.entries(mod)
            .filter(([name, value]) => /(^|[a-z])(Update|Patch)[A-Z]/.test(name) && value instanceof z.ZodType)
            .map(([name, value]) => ({ id: `${file.split('validations/')[1]} :: ${name}`, schema: value as z.ZodType })));

    /** An empty body parsed, or null when it is refused. */
    const parsedKeys = (schema: z.ZodType): string[] | null => {
        const r = schema.safeParse({});
        if (!r.success) return null;
        return r.data && typeof r.data === 'object' ? Object.keys(r.data as object) : [];
    };

    /**
     * Schemas that refuse an empty body, and why that is not a way past the check. A refused empty body
     * cannot inject anything, and a default hiding behind a required field is caught by the OpenAPI walk
     * above for every one of these that is a request body. The entries named `*Response*` are response
     * shapes that merely match the naming pattern.
     */
    const REFUSES_EMPTY: Record<string, string> = {
        'admin.schema.ts :: CommunicationPatchSchema': 'request body with required fields; covered by the OpenAPI walk',
        'admin/settings.ts :: CommunicationPatchSchema': 'request body with required fields; covered by the OpenAPI walk',
        'admin.schema.ts :: AgreementUpdateResponseSchema': 'a response shape, not a request',
        'admin/agreement.ts :: AgreementUpdateResponseSchema': 'a response shape, not a request',
        'admin.schema.ts :: UpdateCommentSchema': 'request body with required fields; covered by the OpenAPI walk',
        'comment.schema.ts :: UpdateCommentSchema': 'request body with required fields; covered by the OpenAPI walk',
        'agent.schema.ts :: AgentProfilePatchResponseSchema': 'a response shape, not a request',
        'inspection.schema.ts :: PatchInspectionResponseSchema': 'a response shape, not a request',
        'inspection/crud.ts :: PatchInspectionResponseSchema': 'a response shape, not a request',
        'calendar-blocks.schema.ts :: UpdateCalendarBlockSchema': 'request body with required fields; covered by the OpenAPI walk',
        'media.schema.ts :: UpdateMediaAnnotationsSchema': 'request body with required fields; covered by the OpenAPI walk',
        'report-narrative.schema.ts :: ReportNarrativePatchSchema': 'request body with required fields; covered by the OpenAPI walk',
        'schedule.schema.ts :: ReschedulePatchSchema': 'request body with required fields; covered by the OpenAPI walk',
        'service.schema.ts :: UpdateInspectionServiceSchema': 'request body with required fields; covered by the OpenAPI walk',
        'service.schema.ts :: UpdatePayRuleSchema': 'request body with required fields; covered by the OpenAPI walk',
    };

    it('finds the update schemas (the walk is not silently empty)', () => {
        expect(named.length).toBeGreaterThan(30);
        expect(named.map((s) => s.id)).toContain('contact.schema.ts :: UpdateContactSchema');
    });

    it('positive control: the probe flags a `.partial()` that kept a default', () => {
        const leaky = z.object({ type: z.string().default('client'), name: z.string() }).partial();
        expect(parsedKeys(leaky)).toEqual(['type']);
    });

    it('every schema that refuses an empty body is on the explicit list, and every listed one still refuses', () => {
        const refusing = named.filter((s) => parsedKeys(s.schema) === null).map((s) => s.id).sort();
        expect(refusing).toEqual(Object.keys(REFUSES_EMPTY).sort());
    });

    it.each(named.map((s) => [s.id, s.schema] as const))('%s adds no key to an empty body', (id, schema) => {
        const keys = parsedKeys(schema);
        if (keys === null) return; // refuses {}: accounted for by the list above, not skipped silently
        expect(keys, id).toEqual([]);
    });
});
