import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import {
    getBookInfo,
    createBooking,
    getConfirmInfo,
} from '../../server/services/concierge.service';
import {
    conciergeInvites,
    conciergeBookings,
    tenants,
    tenantConfigs,
} from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Tasks 15-17 of typed-hono-dead-routes-cleanup — verify the new public
 * concierge booking flow service functions against an in-memory SQLite DB.
 */

describe('concierge public flow', () => {
    let sqlite: any;
    let db: BetterSQLite3Database<any>;

    beforeEach(async () => {
        const t = createTestDb();
        sqlite = t.sqlite;
        db = t.db as any;
        await setupSchema(sqlite);

        // Tenant uses integer timestamp per the existing schema; the new
        // concierge_invites / concierge_bookings tables use TEXT timestamps.
        await db.insert(tenants).values({
            id: 't-1',
            name: 'Acme Inspections',
            slug: 'acme',
            tier: 'free',
            status: 'active',
            maxUsers: 3,
            deploymentMode: 'shared',
            createdAt: new Date(),
        } as any);

        await db.insert(conciergeInvites).values({
            token: 'tok-abc-valid',
            tenantId: 't-1',
            inspectorId: null,
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        } as any);
    });

    it('getBookInfo returns tenant + slot stub for valid token', async () => {
        const r = await getBookInfo(db, 'tok-abc-valid');
        expect(r.tenant.name).toBe('Acme Inspections');
        expect(r.tenant.brand).toBeNull();
        expect(r.inspector).toBeNull();
        expect(r.availableSlots).toEqual([]);
        expect(typeof r.expiresAt).toBe('string');
    });

    it('getBookInfo returns the canonical tenant brand when configured (A-10)', async () => {
        await db.insert(tenantConfigs).values({
            tenantId: 't-1',
            siteName: 'Acme Home Pros',
            primaryColor: '#ff5500',
            logoUrl: '/api/public/brand-asset?key=branding%2Ft-1%2Flogo.png',
            updatedAt: new Date(),
        } as any);
        const r = await getBookInfo(db, 'tok-abc-valid');
        expect(r.tenant.brand).toEqual({
            siteName: 'Acme Home Pros',
            primaryColor: '#ff5500',
            logoUrl: '/api/public/brand-asset?key=branding%2Ft-1%2Flogo.png',
        });
    });

    it('getBookInfo throws on unknown token', async () => {
        await expect(getBookInfo(db, 'tok-unknown')).rejects.toThrow(/invalid/i);
    });

    it('getBookInfo throws on expired token', async () => {
        await db
            .update(conciergeInvites)
            .set({ expiresAt: new Date(Date.now() - 1000).toISOString() } as any)
            .where(eq(conciergeInvites.token, 'tok-abc-valid'));
        await expect(getBookInfo(db, 'tok-abc-valid')).rejects.toThrow(/expired/i);
    });

    it('createBooking inserts row + returns confirmation token', async () => {
        const r = await createBooking(db, {
            token: 'tok-abc-valid',
            slot: { start: '2026-06-01T10:00:00Z', end: '2026-06-01T12:00:00Z' },
            contactName: 'Alice',
            contactEmail: 'alice@x.com',
            address: '123 Main St',
        });
        expect(r.bookingId).toBeTruthy();
        expect(r.confirmationToken).toBeTruthy();
        expect(r.confirmationToken).not.toMatch(/-/); // dashes stripped

        const rows = await db
            .select()
            .from(conciergeBookings)
            .where(eq(conciergeBookings.id, r.bookingId))
            .all();
        expect(rows).toHaveLength(1);
        expect((rows[0] as any).contactName).toBe('Alice');
        expect((rows[0] as any).tenantId).toBe('t-1');
    });

    it('createBooking throws on expired invite', async () => {
        await db
            .update(conciergeInvites)
            .set({ expiresAt: new Date(Date.now() - 1000).toISOString() } as any)
            .where(eq(conciergeInvites.token, 'tok-abc-valid'));
        await expect(
            createBooking(db, {
                token: 'tok-abc-valid',
                slot: { start: '2026-06-01T10:00:00Z', end: '2026-06-01T12:00:00Z' },
                contactName: 'Alice',
                contactEmail: 'alice@x.com',
                address: '123 Main St',
            }),
        ).rejects.toThrow(/expired/i);
    });

    it('getConfirmInfo returns booking by confirmation token', async () => {
        const created = await createBooking(db, {
            token: 'tok-abc-valid',
            slot: { start: '2026-06-01T10:00:00Z', end: '2026-06-01T12:00:00Z' },
            contactName: 'Alice',
            contactEmail: 'alice@x.com',
            address: '123 Main St',
        });
        const info = await getConfirmInfo(db, created.confirmationToken);
        expect(info.booking.contactName).toBe('Alice');
        expect(info.booking.address).toBe('123 Main St');
        expect(info.booking.tenant.name).toBe('Acme Inspections');
        expect(info.booking.start).toBe('2026-06-01T10:00:00Z');
    });

    it('getConfirmInfo throws on unknown confirmation token', async () => {
        await expect(getConfirmInfo(db, 'nope-nope-nope')).rejects.toThrow(/invalid/i);
    });
});
