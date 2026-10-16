/**
 * Every inbound `/webhooks/` route must say where its verifier secret comes from.
 *
 * A webhook mounted outside `/api/` silently missed the merge of a company's
 * stored integration secrets, so a secret saved in Settings was never seen. This
 * guard enumerates what is actually mounted and fails, naming the route, when
 * one is added without a declared and checked resolution path.
 *
 * Three honest answers exist:
 *  - merged:   the route itself names the company (a slug in the path), and the
 *              shared middleware merges that company's stored secrets into the
 *              env this route reads (checked against the middleware's own matcher).
 *  - fixed-or-none: the path names no company. Standalone has one fixed company
 *              whose secrets are merged; a multi-company deployment resolves no
 *              company and the handler ignores the delivery.
 *  - realm-lookup: like fixed-or-none, but a multi-company deployment picks the
 *              stored token to TRY from the realm in the body, and the signature
 *              must verify against it (server/services/qbo/webhook-secret.ts).
 *  - own-load: the handler loads the company's stored secrets itself through
 *              `loadTenantSecrets` (checked in the named source file).
 *  - platform: the verifier is a deployment-level credential by design.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '../../../server/index';
import { secretsMergeAppliesTo } from '../../../server/lib/middleware/integration-secrets';

const ROOT = join(__dirname, '..', '..', '..');
const source = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

type Resolution =
    | { kind: 'merged' }
    | { kind: 'fixed-or-none' }
    | { kind: 'realm-lookup' }
    | { kind: 'own-load'; file: string }
    | { kind: 'platform'; why: string };

const DECLARED: Record<string, Resolution> = {
    'POST /webhooks/quickbooks':       { kind: 'realm-lookup' },
    'POST /webhooks/stripe':           { kind: 'fixed-or-none' },
    'POST /webhooks/stripe/:tenant':   { kind: 'merged' },
    'POST /webhooks/sms/inbound/:tenant': { kind: 'own-load', file: 'server/api/sms.ts' },
    'POST /webhooks/sms/status/:tenant':  { kind: 'own-load', file: 'server/lib/sms/delivery-status.ts' },
    'POST /webhooks/compliance-status/:provider/:tenant': {
        kind: 'platform', why: 'managed provisioning callback, deployment-level signing credential',
    },
    'POST /webhooks/email/:provider/:tenant': { kind: 'own-load', file: 'server/lib/email/email-events.ts' },
};

const mounted = [...new Set(
    app.routes.filter((r) => r.path.startsWith('/webhooks/') && r.method !== 'ALL').map((r) => `${r.method} ${r.path}`),
)].sort();

describe('inbound webhook routes declare how their verifier secret is resolved', () => {
    it('finds the routes it is meant to guard (positive control)', () => {
        expect(mounted.length).toBeGreaterThanOrEqual(3);
        expect(mounted).toContain('POST /webhooks/stripe/:tenant');
        expect(mounted).toContain('POST /webhooks/quickbooks');
    });

    it('has no mounted /webhooks/ route without a declared resolution', () => {
        const undeclared = mounted.filter((route) => !(route in DECLARED));
        expect(
            undeclared,
            `New /webhooks/ route(s) with no declared verifier-secret resolution: ${undeclared.join(', ')}. `
            + 'Add each to DECLARED in this file as merged / own-load / platform, and make it true.',
        ).toEqual([]);
    });

    it('has no declaration for a route that is no longer mounted', () => {
        const stale = Object.keys(DECLARED).filter((route) => !mounted.includes(route));
        expect(stale, `Declared but not mounted: ${stale.join(', ')}`).toEqual([]);
    });

    it.each(Object.entries(DECLARED))('%s: the declared resolution holds', (route, resolution) => {
        const path = route.split(' ')[1]!.replace(/:[a-z]+/g, 'x');
        if (resolution.kind === 'merged') {
            expect(secretsMergeAppliesTo(path), `${path} is not covered by the stored-secrets merge`).toBe(true);
        } else if (resolution.kind === 'fixed-or-none') {
            expect(secretsMergeAppliesTo(path), `${path} is not covered by the stored-secrets merge`).toBe(true);
            expect(source('server/api/stripe-webhook.ts')).toContain('no tenant/keys in scope');
        } else if (resolution.kind === 'realm-lookup') {
            expect(secretsMergeAppliesTo(path), `${path} is not covered by the stored-secrets merge`).toBe(true);
            expect(source('server/api/qbo-webhook.ts')).toContain('webhookCandidates(');
        } else if (resolution.kind === 'own-load') {
            expect(source(resolution.file)).toContain('loadTenantSecrets(');
        } else {
            expect(resolution.why.length).toBeGreaterThan(0);
        }
    });

    it('the merge matcher still excludes ordinary pages (negative control)', () => {
        expect(secretsMergeAppliesTo('/inspections')).toBe(false);
        expect(secretsMergeAppliesTo('/webhooksnot')).toBe(false);
    });
});
