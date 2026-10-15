import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { isMoneyField } from '../../../server/lib/auth/money-redaction';
import { MONEY_SURFACE, UNSCANNED_MONEY_SURFACE } from './money-surface-registry';

interface Schema {
    type?: string;
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

function moneyFieldsIn(s: Schema | undefined, components: Components, seen: Set<string>, path = ''): string[] {
    if (!s) return [];
    if (s.$ref) {
        const name = s.$ref.replace('#/components/schemas/', '');
        if (seen.has(name)) return [];
        return moneyFieldsIn(components[name], components, new Set([...seen, name]), path);
    }
    const out: string[] = [];
    for (const [k, v] of Object.entries(s.properties ?? {})) {
        if (isMoneyField(k)) out.push(path + k);
        out.push(...moneyFieldsIn(v, components, seen, `${path}${k}.`));
    }
    out.push(...moneyFieldsIn(s.items, components, seen, path));
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        out.push(...moneyFieldsIn(s.additionalProperties, components, seen, path));
    }
    for (const sub of [...(s.allOf ?? []), ...(s.oneOf ?? []), ...(s.anyOf ?? [])]) {
        out.push(...moneyFieldsIn(sub, components, seen, path));
    }
    return out;
}

function scan(): Map<string, string[]> {
    const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { version: 't', title: 't' } });
    const components = (doc.components?.schemas ?? {}) as Components;
    const hits = new Map<string, string[]>();
    for (const [path, methods] of Object.entries(doc.paths ?? {})) {
        for (const [method, op] of Object.entries(methods as Record<string, Operation>)) {
            const schema = op?.responses?.['200']?.content?.['application/json']?.schema
                ?? op?.responses?.['201']?.content?.['application/json']?.schema;
            const fields = moneyFieldsIn(schema, components, new Set());
            if (fields.length) hits.set(`${method.toUpperCase()} ${path}`, fields);
        }
    }
    return hits;
}

describe('every endpoint that can return money declares how it protects it', { timeout: 30_000 }, () => {
    const hits = scan();
    it('prints both numbers and refuses an empty scan', () => {
        console.log(`money surface: scanned=${hits.size} registered=${Object.keys(MONEY_SURFACE).length}`);
        expect(hits.size).toBeGreaterThan(15);
    });
    it('has a disposition for every money-bearing endpoint', () => {
        const missing = [...hits.keys()].filter(k => !(k in MONEY_SURFACE));
        expect(missing).toEqual([]);
    });
    it('has no stale entries', () => {
        const stale = Object.keys(MONEY_SURFACE).filter(k => !hits.has(k));
        expect(stale).toEqual([]);
    });
    it('every unscanned entry names a route that still exists, and none is also in the scanned list', () => {
        const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { version: 't', title: 't' } });
        const stale = Object.keys(UNSCANNED_MONEY_SURFACE).filter((k) => {
            const [method, path] = k.split(' ') as [string, string];
            const item = (doc.paths ?? {})[path] as Record<string, unknown> | undefined;
            return !item || !(method.toLowerCase() in item);
        });
        expect(stale).toEqual([]);
        expect(Object.keys(UNSCANNED_MONEY_SURFACE).filter((k) => k in MONEY_SURFACE)).toEqual([]);
    });
    it('exemptions carry a whitelisted reason', () => {
        const ok = new Set(['client-facing-token-track', 'repair-estimate-not-company-money', 'catalog-config-admin-only']);
        for (const [k, d] of Object.entries(MONEY_SURFACE)) {
            if (d.kind === 'exempt') expect(ok.has(d.reason), k).toBe(true);
        }
    });
});
