/**
 * The agent sign-in link is a DEPLOYMENT send, and must stay one.
 *
 * Agent accounts are global — they belong to no company — so the link that
 * signs one in speaks for the deployment, not for any tenant the agent happens
 * to work with. In a multi-tenant deployment that is the platform identity:
 * the bare platform sender, no Reply-To, no tenant brand, metered to nobody.
 *
 * A single-tenant deployment IS its one company, so there the deployment's
 * identity is the fixed tenant's, exactly as before this send was made
 * explicit. Both are pinned so the refactor that named the intent cannot have
 * quietly changed either answer.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import {
    createHarness, observeIdentity, PLATFORM_IDENTITY, TENANT_VOICE,
    type Harness, type HarnessMode, type ObservedIdentity,
} from '../helpers/tenant-email-harness';

const AGENT_EMAIL = 'avery@realty.test';

const PLATFORM_VOICE: ObservedIdentity = {
    from: PLATFORM_IDENTITY.senderEmail,
    replyTo: null,
    tenantBrandInHtml: false,
    meteredToTenant: false,
};

const EXPECTED: Record<HarnessMode, ObservedIdentity> = {
    saas: PLATFORM_VOICE,
    // The fixed tenant's sender name, Reply-To and meter. The body is drawn in
    // the platform brand in every mode: the template itself declares
    // `brand: 'platform'` (an account-level sign-in has no company to show).
    standalone: { ...TENANT_VOICE, tenantBrandInHtml: false },
};

describe.each<HarnessMode>(['saas', 'standalone'])('POST /api/agent/login-link identity (%s)', (mode) => {
    let h: Harness;
    afterEach(() => h.close());

    it('speaks for the deployment', { timeout: 60_000 }, async () => {
        h = await createHarness(mode);
        await h.db.insert(schema.users).values({
            id: '55555555-0000-4000-8000-000000000001', tenantId: null, email: AGENT_EMAIL,
            passwordHash: 'h', role: 'agent', name: 'Avery Agent', createdAt: new Date(),
        });

        const exec = makeExecutionContext({ label: `agent-login-link-${mode}` });
        const res = await app.request('/api/agent/login-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: AGENT_EMAIL }),
        }, h.env, exec.ctx);
        expect(res.status, await res.clone().text()).toBe(200);
        await exec.settle();

        const mail = h.sent.find((m) => m.to.includes(AGENT_EMAIL));
        expect(observeIdentity(h, mail)).toEqual(EXPECTED[mode]);
    });
});
