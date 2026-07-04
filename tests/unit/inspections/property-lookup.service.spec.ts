/**
 * Sprint 3 S3-1 — PropertyLookupService unit suite.
 *
 * Critical invariants:
 *   - Without ESTATED_API_KEY: returns { data: null, reason: 'NO_API_KEY' }.
 *     No fetch is issued.
 *   - With key + Estated 200: returns mapped facts.
 *   - With key + Estated 404: returns { data: null, reason: 'NOT_FOUND' }.
 *   - With key + Estated 5xx: returns { data: null, reason: 'PROVIDER_ERROR' }.
 *   - Address whitespace is trimmed.
 *   - Empty / too-short address rejects with BadRequest.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PropertyLookupService } from '../../../server/services/property-lookup.service';

describe('PropertyLookupService', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).fetch = vi.fn();
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('returns NO_API_KEY when ESTATED_API_KEY is unset (graceful degrade)', async () => {
        const svc = new PropertyLookupService({});
        const out = await svc.lookup('123 Main St, Anytown, CA');
        expect(out).toEqual({ data: null, reason: 'NO_API_KEY' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns NO_API_KEY when key is empty string', async () => {
        const svc = new PropertyLookupService({ ESTATED_API_KEY: '' });
        const out = await svc.lookup('123 Main St');
        expect(out).toEqual({ data: null, reason: 'NO_API_KEY' });
    });

    it('rejects too-short address', async () => {
        const svc = new PropertyLookupService({ ESTATED_API_KEY: 'k' });
        await expect(svc.lookup('xx')).rejects.toThrow();
    });

    it('returns mapped facts when Estated returns a 200 with data', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis.fetch as any).mockResolvedValueOnce(new Response(JSON.stringify({
            data: {
                structure: {
                    year_built:        1990,
                    total_area_sq_ft:  1850,
                    beds_count:        3,
                    baths:             2.5,
                    foundation_type:   'basement',
                },
                parcel: { area_sq_ft: 8400 },
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const svc = new PropertyLookupService({ ESTATED_API_KEY: 'k' });
        const out = await svc.lookup('123 Main St, Anytown, CA');

        expect(out.reason).toBeUndefined();
        expect(out.source).toBe('estated');
        expect(out.data).toMatchObject({
            yearBuilt:      1990,
            sqft:           1850,
            bedrooms:       3,
            bathrooms:      2.5,
            foundationType: 'basement',
        });
        // Lot size is rendered as a free-text string per Property Facts schema.
        expect(out.data?.lotSize).toContain('8400');
    });

    it('returns NOT_FOUND on 404', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis.fetch as any).mockResolvedValueOnce(new Response('', { status: 404 }));
        const svc = new PropertyLookupService({ ESTATED_API_KEY: 'k' });
        const out = await svc.lookup('Fake Address That Does Not Exist 99999');
        expect(out).toEqual({ data: null, reason: 'NOT_FOUND' });
    });

    it('returns PROVIDER_ERROR on 5xx', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis.fetch as any).mockResolvedValueOnce(new Response('', { status: 503 }));
        const svc = new PropertyLookupService({ ESTATED_API_KEY: 'k' });
        const out = await svc.lookup('123 Main St, Anytown');
        expect(out).toEqual({ data: null, reason: 'PROVIDER_ERROR' });
    });

    it('coerces invalid Estated payload into NOT_FOUND', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis.fetch as any).mockResolvedValueOnce(new Response(JSON.stringify({}), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        }));
        const svc = new PropertyLookupService({ ESTATED_API_KEY: 'k' });
        const out = await svc.lookup('123 Main St, Anytown');
        // No structure data == NOT_FOUND so the UI shows graceful empty.
        expect(out.reason).toBe('NOT_FOUND');
    });

    it('drops fields the provider returned as null/missing', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis.fetch as any).mockResolvedValueOnce(new Response(JSON.stringify({
            data: {
                structure: {
                    year_built: 2002,
                    // sqft missing
                    beds_count: 4,
                    // baths null
                    baths: null,
                    foundation_type: null,
                },
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const svc = new PropertyLookupService({ ESTATED_API_KEY: 'k' });
        const out = await svc.lookup('123 Main St, Anytown');
        expect(out.source).toBe('estated');
        expect(out.data).toMatchObject({ yearBuilt: 2002, bedrooms: 4 });
        expect(out.data?.sqft).toBeUndefined();
        expect(out.data?.bathrooms).toBeUndefined();
        expect(out.data?.foundationType).toBeUndefined();
    });
});
