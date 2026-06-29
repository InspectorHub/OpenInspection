import { describe, it, expect } from 'vitest';
import { makeSelfContained, buildToolInput, toZodInputSchema } from '../../../server/lib/mcp/resolve-schema';

/** Recursively collect every $ref string in a schema. */
function refs(node: unknown): string[] {
    const out: string[] = [];
    const walk = (n: unknown): void => {
        if (Array.isArray(n)) return void n.forEach(walk);
        if (!n || typeof n !== 'object') return;
        const obj = n as Record<string, unknown>;
        if (typeof obj['$ref'] === 'string') out.push(obj['$ref']);
        for (const [k, v] of Object.entries(obj)) if (k !== '$ref') walk(v);
    };
    walk(node);
    return out;
}

const components: Record<string, unknown> = {
    CreateInspection: {
        type: 'object',
        required: ['propertyAddress', 'templateId'],
        properties: {
            propertyAddress: { type: 'string', minLength: 5, description: 'addr' },
            templateId: { type: 'string', description: 'tid' },
            // Nested $ref proves transitive-closure population of $defs.
            contact: { $ref: '#/components/schemas/Contact' },
        },
    },
    Contact: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            // Another level deep — must also be pulled in.
            address: { $ref: '#/components/schemas/Address' },
        },
    },
    Address: {
        type: 'object',
        properties: { line1: { type: 'string' } },
    },
};

describe('makeSelfContained', () => {
    it('rewrites component refs to $defs and pulls the transitive closure', () => {
        const out = makeSelfContained({ $ref: '#/components/schemas/CreateInspection' }, components);

        // No dangling OpenAPI component references remain.
        expect(refs(out).every((r) => r.startsWith('#/$defs/'))).toBe(true);

        // The whole transitive chain is attached under $defs.
        const defs = (out as { $defs?: Record<string, unknown> }).$defs ?? {};
        expect(Object.keys(defs).sort()).toEqual(['Address', 'Contact', 'CreateInspection']);

        // Every referenced $defs/X actually exists (non-dangling).
        for (const r of refs(out)) {
            const name = r.replace('#/$defs/', '');
            expect(defs).toHaveProperty(name);
        }
    });
});

describe('buildToolInput', () => {
    it('flattens a $ref object body into top-level args with a resolvable schema', () => {
        const entry = {
            parameters: [],
            body: { $ref: '#/components/schemas/CreateInspection' },
        };
        const built = buildToolInput(entry, components);

        // Body object fields are hoisted to the top level and tracked as bodyParams.
        expect(Object.keys(built.jsonSchema.properties as object).sort()).toEqual(
            ['contact', 'propertyAddress', 'templateId'],
        );
        expect(built.bodyParams.sort()).toEqual(['contact', 'propertyAddress', 'templateId']);
        expect(built.pathParams).toEqual([]);
        expect(built.queryParams).toEqual([]);

        // The nested ref survived and points at $defs, with a non-dangling target.
        const text = JSON.stringify(built.jsonSchema);
        expect(text).not.toContain('#/components/schemas/');
        expect(text).toContain('#/$defs/Contact');
        const defs = (built.jsonSchema as { $defs?: Record<string, unknown> }).$defs ?? {};
        expect(defs).toHaveProperty('Contact');
        expect(defs).toHaveProperty('Address');

        // Required from the component body is propagated.
        expect(built.jsonSchema.required).toEqual(['propertyAddress', 'templateId']);

        // The self-contained schema is consumable by the MCP SDK's converter,
        // including the chained $defs reference (Contact → Address).
        const schema = toZodInputSchema(built.jsonSchema);
        const parsed = schema.parse({
            propertyAddress: '123 Main St',
            templateId: 't-1',
            contact: { name: 'Jane', address: { line1: '1 A St' } },
        });
        expect(parsed).toMatchObject({ propertyAddress: '123 Main St', templateId: 't-1' });
    });

    it('keeps path and query params separate and inlines param schemas', () => {
        const entry = {
            parameters: [
                { name: 'id', in: 'path', required: true, description: 'the id', schema: { type: 'string' } },
                { name: 'limit', in: 'query', required: false, description: 'max rows', schema: { type: 'number' } },
            ],
            body: null,
        };
        const built = buildToolInput(entry, components);
        expect(built.pathParams).toEqual(['id']);
        expect(built.queryParams).toEqual(['limit']);
        expect(built.bodyParams).toEqual([]);
        expect(built.jsonSchema.required).toEqual(['id']);
        // No $defs needed when nothing references a component.
        expect(built.jsonSchema).not.toHaveProperty('$defs');
    });
});
