import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import update from '../fixtures/cmd-events/cmd-tenant-update-v1.json';
import quota from '../fixtures/cmd-events/cmd-tenant-sync-quota-v1.json';
import updateReplyto from '../fixtures/cmd-events/cmd-tenant-update-replyto-v1.json';
import seed from '../fixtures/cmd-events/cmd-tenant-seed-starter-content-v1.json';
import { TENANT_CONFIGS_TEST_DDL } from '../helpers/inline-ddl';

// Batch 2: the seed fixture exercises the consumer pipeline, not the content
// seeder (which touches 8 tables and has its own coverage) — stubbed here.
vi.mock('../../server/services/starter-content.service', () => ({
    seedStarterContent: vi.fn(async () => ({
        inspectionTemplatesSeeded: 7,
        agreementTemplatesSeeded: 1,
        cannedCommentsSeeded: 254,
        eventTypesSeeded: 3,
        tagsSeeded: 4,
        recommendationsSeeded: 80,
        ratingSystemsSeeded: 4,
        marketplaceLibrariesSeeded: 2,
    })),
}));

const b = env as unknown as { DB: D1Database };

describe('cmd golden fixtures — consumer can apply every fixture (A-21)', () => {
    beforeAll(async () => {
        await b.DB.exec(
            "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
        );
        // Batch 2: replies (the replyto fixture) append to the sync outbox.
        await b.DB.exec(
            "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
        );
        // Full users DDL (mirrors cmd-consumer.spec.ts) — the replyto fixture
        // carries credentials, and the drizzle insert binds every column.
        await b.DB.exec(
            "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT, phone TEXT, license_number TEXT, photo_url TEXT, default_signature_base64 TEXT, signature_enabled INTEGER NOT NULL DEFAULT true, bio TEXT, service_areas TEXT, slug TEXT, role TEXT NOT NULL DEFAULT 'admin', google_refresh_token TEXT, google_calendar_id TEXT, google_access_token TEXT, google_token_expiry INTEGER, locale TEXT, onboarding_state TEXT, created_at INTEGER NOT NULL, totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT false, totp_recovery_codes TEXT, totp_verified_at INTEGER, notify_on_referral INTEGER NOT NULL DEFAULT true, notify_on_report INTEGER NOT NULL DEFAULT true, notify_on_paid INTEGER NOT NULL DEFAULT false, last_active_at INTEGER, mentor_id TEXT, assigned_section_ids TEXT NOT NULL DEFAULT '[]', expires_at INTEGER, signup_role TEXT, deleted_at INTEGER, terms_accepted TEXT, permission_overrides TEXT);",
        );
        await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
        await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
        // The update fixture carries `name` → PortalProvider initializes
        // tenant_configs.companyName (IA-27). Columns unconstrained on purpose —
        // only (tenant_id, company_name, updated_at) are written by this path.
        // Shared with cmd-consumer; guarded against schema drift by
        // inline-ddl-schema-sync.spec.ts.
        await b.DB.exec(TENANT_CONFIGS_TEST_DDL);
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS usage_counters (tenant_id TEXT NOT NULL, metric TEXT NOT NULL, period_key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, metric, period_key));',
        );
    });

    it('applies both fixtures in order', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, update)).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, quota)).toBe('applied');
        const t = await b.DB.prepare('SELECT max_users, applied_cmd_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-1').first<{ max_users: number; applied_cmd_seq: number }>();
        expect(t?.max_users).toBe(10);
        expect(t?.applied_cmd_seq).toBe(2);
    });

    it('batch 2: replyto fixture applies, advances both streams, and emits the reply matching the reply fixture', async () => {
        const sent: Array<Record<string, unknown>> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queue = { send: async (e: unknown) => { sent.push(e as Record<string, unknown>); } } as any;
        expect(await applyCmdEnvelope(b.DB, undefined, updateReplyto, queue)).toBe('applied');

        const t = await b.DB.prepare('SELECT applied_cmd_seq, applied_cred_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-2').first<{ applied_cmd_seq: number; applied_cred_seq: number }>();
        expect(t?.applied_cmd_seq).toBe(1);
        expect(t?.applied_cred_seq).toBe(1);
        const u = await b.DB.prepare('SELECT password_hash FROM users WHERE email = ?')
            .bind('fix2@example.com').first<{ password_hash: string }>();
        expect(u?.password_hash).toBe('pbkdf2$fixture');

        // The emitted reply must match the cross-repo golden fixture
        // (tests/fixtures/sync-events/reply-tenant-updated.v1.json) on every
        // field except id/time (runtime-generated).
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            specversion: '1.0',
            type: 'io.inspectorhub.reply.tenant.updated',
            source: 'core',
            dataschema: 'reply-tenant-updated/v1',
            data: {
                tenantId: 'fixture-tenant-2',
                correlationId: 'wf:onboarding:fixture-tenant-2:sync-to-core',
                replyto: 'wf:onboarding:fixture-tenant-2',
                result: 'applied',
            },
        });
    });

    it('batch 2: seed fixture applies via the shared implementation', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, seed)).toBe('applied');
        const { seedStarterContent } = await import('../../server/services/starter-content.service');
        // D1 binding arg not asserted — inspecting it across workerd throws DATA_CLONE_ERR.
        expect(vi.mocked(seedStarterContent).mock.calls.at(-1)?.[1]).toBe('fixture-tenant-2');
        const t = await b.DB.prepare('SELECT applied_cmd_seq FROM tenants WHERE id = ?')
            .bind('fixture-tenant-2').first<{ applied_cmd_seq: number }>();
        expect(t?.applied_cmd_seq).toBe(2);
    });
});
