/**
 * Money that the key name does not give away.
 *
 * `isMoneyField` recognises a money value by its key (`*Cents`, `price`, `discountAmount`, ...), and the money-surface scan next door
 * finds money-bearing endpoints with that same test. A figure with an unremarkable key (`revenue`, `paid`, `from`, `to`, `value`)
 * is therefore invisible to both. The schemas do say what such a field holds: its description names the unit ("in cents"). This
 * spec scans the response schemas for numeric fields whose description says cents while the key is not recognised, and requires
 * every endpoint that has one to be accounted for, either as a money-surface entry (redacted, gated or exempt, with the reason
 * kept there) or in UNRECOGNISED_KEYS below with the way it is protected.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { isMoneyField } from '../../../server/lib/auth/money-redaction';
import { MONEY_SURFACE, UNSCANNED_MONEY_SURFACE } from './money-surface-registry';

interface Schema {
    type?: string;
    description?: string;
    properties?: Record<string, Schema>;
    items?: Schema;
    allOf?: Schema[];
    oneOf?: Schema[];
    anyOf?: Schema[];
    additionalProperties?: Schema | boolean;
    $ref?: string;
}
interface Operation {
    responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
}
type Components = Record<string, Schema>;

/** True when a description declares the unit of the value as cents. */
const declaresCents = (description: string | undefined): boolean => /\bcents\b/i.test(description ?? '');

/** Paths (dotted) of numeric fields declared as cents whose key `isMoneyField` does not recognise. */
function unrecognisedMoneyIn(s: Schema | undefined, components: Components, stack: ReadonlySet<string>, path = ''): string[] {
    if (!s) return [];
    if (s.$ref) {
        const name = s.$ref.replace('#/components/schemas/', '');
        if (stack.has(name)) return [];
        return unrecognisedMoneyIn(components[name], components, new Set([...stack, name]), path);
    }
    const out: string[] = [];
    for (const [k, v] of Object.entries(s.properties ?? {})) {
        const numeric = v.type === 'number' || v.type === 'integer';
        if (numeric && declaresCents(v.description) && !isMoneyField(k)) out.push(path + k);
        out.push(...unrecognisedMoneyIn(v, components, stack, `${path}${k}.`));
    }
    out.push(...unrecognisedMoneyIn(s.items, components, stack, path));
    if (s.additionalProperties && typeof s.additionalProperties === 'object') out.push(...unrecognisedMoneyIn(s.additionalProperties, components, stack, path));
    for (const sub of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) out.push(...unrecognisedMoneyIn(sub, components, stack, path));
    return out;
}

function scan(): Map<string, string[]> {
    const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { version: 't', title: 't' } });
    const components = (doc.components?.schemas ?? {}) as Components;
    const hits = new Map<string, string[]>();
    for (const [path, methods] of Object.entries(doc.paths ?? {})) {
        for (const [method, op] of Object.entries(methods as Record<string, Operation>)) {
            for (const code of ['200', '201']) {
                const fields = unrecognisedMoneyIn(op?.responses?.[code]?.content?.['application/json']?.schema, components, new Set());
                if (fields.length) hits.set(`${method.toUpperCase()} ${path}`, [...new Set([...(hits.get(`${method.toUpperCase()} ${path}`) ?? []), ...fields])]);
            }
        }
    }
    return hits;
}

/**
 * Endpoints whose money sits under keys the redactor does not recognise, and how each is protected. The protection is by the
 * route (a capability gate, or a handler that returns null or leaves the rows out), not by the key, so none of these is a
 * redaction candidate; the behaviour is asserted in the spec named in the reason.
 */
const UNRECOGNISED_KEYS: Record<string, string> = {
    'GET /api/metrics': 'handler: without companyFinance every company figure is null or an empty list (tests/unit/metrics)',
    'GET /api/inspections/{id}/pay-splits/refresh-preview': 'route gate: owner or manager with companyFinance',
    'GET /api/services/discount-codes': 'discount-code value is catalogue configuration, not an inspection amount',
    'PUT /api/services/discount-codes/{id}': 'discount-code value is catalogue configuration, not an inspection amount',
};

describe('money declared in cents under an unrecognised key', { timeout: 30_000 }, () => {
    const hits = scan();

    it('prints both numbers and refuses an empty scan', () => {
        console.log(`unrecognised money keys: endpoints=${hits.size} accounted=${Object.keys(UNRECOGNISED_KEYS).length}`);
        expect(hits.size).toBeGreaterThan(0);
    });

    it('accounts for every endpoint that has one', () => {
        const unaccounted = [...hits.entries()]
            .filter(([k]) => !(k in UNRECOGNISED_KEYS) && !(k in MONEY_SURFACE) && !(k in UNSCANNED_MONEY_SURFACE))
            .map(([k, fields]) => `${k}: ${fields.join(', ')}`);
        expect(unaccounted).toEqual([]);
    });

    it('has no stale entries', () => {
        expect(Object.keys(UNRECOGNISED_KEYS).filter((k) => !hits.has(k))).toEqual([]);
        for (const reason of Object.values(UNRECOGNISED_KEYS)) expect(reason.length).toBeGreaterThan(20);
    });

    it('the detector sees a planted field (positive control) and ignores a recognised key and a non-money count', () => {
        const components: Components = {};
        const schema: Schema = {
            type: 'object',
            properties: {
                owed: { type: 'integer', description: 'Amount owed, in cents.' },
                priceCents: { type: 'integer', description: 'In cents.' },
                count: { type: 'integer', description: 'How many rows.' },
                nested: { type: 'object', properties: { fee: { type: 'number', description: 'Fee in integer cents.' } } },
            },
        };
        expect(unrecognisedMoneyIn(schema, components, new Set())).toEqual(['owed', 'nested.fee']);
    });
});
