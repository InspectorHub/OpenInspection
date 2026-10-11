/**
 * Agent-submitted (concierge) bookings email in the TENANT's voice, in both modes.
 *
 * Agent sessions are global: an agent's token deliberately carries no tenant,
 * so on `POST /api/agent/concierge-book` nothing before the DI middleware
 * knows which company the booking is for — the body names it and the service
 * verifies the agent's link to it. `POST /api/concierge/confirm` is reached
 * with only the client's magic-link token. Every email either one sends must
 * still carry that company's sender name, Reply-To and brand, metered to it.
 *
 * Driven through the real app and middleware chain; only the provider's HTTP
 * call is intercepted (see helpers/tenant-email-harness.ts).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import {
    createHarness, mintAgentToken, observeIdentity, INSPECTOR_ID, OWNER_ID, TENANT_ID, TENANT_VOICE,
    type Harness, type HarnessMode,
} from '../helpers/tenant-email-harness';

const AGENT_USER_ID = '44444444-0000-4000-8000-000000000001';
const AGENT_CONTACT_ID = '44444444-0000-4000-8000-000000000002';
const AGENT_EMAIL = 'avery@realty.test';

/** A global agent account, linked to the tenant through one of its contacts. */
async function seedLinkedAgent(h: Harness): Promise<void> {
    await h.db.insert(schema.users).values({
        id: AGENT_USER_ID, tenantId: null, email: AGENT_EMAIL, passwordHash: 'h',
        role: 'agent', name: 'Avery Agent', createdAt: new Date(),
    });
    await h.db.insert(schema.contacts).values({
        id: AGENT_CONTACT_ID, tenantId: TENANT_ID, type: 'agent', name: 'Avery Agent',
        email: AGENT_EMAIL, agentUserId: AGENT_USER_ID, createdByUserId: OWNER_ID, createdAt: new Date(),
    });
}

async function conciergeBook(h: Harness, label: string): Promise<Response> {
    const token = await mintAgentToken(h.env, AGENT_USER_ID);
    const exec = makeExecutionContext({ label });
    const res = await app.request('/api/agent/concierge-book', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
            tenantId: TENANT_ID,
            inspectorUserId: INSPECTOR_ID,
            date: '2026-11-02',
            timeSlot: 'morning',
            propertyAddress: '12 Lighthouse Road',
            clientName: 'Casey Client',
            clientEmail: 'casey@client.test',
            agreementRequired: false,
            paymentRequired: false,
        }),
    }, h.env, exec.ctx);
    await exec.settle();
    return res;
}

describe.each<HarnessMode>(['saas', 'standalone'])('concierge booking emails (%s)', (mode) => {
    let h: Harness;
    afterEach(() => h.close());

    it('auto-confirm mode: the client confirm email, then the agent "confirmed" email, both in the tenant voice', { timeout: 60_000 }, async () => {
        h = await createHarness(mode);
        await seedLinkedAgent(h);

        const booked = await conciergeBook(h, `concierge-book-${mode}`);
        expect(booked.status, await booked.clone().text()).toBe(200);
        const clientMail = h.sent.find((m) => m.to.includes('casey@client.test'));
        // Soft, so a red run still reaches — and reports — the confirm step.
        expect.soft(observeIdentity(h, clientMail)).toEqual(TENANT_VOICE);

        // The client follows the magic link from that very email.
        const token = /\/confirm\/([0-9a-f]{64})/.exec(clientMail?.html ?? '')?.[1];
        expect(token, 'confirm link in the client email').toBeTruthy();
        const exec = makeExecutionContext({ label: `concierge-confirm-${mode}` });
        const confirmed = await app.request('/api/concierge/confirm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
        }, h.env, exec.ctx);
        expect(confirmed.status, await confirmed.clone().text()).toBe(200);
        await exec.settle();

        const agentMail = h.sent.find((m) => m.to.includes(AGENT_EMAIL));
        expect(observeIdentity(h, agentMail)).toEqual(TENANT_VOICE);
    });

    it('reviewer mode: the inspector review email is in the tenant voice', { timeout: 60_000 }, async () => {
        h = await createHarness(mode);
        await seedLinkedAgent(h);
        await h.db.update(schema.tenantConfigs)
            .set({ conciergeReviewRequired: true })
            .where(eq(schema.tenantConfigs.tenantId, TENANT_ID));

        const booked = await conciergeBook(h, `concierge-review-${mode}`);
        expect(booked.status, await booked.clone().text()).toBe(200);
        const reviewMail = h.sent.find((m) => m.to.includes('ivan@harbor-light.test'));
        expect(observeIdentity(h, reviewMail)).toEqual(TENANT_VOICE);
    });
});
