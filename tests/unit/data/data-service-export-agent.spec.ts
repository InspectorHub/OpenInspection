/**
 * Task 9c-X3 (people-role-profiles, FINAL reads) — DataService.exportInspectionsCSV
 * projects the `referred_by_agent_id` export column straight off the legacy
 * inspections.referredByAgentId column. Convert to source it from the
 * inspection_people buyer_agent join (PeopleService), not the legacy column
 * (frozen cache, dropped Task 13), via a single LEFT JOIN so the bulk export
 * stays N+1-free — mirrors the primary-client join already on this query.
 *
 * Seeds the inspection with the LEGACY referredByAgentId column NULL and only
 * inspection_people populated, so this fails against the pre-rewrite
 * implementation (which reads only the legacy column and would render an
 * empty agent cell).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataService } from '../../../server/services/data.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000e2';
const AGENT = 'contact-agent-export';
const INSP_WITH_AGENT = 'insp-export-agent-1';
const INSP_NO_AGENT = 'insp-export-agent-2';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

describe('DataService.exportInspectionsCSV — buyer_agent sourcing (Task 9c-X3)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: DataService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new DataService({} as D1Database);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-export-agent', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: AGENT, tenantId: TENANT, type: 'agent', name: 'Jane Agent',
            email: 'jane@realty.example', agency: 'Realty Co', createdAt: new Date(),
        });

        // Legacy referredByAgentId column intentionally NULL — only
        // inspection_people carries the buyer_agent for INSP_WITH_AGENT;
        // INSP_NO_AGENT has neither (degenerate — no buyer's agent at all).
        await db.insert(schema.inspections).values([
            {
                id: INSP_WITH_AGENT, tenantId: TENANT, propertyAddress: '1 Main St',
                referredByAgentId: null,
                date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
            {
                id: INSP_NO_AGENT, tenantId: TENANT, propertyAddress: '2 Oak Ave',
                referredByAgentId: null,
                date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
        ]);
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_WITH_AGENT, AGENT, roleProfileId('buyer_agent'));
    });

    it('sources referred_by_agent_id from the inspection_people buyer_agent join, preserving column order', async () => {
        const csv = await svc.exportInspectionsCSV(TENANT);
        const [header, ...rows] = csv.split('\n');
        const cols = header.split(',');
        const agentIdx = cols.indexOf('referred_by_agent_id');
        expect(agentIdx).toBeGreaterThan(-1);

        const withAgentRow = rows.find(r => r.startsWith(INSP_WITH_AGENT));
        expect(withAgentRow!.split(',')[agentIdx]).toBe(AGENT);

        const noAgentRow = rows.find(r => r.startsWith(INSP_NO_AGENT));
        expect(noAgentRow!.split(',')[agentIdx]).toBe('');
    });
});
