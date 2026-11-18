/**
 * §9B.1 — export-start confirmation email.
 *
 * Unit tests for the notification service: the recipient is the owner account,
 * the body carries only tenant / start time / device / how to cancel (no PII,
 * no excluded-file detail), the send is classified so it cannot be muted, and
 * a provider failure is reported as non-delivery instead of throwing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import * as schema from '../../../server/lib/db/schema';
import * as buildEmailModule from '../../../server/lib/email/build-email-service';
import { notifyExportStart } from '../../../server/services/data-package/export-notification.service';

const TENANT = 'tenant-dp-notify';
const OWNER = 'owner-dp-notify';
const OWNER_EMAIL = 'owner@example.test';

describe('notifyExportStart (§9B.1)', () => {
    let db: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme-co', status: 'active', tier: 'free',
            deploymentMode: 'shared', maxUsers: 10, createdAt: new Date(1_700_000_000_000),
        });
        await db.insert(schema.users).values({
            id: OWNER, tenantId: TENANT, email: OWNER_EMAIL, passwordHash: 'x',
            role: 'owner', createdAt: new Date(1_700_000_000_000),
        } as never);
    });

    afterEach(() => vi.restoreAllMocks());

    const info = {
        tenantId: TENANT, userId: OWNER, deviceLabel: 'office-laptop',
        jobId: 'job-1', startedAt: 1_700_000_000_000,
    };

    it('emails the owner with tenant, start time, device and cancel path; no PII or excluded detail', async () => {
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        vi.spyOn(buildEmailModule, 'buildTenantEmailService').mockResolvedValue({ sendEmail } as never);

        const delivered = await notifyExportStart({} as never, db, info);

        expect(delivered).toBe(true);
        expect(buildEmailModule.buildTenantEmailService).toHaveBeenCalledWith({}, TENANT);
        const [to, subject, html, attachments, opts] = sendEmail.mock.calls[0];
        expect(to).toEqual([OWNER_EMAIL]);
        expect(subject).toContain('acme-co');
        expect(html).toContain('acme-co');
        expect(html).toContain('office-laptop');
        expect(html).toContain(new Date(info.startedAt).toISOString());
        expect(html.toLowerCase()).toContain('cancel');
        // Explicitly nothing about package contents, rows or excluded files.
        expect(html.toLowerCase()).not.toContain('excluded');
        expect(attachments).toBeUndefined();
        expect(opts).toEqual({ classId: 'data-export-start' });
    });

    it('returns false (never throws) when the provider rejects the send', async () => {
        const sendEmail = vi.fn().mockRejectedValue(new Error('provider down'));
        vi.spyOn(buildEmailModule, 'buildTenantEmailService').mockResolvedValue({ sendEmail } as never);

        await expect(notifyExportStart({} as never, db, info)).resolves.toBe(false);
    });

    it('skips cleanly when the owner has no email on file', async () => {
        await db.update(schema.users).set({ email: '' }).where(eq(schema.users.id, OWNER));
        const sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        vi.spyOn(buildEmailModule, 'buildTenantEmailService').mockResolvedValue({ sendEmail } as never);

        await expect(notifyExportStart({} as never, db, info)).resolves.toBe(false);
        expect(sendEmail).not.toHaveBeenCalled();
    });
});
