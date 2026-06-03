/**
 * Track E2 (Spectora App.A) — getReportData surfaces per-section
 * disclaimerText + alwaysPageBreak so the published report viewer can
 * render the disclaimer block + apply the data-page-break attribute.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000077';
const INSPECTION_ID = '33333333-3333-3333-3333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-4444-444444444444';

function buildTemplateSchema() {
    return {
        schemaVersion: 2 as const,
        sections: [
            {
                id: 'roof',
                title: 'Roof',
                disclaimerText: 'The inspector did not walk on the roof due to weather conditions.',
                alwaysPageBreak: true,
                items: [
                    { id: 'roof-i', label: 'Shingles', type: 'text' },
                ],
            },
            {
                id: 'plumbing',
                title: 'Plumbing',
                // no disclaimer, no page-break
                items: [
                    { id: 'plumbing-i', label: 'Faucets', type: 'text' },
                ],
            },
        ],
    };
}

describe('Track E2 — section disclaimer + alwaysPageBreak surfacing', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.templates).values({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', schema: buildTemplateSchema() as any, version: 1, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT, templateId: TEMPLATE_ID,
            propertyAddress: '1 Main St', clientName: 'C', clientEmail: 'c@example.com',
            date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 0,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
    });

    it('surfaces disclaimerText and alwaysPageBreak on the section payload', async () => {
        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        const roof = report.sections.find(s => s.id === 'roof');
        const plumbing = report.sections.find(s => s.id === 'plumbing');
        expect(roof).toBeDefined();
        expect(roof!.disclaimerText).toBe('The inspector did not walk on the roof due to weather conditions.');
        expect(roof!.alwaysPageBreak).toBe(true);
        // Plumbing has no flags — defaults must come through cleanly.
        expect(plumbing).toBeDefined();
        expect(plumbing!.disclaimerText).toBeNull();
        expect(plumbing!.alwaysPageBreak).toBe(false);
    });

    it('trims whitespace-only disclaimerText to null', async () => {
        const tplWithEmpty = {
            schemaVersion: 2 as const,
            sections: [
                { id: 's', title: 'S', disclaimerText: '   ', items: [{ id: 'i', label: 'I', type: 'text' }] },
            ],
        };
        await testDb.update(schema.templates).set({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schema: tplWithEmpty as any,
        });
        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        expect(report.sections[0]!.disclaimerText).toBeNull();
    });
});
