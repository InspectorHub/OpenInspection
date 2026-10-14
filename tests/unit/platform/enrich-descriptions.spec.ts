/**
 * enrichDescriptions — appends schema-derived facts to HAND-WRITTEN field
 * descriptions, and derives the one safe path-parameter description.
 *
 * The two guarantees worth defending are negative ones: a field with no
 * semantic description never receives a facts-only description, and a short
 * semantic text is never lengthened past the route-metadata floor by its suffix.
 * Each negative assertion has a positive control beside it.
 */
import { describe, it, expect } from 'vitest';
import { enrichDescriptions, isPlaceholderDescription } from '../../../server/lib/openapi/enrich-descriptions';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import { MIN_FIELD_DESCRIPTION_CHARS } from '../../../server/lib/route-metadata-standards';

type Obj = Record<string, unknown>;

/** Wrap one body schema in a minimal document. */
function bodyDoc(schema: Obj, path = '/api/widgets', extra: Obj = {}): Obj {
    return {
        openapi: '3.0.0',
        paths: {
            [path]: {
                post: {
                    operationId: 'op',
                    requestBody: { content: { 'application/json': { schema } } },
                    ...extra,
                },
            },
        },
        components: { schemas: {} },
    };
}

function props(doc: Obj): Record<string, Obj> {
    const body = ((doc['paths'] as Obj)['/api/widgets'] as Obj)['post'] as Obj;
    const content = (body['requestBody'] as Obj)['content'] as Obj;
    return ((content['application/json'] as Obj)['schema'] as Obj)['properties'] as Record<string, Obj>;
}

function describe1(field: Obj, name = 'field'): string {
    const out = enrichDescriptions(bodyDoc({ type: 'object', properties: { [name]: field } }));
    return props(out)[name]?.['description'] as string;
}

const BASE = 'Display name shown to clients';

describe('enrichDescriptions: keywords', () => {
    it('renders string length bounds', () => {
        expect(describe1({ type: 'string', description: BASE, minLength: 1, maxLength: 200 })).toBe(`${BASE}. 1-200 characters.`);
        expect(describe1({ type: 'string', description: BASE, maxLength: 80 })).toBe(`${BASE}. Up to 80 characters.`);
        expect(describe1({ type: 'string', description: BASE, minLength: 3 })).toBe(`${BASE}. At least 3 characters.`);
        // a lone minLength of 1 is the required flag, not a fact worth a sentence
        expect(describe1({ type: 'string', description: BASE, minLength: 1 })).toBe(BASE);
    });

    it('renders numeric ranges and the integer type', () => {
        expect(describe1({ type: 'integer', description: BASE, minimum: 1, maximum: 100 })).toBe(`${BASE}. Integer between 1 and 100.`);
        expect(describe1({ type: 'integer', description: BASE, minimum: 0 })).toBe(`${BASE}. Integer, at least 0.`);
        expect(describe1({ type: 'number', description: BASE, maximum: 5 })).toBe(`${BASE}. At most 5.`);
        expect(describe1({ type: 'integer', description: BASE })).toBe(`${BASE}. Integer.`);
        // positive control for "number without bounds says nothing"
        expect(describe1({ type: 'number', description: BASE })).toBe(BASE);
    });

    it('renders array item bounds', () => {
        expect(describe1({ type: 'array', items: { type: 'string' }, description: BASE, minItems: 1, maxItems: 10 })).toBe(`${BASE}. 1-10 items.`);
    });

    it('renders enums, defaults and formats', () => {
        expect(describe1({ type: 'string', description: BASE, enum: ['a', 'b', 'c'] })).toBe(`${BASE}. One of: a, b, c.`);
        expect(describe1({ type: 'integer', description: BASE, default: 20 })).toBe(`${BASE}. Integer. Defaults to 20.`);
        expect(describe1({ type: 'boolean', description: BASE, default: false })).toBe(`${BASE}. Defaults to false.`);
        expect(describe1({ type: 'string', description: BASE, format: 'date-time' })).toBe(`${BASE}. ISO 8601 date-time.`);
        expect(describe1({ type: 'string', description: BASE, format: 'date' })).toBe(`${BASE}. Date in YYYY-MM-DD format.`);
        expect(describe1({ type: 'string', description: BASE, format: 'email' })).toBe(`${BASE}. Must be a valid email address.`);
    });

    it('does not render a default that is an object or a long value', () => {
        expect(describe1({ type: 'object', description: BASE, default: { a: 1 } })).toBe(BASE);
        expect(describe1({ type: 'string', description: BASE, default: 'x'.repeat(80) })).toBe(BASE);
    });

    it('does not list an enum longer than the cap', () => {
        const many = Array.from({ length: 25 }, (_, i) => `v${i}`);
        expect(describe1({ type: 'string', description: BASE, enum: many })).toBe(BASE);
    });

    it('uses the *Cents naming convention only when the name says so', () => {
        const withName = describe1({ type: 'integer', description: 'Amount charged', minimum: 0 }, 'amountCents');
        expect(withName).toBe('Amount charged. Integer cents, at least 0.');
        // control: same schema under an ordinary name keeps the plain integer wording
        const plain = describe1({ type: 'integer', description: 'Amount charged', minimum: 0 }, 'amount');
        expect(plain).toBe('Amount charged. Integer, at least 0.');
        expect(describe1({ type: 'integer', description: 'Amount charged' }, 'priceCents')).toBe('Amount charged. Integer cents.');
    });

    it('appends a period to a base that lacks one, and not to one that has it', () => {
        expect(describe1({ type: 'string', description: 'Ends with a period.', maxLength: 5 })).toBe('Ends with a period. Up to 5 characters.');
        expect(describe1({ type: 'string', description: 'Ends with a question?', maxLength: 5 })).toBe('Ends with a question? Up to 5 characters.');
    });
});

describe('enrichDescriptions: idempotence and de-duplication', () => {
    it('is idempotent', () => {
        const doc = bodyDoc({
            type: 'object',
            properties: {
                n: { type: 'integer', description: BASE, minimum: 1, maximum: 9, default: 3 },
                s: { type: 'string', description: BASE, enum: ['x', 'y'], maxLength: 4 },
            },
        });
        const once = enrichDescriptions(doc);
        expect(enrichDescriptions(once)).toEqual(once);
        expect(enrichDescriptions(enrichDescriptions(once))).toEqual(once);
    });

    it('skips a fact the prose already states (positive control: the same field without that prose gets it)', () => {
        const stated = describe1({ type: 'string', description: 'Name, 1-200 characters, shown on invoices', minLength: 1, maxLength: 200 });
        expect(stated).toBe('Name, 1-200 characters, shown on invoices');
        const unstated = describe1({ type: 'string', description: 'Name shown on invoices', minLength: 1, maxLength: 200 });
        expect(unstated).toBe('Name shown on invoices. 1-200 characters.');
    });

    it('skips an enum whose every value is already named in the prose', () => {
        expect(describe1({ type: 'string', description: 'Either draft or sent, set by the caller', enum: ['draft', 'sent'] })).toBe('Either draft or sent, set by the caller');
        expect(describe1({ type: 'string', description: 'Either draft or sent, set by the caller', enum: ['draft', 'sent', 'void'] })).toContain('One of: draft, sent, void.');
    });

    it('skips a default the prose already states', () => {
        expect(describe1({ type: 'integer', description: 'Page size, defaults to 20 when omitted', default: 20 })).toBe('Page size, defaults to 20 when omitted. Integer.');
        expect(describe1({ type: 'integer', description: 'Page size when omitted', default: 20 })).toBe('Page size when omitted. Integer. Defaults to 20.');
    });

    it('skips the integer fact when the prose already says integer', () => {
        expect(describe1({ type: 'integer', description: 'A whole integer count of rooms' })).toBe('A whole integer count of rooms');
    });
});

describe('enrichDescriptions: never invents a description', () => {
    it('leaves a field with no description alone (control: with a description it is enriched)', () => {
        const schema = { type: 'string', minLength: 1, maxLength: 5 };
        const out = enrichDescriptions(bodyDoc({ type: 'object', properties: { f: schema } }));
        expect(props(out)['f']).toEqual(schema);
        expect('description' in (props(out)['f'] ?? {})).toBe(false);
        expect(describe1({ ...schema, description: BASE })).toBe(`${BASE}. 1-5 characters.`);
    });

    it('leaves a placeholder alone, even though it is long enough to pass a length check', () => {
        const placeholder = 'TODO describe f field for the OpenInspection MCP integration';
        expect(describe1({ type: 'string', minLength: 1, description: placeholder })).toBe(placeholder);
        const old = 'Auto-generated placeholder for f';
        expect(describe1({ type: 'string', maxLength: 5, description: old })).toBe(old);
        expect(isPlaceholderDescription(placeholder)).toBe(true);
        expect(isPlaceholderDescription(old)).toBe(true);
        expect(isPlaceholderDescription(BASE)).toBe(false);
        expect(isPlaceholderDescription('')).toBe(true);
        expect(isPlaceholderDescription(undefined)).toBe(true);
    });

    it('does not let the suffix lift a too-short description over the floor', () => {
        const short = 'Name'; // 4 chars, below the floor
        expect(short.length).toBeLessThan(MIN_FIELD_DESCRIPTION_CHARS);
        const out = describe1({ type: 'string', description: short, minLength: 1, maxLength: 200 });
        expect(out).toBe(short);
        // control: the identical field at the floor IS enriched
        const atFloor = 'x'.repeat(MIN_FIELD_DESCRIPTION_CHARS);
        expect(describe1({ type: 'string', description: atFloor, minLength: 1, maxLength: 200 })).toBe(`${atFloor}. 1-200 characters.`);
    });

    it('never leaves an enriched description shorter than the floor', () => {
        const out = describe1({ type: 'string', description: 'x'.repeat(MIN_FIELD_DESCRIPTION_CHARS), maxLength: 3 });
        expect(out.length).toBeGreaterThanOrEqual(MIN_FIELD_DESCRIPTION_CHARS);
    });
});

describe('enrichDescriptions: traversal', () => {
    it('reaches nested objects, array items, allOf/anyOf branches', () => {
        const doc = bodyDoc({
            type: 'object',
            properties: {
                nested: {
                    type: 'object',
                    description: 'A nested object holder',
                    properties: { leaf: { type: 'string', description: BASE, maxLength: 9 } },
                },
                list: {
                    type: 'array',
                    description: 'List of line items on it',
                    items: { type: 'object', properties: { qty: { type: 'integer', description: BASE, minimum: 1 } } },
                },
                alt: {
                    anyOf: [{ type: 'object', properties: { inAny: { type: 'string', description: BASE, maxLength: 2 } } }],
                },
                comp: {
                    allOf: [{ type: 'object', properties: { inAll: { type: 'string', description: BASE, maxLength: 3 } } }],
                },
            },
        });
        const p = props(enrichDescriptions(doc));
        expect(((p['nested']?.['properties'] as Obj)['leaf'] as Obj)['description']).toBe(`${BASE}. Up to 9 characters.`);
        const qty = (((p['list']?.['items'] as Obj)['properties'] as Obj)['qty'] as Obj)['description'];
        expect(qty).toBe(`${BASE}. Integer, at least 1.`);
        expect(((((p['alt']?.['anyOf'] as Obj[])[0] as Obj)['properties'] as Obj)['inAny'] as Obj)['description']).toBe(`${BASE}. Up to 2 characters.`);
        expect(((((p['comp']?.['allOf'] as Obj[])[0] as Obj)['properties'] as Obj)['inAll'] as Obj)['description']).toBe(`${BASE}. Up to 3 characters.`);
    });

    it('follows $ref into components.schemas reachable from an input, and not into unreachable ones', () => {
        const doc: Obj = {
            openapi: '3.0.0',
            paths: {
                '/api/widgets': {
                    post: {
                        operationId: 'op',
                        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Body' } } } },
                    },
                },
            },
            components: {
                schemas: {
                    Body: { type: 'object', properties: { inner: { $ref: '#/components/schemas/Inner' }, a: { type: 'string', description: BASE, maxLength: 4 } } },
                    Inner: { type: 'object', properties: { deep: { type: 'string', description: BASE, maxLength: 7 } } },
                    ResponseOnly: { type: 'object', properties: { out: { type: 'string', description: BASE, maxLength: 7 } } },
                },
            },
        };
        const schemas = (enrichDescriptions(doc)['components'] as Obj)['schemas'] as Record<string, Obj>;
        const deep = ((schemas['Inner']?.['properties'] as Obj)['deep'] as Obj)['description'];
        expect(deep).toBe(`${BASE}. Up to 7 characters.`);
        expect(((schemas['Body']?.['properties'] as Obj)['a'] as Obj)['description']).toBe(`${BASE}. Up to 4 characters.`);
        // control: reachable ones changed, the unreachable one did not
        expect(((schemas['ResponseOnly']?.['properties'] as Obj)['out'] as Obj)['description']).toBe(BASE);
    });

    it('terminates on a self-referencing component', () => {
        const doc: Obj = {
            openapi: '3.0.0',
            paths: { '/api/widgets': { post: { operationId: 'op', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } } } },
            components: { schemas: { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' }, name: { type: 'string', description: BASE, maxLength: 4 } } } } },
        };
        const out = enrichDescriptions(doc);
        const node = ((out['components'] as Obj)['schemas'] as Record<string, Obj>)['Node'];
        expect(((node?.['properties'] as Obj)['name'] as Obj)['description']).toBe(`${BASE}. Up to 4 characters.`);
    });

    it('enriches query parameters on both the parameter and its schema', () => {
        const doc: Obj = {
            openapi: '3.0.0',
            paths: {
                '/api/widgets': {
                    get: {
                        operationId: 'op',
                        parameters: [{ name: 'limit', in: 'query', description: 'Rows per page', schema: { type: 'integer', minimum: 1, maximum: 100, description: 'Rows per page' } }],
                    },
                },
            },
        };
        const get = ((enrichDescriptions(doc)['paths'] as Obj)['/api/widgets'] as Obj)['get'] as Obj;
        const param = (get['parameters'] as Obj[])[0] as Obj;
        expect(param['description']).toBe('Rows per page. Integer between 1 and 100.');
        expect((param['schema'] as Obj)['description']).toBe('Rows per page. Integer between 1 and 100.');
    });
});

describe('enrichDescriptions: path parameters', () => {
    function pathParamDesc(path: string, param: Obj): string | undefined {
        const doc: Obj = { openapi: '3.0.0', paths: { [path]: { get: { operationId: 'op', parameters: [param] } } } };
        const get = ((enrichDescriptions(doc)['paths'] as Obj)[path] as Obj)['get'] as Obj;
        return ((get['parameters'] as Obj[])[0] as Obj)['description'] as string | undefined;
    }
    const idParam = (extra: Obj = {}): Obj => ({ name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 }, ...extra });

    it('derives the entity from the segment before {id}', () => {
        expect(pathParamDesc('/api/contacts/{id}', idParam())).toBe("Id of the contact. Must belong to the caller's company.");
        expect(pathParamDesc('/api/inspections/{id}/cancel', idParam())).toBe("Id of the inspection. Must belong to the caller's company.");
        expect(pathParamDesc('/api/rating-systems/{id}/clone', idParam())).toBe("Id of the rating system. Must belong to the caller's company.");
        expect(pathParamDesc('/api/categories/{id}', idParam())).toBe("Id of the category. Must belong to the caller's company.");
    });

    it('treats a placeholder or empty description as missing, and fills the schema description too', () => {
        expect(pathParamDesc('/api/contacts/{id}', idParam({ description: 'TODO describe id field for the OpenInspection MCP integration' }))).toBe("Id of the contact. Must belong to the caller's company.");
        const doc: Obj = { openapi: '3.0.0', paths: { '/api/contacts/{id}': { get: { operationId: 'op', parameters: [idParam({ description: '' })] } } } };
        const get = ((enrichDescriptions(doc)['paths'] as Obj)['/api/contacts/{id}'] as Obj)['get'] as Obj;
        expect((((get['parameters'] as Obj[])[0] as Obj)['schema'] as Obj)['description']).toBe("Id of the contact. Must belong to the caller's company.");
    });

    it('keeps an existing semantic description (and appends facts to it) instead of deriving', () => {
        expect(pathParamDesc('/api/contacts/{id}', idParam({ description: 'Contact to merge into' }))).toBe('Contact to merge into');
        expect(pathParamDesc('/api/contacts/{id}', idParam({ description: 'Contact to merge into', schema: { type: 'string', minLength: 1, maxLength: 36, description: 'Contact to merge into' } }))).toBe('Contact to merge into. 1-36 characters.');
    });

    it('gives up rather than guess', () => {
        // not named id
        expect(pathParamDesc('/api/contacts/{contactId}', idParam({ name: 'contactId' }))).toBeUndefined();
        // not a path parameter
        expect(pathParamDesc('/api/contacts', idParam({ in: 'query' }))).toBeUndefined();
        // previous segment is itself a parameter
        expect(pathParamDesc('/api/public/repair-builder/{tenant}/{id}/items', idParam())).toBeUndefined();
        // previous segment is not a plural noun
        expect(pathParamDesc('/api/profile/{id}', idParam())).toBeUndefined();
        // plural endings whose singular cannot be derived by rule
        expect(pathParamDesc('/api/statuses/{id}', idParam())).toBeUndefined();
        expect(pathParamDesc('/api/responses/{id}', idParam())).toBeUndefined();
        expect(pathParamDesc('/api/addresses/{id}', idParam())).toBeUndefined();
        expect(pathParamDesc('/api/analyses/{id}', idParam())).toBeUndefined();
        // {id} is the first segment: nothing before it
        expect(pathParamDesc('/{id}', idParam())).toBeUndefined();
        // public and agent surfaces have no caller company
        expect(pathParamDesc('/api/public/tokens/{id}', idParam())).toBeUndefined();
        expect(pathParamDesc('/api/agent/notices/{id}', idParam())).toBeUndefined();
    });
});

describe('enrichDescriptions: purity', () => {
    it('does not modify its input', () => {
        const doc = bodyDoc({ type: 'object', properties: { f: { type: 'string', description: BASE, maxLength: 5 } } }, '/api/contacts/{id}', {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        });
        const before = JSON.stringify(doc);
        const out = enrichDescriptions(doc);
        expect(JSON.stringify(doc)).toBe(before);
        // control: the output did change, so the equality above is not vacuous
        expect(JSON.stringify(out)).not.toBe(before);
        expect(out).not.toBe(doc);
    });

    it('returns a document without paths unchanged in content', () => {
        expect(enrichDescriptions({ openapi: '3.0.0' })).toEqual({ openapi: '3.0.0' });
    });
});

describe('buildOpenApiDocument', () => {
    it('enriches whatever the app produced, passing the config through', () => {
        let seen: unknown;
        const app = {
            getOpenAPIDocument(config: { tag: string }) {
                seen = config;
                return bodyDoc({ type: 'object', properties: { f: { type: 'string', description: BASE, maxLength: 5 } } });
            },
        };
        const out = buildOpenApiDocument(app, { tag: 'cfg' });
        expect(seen).toEqual({ tag: 'cfg' });
        expect(props(out)['f']?.['description']).toBe(`${BASE}. Up to 5 characters.`);
    });
});
