/**
 * The team roster as a file.
 *
 * There was no members export at all, which meant there was no members round
 * trip to make into a property — the invitation entry point could read a
 * spreadsheet nobody could produce. This is the other half.
 *
 * The interesting assertion is not "the columns are right". It is that the
 * `users` table carries three CREDENTIALS and this file never sees them — by
 * construction rather than by a filter, because the projection reads the
 * manifest and the manifest does not name them. Every absence asserted below
 * is paired with a presence in the same result, because "the secret is not in
 * the file" also passes on an empty file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { DataService } from '../../../server/services/data.service';
import dataRoutes from '../../../server/api/data';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';
import { tenants, users } from '../../../server/lib/db/schema';
import { MEMBER_EXCHANGE } from '../../../server/lib/data-exchange/members';
import { exportHeaders } from '../../../server/lib/data-exchange/types';
import { parseCsvTable } from '../../../server/lib/migration-intake/csv';

const TENANT = 'tenant-roster';
const OTHER = 'tenant-elsewhere';

/** Values a credential column holds, chosen so a substring search cannot miss them. */
const PASSWORD_HASH = 'pbkdf2-hash-THIS-MUST-NEVER-LEAVE';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP-SECRET-MARKER';
const RECOVERY_CODES = '["recovery-code-hash-MARKER"]';

let binding: D1Database;
let svc: DataService;

beforeEach(async () => {
    const fix = createTestDb();
    await setupSchema(fix.sqlite);
    await fix.db.insert(tenants).values([
        {
            id: TENANT, slug: 'roster', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        },
        {
            id: OTHER, slug: 'elsewhere', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        },
    ]);
    await fix.db.insert(users).values([
        {
            id: 'u-owner', tenantId: TENANT, email: 'owner@example.com', name: 'Ola Owner',
            role: 'owner', passwordHash: PASSWORD_HASH, totpSecret: TOTP_SECRET,
            totpRecoveryCodes: RECOVERY_CODES, createdAt: new Date('2026-01-05T00:00:00.000Z'),
        },
        {
            id: 'u-inspector', tenantId: TENANT, email: 'ivan@example.com', name: 'Ivan Inspector',
            role: 'inspector', passwordHash: PASSWORD_HASH,
            createdAt: new Date('2026-02-06T00:00:00.000Z'),
        },
        {
            id: 'u-elsewhere', tenantId: OTHER, email: 'someone@elsewhere.example',
            name: 'Not Ours', role: 'owner', passwordHash: PASSWORD_HASH, createdAt: new Date(),
        },
        // A GLOBAL agent account: users.tenant_id IS NULL by construction, which
        // is why `agent` — the one role an import may not grant — cannot
        // normally appear in a tenant's roster. Asserted rather than assumed.
        {
            id: 'u-agent', tenantId: null, email: 'agent@elsewhere.example',
            name: 'Global Agent', role: 'agent', passwordHash: PASSWORD_HASH, createdAt: new Date(),
        },
    ]);
    binding = toD1Binding(fix.sqlite);
    svc = new DataService(binding);
});

/** The route under a context shaped like the real one. */
function routesApp(role: Role, tenantId = TENANT) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        throw err;
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', tenantId);
        c.set('userRole', role);
        await next();
    });
    app.route('/api/data', dataRoutes);
    return app;
}

describe('members export — the header IS the manifest', () => {
    it('writes exactly the manifest headers, in the manifest order', async () => {
        const table = parseCsvTable(await svc.exportMembersCSV(TENANT));
        expect(table.columns).toEqual(exportHeaders(MEMBER_EXCHANGE));
    });

    it('carries this tenant\'s members with their own roles', async () => {
        const table = parseCsvTable(await svc.exportMembersCSV(TENANT));
        const byEmail = new Map(table.rows.map((r) => [r.email, r]));
        expect(byEmail.get('owner@example.com')?.role).toBe('owner');
        expect(byEmail.get('ivan@example.com')?.role).toBe('inspector');
        expect(byEmail.get('owner@example.com')?.name).toBe('Ola Owner');
        expect(byEmail.get('owner@example.com')?.created_at).toBe('2026-01-05T00:00:00.000Z');
    });
});

describe('members export — what it never carries', () => {
    it('contains no credential value anywhere in the file text', async () => {
        const csv = await svc.exportMembersCSV(TENANT);
        expect(csv).not.toContain(PASSWORD_HASH);
        expect(csv).not.toContain(TOTP_SECRET);
        expect(csv).not.toContain('recovery-code-hash-MARKER');
        // POSITIVE CONTROLS, in the same result. The seeded credentials are
        // non-empty — otherwise the three assertions above are about nothing —
        // and the file DOES carry the member, so their absence is not the
        // absence of data.
        expect(PASSWORD_HASH.length).toBeGreaterThan(0);
        expect(TOTP_SECRET.length).toBeGreaterThan(0);
        expect(csv).toContain('owner@example.com');
    });

    it('does not reach into another tenant, or into a global agent account', async () => {
        const table = parseCsvTable(await svc.exportMembersCSV(TENANT));
        const emails = table.rows.map((r) => r.email);
        expect(emails).not.toContain('someone@elsewhere.example');
        expect(emails).not.toContain('agent@elsewhere.example');
        expect(table.rows.map((r) => r.role)).not.toContain('agent');
        // POSITIVE CONTROL — two distinct roles ARE present, so "no agent" is
        // not the emptiness of the file talking.
        expect(new Set(table.rows.map((r) => r.role))).toEqual(new Set(['owner', 'inspector']));
        expect(emails.sort()).toEqual(['ivan@example.com', 'owner@example.com']);
    });
});

describe('GET /api/data/export/members', () => {
    it('hands an owner the CSV, named for the day it was taken', async () => {
        const res = await routesApp('owner').request('/api/data/export/members', {}, { DB: binding });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/csv');
        expect(res.headers.get('Content-Disposition'))
            .toMatch(/^attachment; filename="members-\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(parseCsvTable(await res.text()).columns).toEqual(exportHeaders(MEMBER_EXCHANGE));
    });

    it('refuses an inspector', async () => {
        const res = await routesApp('inspector').request('/api/data/export/members', {}, { DB: binding });
        expect(res.status).toBe(403);
        // POSITIVE CONTROL — a manager, who IS allowed, gets the file from the
        // same route, so the 403 is about the role and not about the route
        // being unreachable in this harness.
        const allowed = await routesApp('manager').request('/api/data/export/members', {}, { DB: binding });
        expect(allowed.status).toBe(200);
    });
});
