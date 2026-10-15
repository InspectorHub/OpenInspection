import { describe, it, expect } from 'vitest';
import { bookingsRoutes } from '../../../server/api/bookings';

/**
 * GET /api/public/inspectors and /api/public/services take no company
 * parameter and read the company from the request context. A multi-company
 * deployment has no such context on these paths and answers 403 (the booking
 * page never calls them; it uses /api/public/book/{slug}). The descriptions
 * used to say the company came from "host or slug", which is the opposite.
 */
function describeOp(path: string): string {
    const doc = bookingsRoutes.getOpenAPIDocument({ openapi: '3.0.0', info: { title: 't', version: '1' } });
    const op = (doc.paths as Record<string, { get?: { description?: string } }>)[path]?.get;
    if (!op?.description) throw new Error(`no description for ${path}`);
    return op.description;
}

describe.each(['/inspectors', '/services'])('%s description', (path) => {
    it('does not claim the company is chosen by host or slug', () => {
        const text = describeOp(path);
        expect(text).not.toMatch(/host or slug/i);
        expect(text).not.toMatch(/from the request's tenant context\.?$/i);
    });

    it('says it is for single-company deployments and that others answer 403', () => {
        const text = describeOp(path);
        expect(text).toMatch(/single[- ]company|standalone/i);
        expect(text).toMatch(/403/);
        expect(text).toContain('/api/public/book/{slug}');
    });
});

describe('control: the two descriptions still say what is returned', () => {
    it('inspectors names its fields', () => {
        expect(describeOp('/inspectors')).toMatch(/id/);
        expect(describeOp('/inspectors')).toMatch(/name/i);
    });
    it('services names its fields', () => {
        expect(describeOp('/services')).toMatch(/price/i);
        expect(describeOp('/services')).toMatch(/durationMinutes/);
    });
});
