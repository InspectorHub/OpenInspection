import { describe, expect, it } from 'vitest';
import { projectFields } from '../../../server/lib/response-projection';
import { PublicInvoiceBodySchema, PUBLIC_INVOICE_FIELDS } from '../../../server/lib/validations/invoice.schema';

describe('projectFields', () => {
    const row = { id: 'a', name: 'n', secret: 's', nothing: null as null, missing: undefined as string | undefined };

    it('carries only the listed keys', () => {
        expect(projectFields(row, ['id', 'name'])).toEqual({ id: 'a', name: 'n' });
    });

    it('keeps a listed key whose value is null or undefined, and leaves out a key the source does not have', () => {
        expect(projectFields(row, ['nothing', 'missing'])).toEqual({ nothing: null, missing: undefined });
        const older: { id: string; name?: string } = { id: 'a' };
        const out = projectFields(older, ['id', 'name']);
        expect(out).toEqual({ id: 'a' });
        expect('name' in out).toBe(false);
    });

    it('reads own keys only and does not change the source', () => {
        const child: { inherited?: string; own: string } = Object.assign(Object.create({ inherited: 'x' }) as object, { own: 'y' }) as { own: string };
        expect(projectFields(child, ['inherited', 'own'])).toEqual({ own: 'y' });
        const frozen = Object.freeze({ id: 'a', secret: 's' });
        const out = projectFields(frozen, ['id']);
        expect(out).not.toBe(frozen);
        expect(frozen).toEqual({ id: 'a', secret: 's' });
    });
});

describe('the public invoice field list', () => {
    it('with the three parts built beside it is exactly the declared body, so a column is carried only when it is named', () => {
        const declared = Object.keys(PublicInvoiceBodySchema.shape).sort();
        // `balanceDueCents` is derived from the payment ledger by the route, not read off the invoice row.
        expect([...PUBLIC_INVOICE_FIELDS, 'balanceDueCents', 'lineItems', 'brand', 'tenantSlug'].sort()).toEqual(declared);
        for (const column of ['notes', 'tenantId', 'contactId', 'clientEmail', 'qboSyncStatus']) expect(PUBLIC_INVOICE_FIELDS).not.toContain(column);
    });
});
