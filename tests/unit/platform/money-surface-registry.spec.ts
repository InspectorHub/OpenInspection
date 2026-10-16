import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { isMoneyField } from '../../../server/lib/auth/money-redaction';
import { MONEY_SURFACE, UNSCANNED_MONEY_SURFACE, type Disposition } from './money-surface-registry';

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
    it('every redact and gate names only the two legitimate buckets', () => {
        const legit = new Set(['inspectionFees', 'companyFinance']);
        const checked = [...Object.entries(MONEY_SURFACE), ...Object.entries(UNSCANNED_MONEY_SURFACE)]
            .filter((e): e is [string, Extract<Disposition, { bucket: readonly string[] }>] => e[1].kind !== 'exempt');
        console.log(`money buckets: checked=${checked.length}`);
        expect(checked.length).toBeGreaterThan(30);
        for (const [k, d] of checked) {
            expect(d.bucket.length, k).toBeGreaterThan(0);
            for (const b of d.bucket) expect(legit.has(b), `${k} -> ${b}`).toBe(true);
        }
    });
    it('the capability a gate declares is the bucket the registry names', () => {
        const doc = app.getOpenAPIDocument({ openapi: '3.0.0', info: { version: 't', title: 't' } });
        const mismatched: string[] = [];
        let compared = 0;
        let undeclared = 0;
        for (const [k, d] of [...Object.entries(MONEY_SURFACE), ...Object.entries(UNSCANNED_MONEY_SURFACE)]) {
            if (d.kind !== 'gate') continue;
            const [method, path] = k.split(' ') as [string, string];
            const op = ((doc.paths ?? {})[path] as Record<string, { 'x-capability'?: string }> | undefined)?.[method.toLowerCase()];
            const declared = op?.['x-capability'];
            if (declared === undefined) {
                undeclared += 1;
                // Guarded inside the handler instead (by field, or by a caller-scoped view): the named file must say so.
                const src = d.file ? readFileSync(`server/api/${d.file}`, 'utf8') : '';
                const bucket = d.bucket[0];
                if (!d.file || !(/guardMoneyWrite\(/.test(src) || new RegExp(`caps[.]${bucket}\\b`).test(src))) {
                    mismatched.push(`${k} has no x-capability and no in-handler guard for ${bucket} in ${d.file ?? '(no file)'}`);
                }
                continue;
            }
            compared += 1;
            if (!d.bucket.includes(declared as never) || d.bucket.length !== 1) mismatched.push(`${k}: registry ${d.bucket.join('+')} but route declares ${declared}`);
        }
        console.log(`gate buckets: compared=${compared} guarded-by-field=${undeclared}`);
        expect(compared).toBeGreaterThan(10);
        expect(mismatched).toEqual([]);
    });
    it('the route file of a redact wears the bucket the registry names', () => {
        const missing: string[] = [];
        let checked = 0;
        for (const [k, d] of [...Object.entries(MONEY_SURFACE), ...Object.entries(UNSCANNED_MONEY_SURFACE)]) {
            if (d.kind !== 'redact') continue;
            const src = readFileSync(`server/api/${d.file}`, 'utf8');
            for (const b of d.bucket) {
                checked += 1;
                if (!new RegExp(`['"]${b}['"]|[.]${b}\\b`).test(src)) missing.push(`${k}: ${d.file} never uses ${b}`);
            }
        }
        console.log(`redact buckets: checked=${checked}`);
        expect(checked).toBeGreaterThan(20);
        expect(missing).toEqual([]);
    });
    it('exemptions carry a whitelisted reason', () => {
        const ok = new Set(['client-facing-token-track', 'repair-estimate-not-company-money', 'catalog-config-admin-only']);
        for (const [k, d] of Object.entries(MONEY_SURFACE)) {
            if (d.kind === 'exempt') expect(ok.has(d.reason), k).toBe(true);
        }
    });
});
