import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (text: string) => `enc:${text}`),
    decryptToken: vi.fn(async (text: string) => text.replace('enc:', '')),
}));

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { QBOService } from '../../../server/services/qbo.service';

describe('QBOService.buildBasicAuth', () => {
    it('base64-encodes client_id:client_secret', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).buildBasicAuth();
        expect(result).toBe('Basic ' + btoa('cid:csec'));
    });
});

describe('QBOService.parseCloudEventType', () => {
    it('parses qbo.invoice.updated.v1 correctly', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).parseCloudEventType('qbo.invoice.updated.v1');
        expect(result).toEqual({ entityType: 'invoice', operation: 'updated' });
    });

    it('parses qbo.payment.created.v1 correctly', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).parseCloudEventType('qbo.payment.created.v1');
        expect(result).toEqual({ entityType: 'payment', operation: 'created' });
    });

    it('returns null for unrecognized format', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).parseCloudEventType('not.valid');
        expect(result).toBeNull();
    });
});

describe('QBOService.verifyWebhookSignature', () => {
    it('returns true for correct HMAC-SHA256 signature', async () => {
        const secret = 'webhook-secret';
        const body = '{"test":"payload"}';
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
        const b64sig = btoa(Array.from(new Uint8Array(sig), b => String.fromCharCode(b)).join(''));

        const svc = new QBOService({} as any, 'cid', 'csec', secret, 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = await (svc as any).verifyWebhookSignature(body, b64sig);
        expect(result).toBe(true);
    });

    it('returns false for wrong signature', async () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'webhook-secret', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = await (svc as any).verifyWebhookSignature('body', 'badsig==');
        expect(result).toBe(false);
    });
});

describe('QBOService.toIso8601', () => {
    it('converts Unix timestamp to ISO 8601 string', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).toIso8601(0);
        expect(result).toBe('1970-01-01T00:00:00.000Z');
    });
});

describe('QBOService.buildDocNumber', () => {
    it('truncates to 21 characters', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).buildDocNumber('INV-2025-VERY-LONG-NUMBER-001');
        expect(result.length).toBeLessThanOrEqual(21);
    });

    it('does not truncate short numbers', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        const result = (svc as any).buildDocNumber('INV-001');
        expect(result).toBe('INV-001');
    });
});

describe('QBOService.buildDisplayName', () => {
    it('formats first + last name', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        expect((svc as any).buildDisplayName('John', 'Smith', null, 0)).toBe('John Smith');
    });

    it('appends email on retry 1', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        expect((svc as any).buildDisplayName('John', 'Smith', 'j@x.com', 1)).toBe('John Smith (j@x.com)');
    });

    it('appends contactId on retry 2', () => {
        const svc = new QBOService({} as any, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
        expect((svc as any).buildDisplayName('John', 'Smith', 'j@x.com', 2, 'cid-123')).toBe('John Smith (cid-123)');
    });
});
