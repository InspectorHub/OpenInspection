/**
 * The repair-request share link is a bearer credential held by people outside the company, and two of its buttons cost something: the PDF
 * starts a headless-browser render, and the email sends mail from the company's domain to an address the caller types.
 *
 * PDF: a stored copy while the content is unchanged, a bounded render otherwise, and the publish gate in front of both.
 * Email: bounded per link, per company, per recipient address and per day, with a capped note.
 * Every refusal sits beside a request that goes through on the same harness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/public-access')>();
    return { ...actual, resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null), resolveAgentSession: vi.fn().mockResolvedValue(null) };
});

// eslint-disable-next-line import/order
import { buildShareApp, SHARE_INSP_UNPUBLISHED, SHARE_RR } from '../helpers/repair-builder-routes-harness';
import { MockKV } from '../mocks';
import { mailboxKey } from '../../../server/lib/repair-share-limits';

const PDF = '/api/public/repair-request/share/share-tok-abc/pdf';
const EMAIL = '/api/public/repair-request/share/share-tok-abc/email';
const send = (app: ReturnType<typeof buildShareApp>['app'], body: Record<string, unknown>) => app.request(EMAIL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function limiter(allow: () => boolean) {
    const keys: string[] = [];
    return { keys, binding: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: allow() }; } } };
}

describe('the share PDF', () => {
    const entries = new Map<string, Response>();
    beforeEach(() => {
        entries.clear();
        (globalThis as unknown as { caches: unknown }).caches = {
            default: {
                match: async (k: string) => entries.get(k)?.clone(),
                put: async (k: string, r: Response) => { entries.set(k, r); },
            },
        };
    });
    afterEach(() => { delete (globalThis as unknown as { caches?: unknown }).caches; });

    const browser = () => ({ quickAction: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer }) });

    it('renders once and serves the stored copy while the content is unchanged, and renders again when it changes', async () => {
        const b = browser();
        const first = buildShareApp({ browserBinding: b });
        expect((await first.app.request(PDF)).status).toBe(200);
        const again = await first.app.request(PDF);
        expect(again.status).toBe(200);
        expect(new Uint8Array(await again.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
        expect(b.quickAction).toHaveBeenCalledTimes(1);
        // A change to what the page shows is a different key: the copy cannot show stale content.
        const changed = buildShareApp({ browserBinding: b, creditTotalResult: 9000 });
        expect((await changed.app.request(PDF)).status).toBe(200);
        expect(b.quickAction).toHaveBeenCalledTimes(2);
    });

    it('still applies the publish gate to a stored copy', async () => {
        const b = browser();
        expect((await buildShareApp({ browserBinding: b }).app.request(PDF)).status).toBe(200);
        const withdrawn = await buildShareApp({ browserBinding: b, inspResult: SHARE_INSP_UNPUBLISHED }).app.request(PDF);
        expect(withdrawn.status).toBe(403);
        expect(b.quickAction).toHaveBeenCalledTimes(1);
    });

    it('bounds the render per share link and per company, and a refused render starts no browser', async () => {
        let allow = true;
        const l = limiter(() => allow);
        const b = browser();
        const { app } = buildShareApp({ browserBinding: b, env: { RATE_LIMITER: l.binding } });
        expect((await app.request(PDF)).status).toBe(200);
        expect(l.keys.some((k) => k.startsWith('repair-share-pdf:'))).toBe(true);
        expect(l.keys).toContain(`repair-share-pdf-company:${SHARE_RR.tenantId}`);
        // The share token itself is never a limiter key.
        expect(l.keys.every((k) => !k.includes('share-tok-abc'))).toBe(true);
        entries.clear();
        allow = false;
        expect((await app.request(PDF)).status).toBe(429);
        expect(b.quickAction).toHaveBeenCalledTimes(1);
    });

    it('does not spend the limiter on a stored copy', async () => {
        const l = limiter(() => true);
        const b = browser();
        const { app } = buildShareApp({ browserBinding: b, env: { RATE_LIMITER: l.binding } });
        await app.request(PDF);
        const after = l.keys.length;
        await app.request(PDF);
        expect(l.keys.length).toBe(after);
    });
});

describe('the share email', () => {
    it('limits per share link, per company and per recipient address, and says no past the limit', async () => {
        let allow = true;
        const l = limiter(() => allow);
        const sendRepairRequestShare = vi.fn().mockResolvedValue(undefined);
        const { app } = buildShareApp({ sendRepairRequestShare, env: { RATE_LIMITER: l.binding } });
        expect((await send(app, { to: 'Contractor@Example.com' })).status).toBe(200);
        expect(l.keys.some((k) => k.startsWith('repair-share-email:'))).toBe(true);
        expect(l.keys).toContain(`repair-share-email-company:${SHARE_RR.tenantId}`);
        expect(l.keys.some((k) => k.startsWith('repair-share-email-to:'))).toBe(true);
        expect(l.keys.every((k) => !k.includes('share-tok-abc') && !k.toLowerCase().includes('contractor@'))).toBe(true);
        allow = false;
        expect((await send(app, { to: 'contractor@example.com' })).status).toBe(429);
        expect(sendRepairRequestShare).toHaveBeenCalledTimes(1);
    });

    it('caps what one link can send in a day, and what one address can receive in a day', async () => {
        const kv = new MockKV();
        const sendRepairRequestShare = vi.fn().mockResolvedValue(undefined);
        const { app } = buildShareApp({ sendRepairRequestShare, env: { TENANT_CACHE: kv } });
        // One address: three, then refused, whatever its case. A different address is still allowed (control: the cap is per address).
        for (let i = 0; i < 3; i++) expect((await send(app, { to: 'one@example.com' })).status, `send ${i}`).toBe(200);
        expect((await send(app, { to: 'one@example.com' })).status).toBe(429);
        expect((await send(app, { to: 'ONE@example.com' })).status).toBe(429);
        // One link: twenty in all, then refused for a fresh address too.
        let sent = 3;
        for (let i = 0; sent < 20; i++, sent++) expect((await send(app, { to: `other${i}@example.com` })).status, `other ${i}`).toBe(200);
        expect((await send(app, { to: 'fresh@example.com' })).status).toBe(429);
        expect(sendRepairRequestShare).toHaveBeenCalledTimes(20);
    });

    it('limits per source address too, with an IPv6 caller counted as its /64', async () => {
        const l = limiter(() => true);
        const { app } = buildShareApp({ sendRepairRequestShare: vi.fn().mockResolvedValue(undefined), env: { RATE_LIMITER: l.binding } });
        const from = (ip: string, to: string) => app.request(EMAIL, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ to }),
        });
        expect((await from('203.0.113.9', 'a@example.com')).status).toBe(200);
        expect(l.keys).toContain('repair-share-email-ip:203.0.113.9');
        // Two addresses of one subscriber's /64 share one bucket.
        await from('2001:db8:1:2:aaaa::1', 'b@example.com');
        await from('2001:db8:1:2:bbbb::2', 'c@example.com');
        const v6 = l.keys.filter((k) => k.startsWith('repair-share-email-ip:2001'));
        expect(v6).toHaveLength(2);
        expect(new Set(v6).size).toBe(1);
        // A refusal on the source address stops the send even when every other bucket allows it.
        let blockIp = false;
        const gated = { limit: async ({ key }: { key: string }) => ({ success: !(blockIp && key.startsWith('repair-share-email-ip:')) }) };
        const send = vi.fn().mockResolvedValue(undefined);
        const second = buildShareApp({ sendRepairRequestShare: send, env: { RATE_LIMITER: gated } });
        expect((await second.app.request(EMAIL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'd@example.com' }) })).status).toBe(200);
        blockIp = true;
        expect((await second.app.request(EMAIL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'e@example.com' }) })).status).toBe(429);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('counts plus-addressing and Gmail dots as one mailbox', async () => {
        expect(mailboxKey('Jo.Smith+bids@Example.com')).toBe('jo.smith@example.com');
        expect(mailboxKey('j.o+1@gmail.com')).toBe('jo@gmail.com');
        expect(mailboxKey('jo@googlemail.com')).toBe('jo@gmail.com');
        expect(mailboxKey('+odd@example.com')).toBe('+odd@example.com');
        const kv = new MockKV();
        const send = vi.fn().mockResolvedValue(undefined);
        const { app } = buildShareApp({ sendRepairRequestShare: send, env: { TENANT_CACHE: kv } });
        for (const to of ['jo+1@gmail.com', 'j.o+2@gmail.com', 'J.O@googlemail.com']) expect((await app.request(EMAIL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) })).status, to).toBe(200);
        expect((await app.request(EMAIL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'jo+4@gmail.com' }) })).status).toBe(429);
        // Control: a different mailbox is still allowed.
        expect((await app.request(EMAIL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'other@gmail.com' }) })).status).toBe(200);
    });

    it('caps the personal note, and accepts one at the cap', async () => {
        const sendRepairRequestShare = vi.fn().mockResolvedValue(undefined);
        const { app } = buildShareApp({ sendRepairRequestShare });
        expect((await send(app, { to: 'a@example.com', message: 'x'.repeat(1000) })).status).toBe(200);
        expect((await send(app, { to: 'b@example.com', message: 'x'.repeat(1001) })).status).toBe(400);
        expect(sendRepairRequestShare).toHaveBeenCalledTimes(1);
    });
});
