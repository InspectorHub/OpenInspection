// A-21 — core cmd-consumer path under real workerd: dedup, seq guard, park,
// apply (tenant upsert + quota), per-message ack/retry.
// Batch 2: credential-stream guard (credseq), seed command, reply emission.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { applyCmdEnvelope, handleCmdBatch } from '../../server/portal/cmd-consumer';

// Batch 2: the seed command delegates to the starter-content service, whose
// real implementation touches 8 content tables — out of scope for the consumer
// pipeline tests. The service has its own coverage; here it is stubbed.
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

function envelope(over: Partial<{ id: string; type: string; dataschema: string; tenantseq: number; credseq: number; replyto: string; data: Record<string, unknown> }> = {}) {
    return {
        specversion: '1.0',
        id: over.id ?? crypto.randomUUID(),
        type: over.type ?? 'io.inspectorhub.cmd.tenant.update',
        source: 'portal',
        time: '2026-06-05T00:00:00.000Z',
        dataschema: over.dataschema ?? 'cmd-tenant-update/v1',
        tenantseq: over.tenantseq ?? 1,
        ...(over.credseq !== undefined && { credseq: over.credseq }),
        ...(over.replyto !== undefined && { replyto: over.replyto }),
        data: over.data ?? { tenantId: 'ct1', slug: 'ws-1', status: 'active', name: 'WS One', maxUsers: 5 },
    };
}

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', nachi_number TEXT, applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
    );
    // Batch 2: reply emission appends to the sync outbox.
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
    );
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT NOT NULL, password_hash TEXT NOT NULL, name TEXT, phone TEXT, license_number TEXT, photo_url TEXT, default_signature_base64 TEXT, bio TEXT, service_areas TEXT, slug TEXT, role TEXT NOT NULL DEFAULT 'admin', google_refresh_token TEXT, google_calendar_id TEXT, google_access_token TEXT, google_token_expiry INTEGER, locale TEXT, onboarding_state TEXT, created_at INTEGER NOT NULL, totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT false, totp_recovery_codes TEXT, totp_verified_at INTEGER, notify_on_referral INTEGER NOT NULL DEFAULT true, notify_on_report INTEGER NOT NULL DEFAULT true, notify_on_paid INTEGER NOT NULL DEFAULT false, last_active_at INTEGER, mentor_id TEXT, assigned_section_ids TEXT NOT NULL DEFAULT '[]', expires_at INTEGER, signup_role TEXT, deleted_at INTEGER, terms_accepted TEXT);",
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);',
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);',
    );
    // PortalProvider.handleTenantUpdate reads/initializes tenant_configs when a
    // command carries `name` (IA-27 siteName init). Test DDL keeps every column
    // SELECTed by drizzle present but unconstrained — the apply path only ever
    // writes (tenant_id, site_name, updated_at) here.
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, site_name TEXT, primary_color TEXT, logo_url TEXT, support_email TEXT, sender_email TEXT, reply_to TEXT, email_mode TEXT, sender_display_name TEXT, use_inspector_from_name INTEGER, billing_url TEXT, integration_config TEXT, secrets TEXT, encrypted_secrets TEXT, dek_enc TEXT, ics_token TEXT, widget_allowed_origins TEXT, report_theme TEXT, attention_thresholds TEXT, inspection_prefs TEXT, show_estimates INTEGER, enable_repair_list INTEGER, enable_customer_repair_export INTEGER, block_unpaid INTEGER, block_unsigned_agreement INTEGER, custom_referral_sources TEXT, dashboard_column_prefs TEXT, concierge_review_required INTEGER, allow_inspector_choice INTEGER, enable_pdf_pipeline INTEGER, auto_sign_on_publish_default INTEGER, team_mode_default TEXT, apprentice_review_required INTEGER, guest_invites_enabled INTEGER, require_defect_fields TEXT, updated_at INTEGER);',
    );
}

async function clearTables(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'users', 'tenant_configs', 'sync_outbox', 'tenants']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
}

describe('core cmd consumer — real D1 (A-21)', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('tenant.update upserts a new tenant and advances applied_cmd_seq', async () => {
        const result = await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 1 }));
        expect(result).toBe('applied');
        const t = await b.DB.prepare('SELECT slug, status, applied_cmd_seq FROM tenants WHERE id = ?')
            .bind('ct1').first<{ slug: string; status: string; applied_cmd_seq: number }>();
        expect(t?.slug).toBe('ws-1');
        expect(t?.status).toBe('active');
        expect(t?.applied_cmd_seq).toBe(1);
    });

    it('duplicate envelope id is dropped by dedup', async () => {
        const e = envelope({ tenantseq: 1 });
        expect(await applyCmdEnvelope(b.DB, undefined, e)).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, e)).toBe('duplicate');
    });

    it('stale command (lower tenantseq) is dropped — suspend cannot undo a later activate', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 2, data: { tenantId: 'ct1', slug: 'ws-1', status: 'active' },
        }))).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1, data: { tenantId: 'ct1', slug: 'ws-1', status: 'suspended' },
        }))).toBe('stale');
        const t = await b.DB.prepare('SELECT status FROM tenants WHERE id = ?').bind('ct1').first<{ status: string }>();
        expect(t?.status).toBe('active');
    });

    it('sync_quota applies to an existing tenant; unknown tenant throws (retryable race)', async () => {
        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 1 }));
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            type: 'io.inspectorhub.cmd.tenant.sync_quota',
            dataschema: 'cmd-tenant-sync-quota/v1',
            tenantseq: 2,
            data: { tenantId: 'ct1', maxUsers: 11 },
        }))).toBe('applied');
        const t = await b.DB.prepare('SELECT max_users FROM tenants WHERE id = ?').bind('ct1').first<{ max_users: number }>();
        expect(t?.max_users).toBe(11);
        await expect(applyCmdEnvelope(b.DB, undefined, envelope({
            type: 'io.inspectorhub.cmd.tenant.sync_quota',
            dataschema: 'cmd-tenant-sync-quota/v1',
            tenantseq: 1,
            data: { tenantId: 'ghost', maxUsers: 3 },
        }))).rejects.toThrow(/tenant not found/);
    });

    it('unknown type/version and parse failures park (never throw)', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            type: 'io.inspectorhub.cmd.future.thing', dataschema: 'cmd-future-thing/v1',
        }))).toBe('parked');
        expect(await applyCmdEnvelope(b.DB, undefined, 'not json at all {{')).toBe('parked');
        const n = await b.DB.prepare('SELECT count(*) AS n FROM parked_cmd_events').first<{ n: number }>();
        expect(n?.n).toBe(2);
    });

    it('stale credential-bearing command salvages the credential without regressing tenant state or seq', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 2, data: { tenantId: 'ct1', slug: 'ws-1', status: 'suspended' },
        }))).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'active', adminEmail: 'boss@x.com', adminPasswordHash: 'newhash' },
        }))).toBe('stale-credential-applied');
        const t = await b.DB.prepare('SELECT status, applied_cmd_seq FROM tenants WHERE id = ?').bind('ct1')
            .first<{ status: string; applied_cmd_seq: number }>();
        expect(t?.status).toBe('suspended');        // tenant fields NOT regressed
        expect(t?.applied_cmd_seq).toBe(2);         // seq NOT advanced
        const u = await b.DB.prepare('SELECT password_hash, role FROM users WHERE email = ?').bind('boss@x.com')
            .first<{ password_hash: string; role: string }>();
        expect(u?.password_hash).toBe('newhash');   // credential salvaged
        expect(u?.role).toBe('owner');
    });

    it('re-delivery of an already-judged-stale envelope returns duplicate (marker kept)', async () => {
        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 2 }));
        const staleEnv = envelope({ tenantseq: 1, data: { tenantId: 'ct1', slug: 'ws-1', status: 'suspended' } });
        expect(await applyCmdEnvelope(b.DB, undefined, staleEnv)).toBe('stale');
        expect(await applyCmdEnvelope(b.DB, undefined, staleEnv)).toBe('duplicate');
    });

    it('transient apply failure rolls back the dedup marker so a retry re-applies', async () => {
        const e = envelope({
            type: 'io.inspectorhub.cmd.tenant.sync_quota',
            dataschema: 'cmd-tenant-sync-quota/v1',
            tenantseq: 1, data: { tenantId: 'ct1', maxUsers: 9 },
        });
        await expect(applyCmdEnvelope(b.DB, undefined, e)).rejects.toThrow(/tenant not found/); // ct1 doesn't exist yet
        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 2 }));                    // tenant arrives (note: higher seq)
        // Retry of the SAME envelope id must re-evaluate (marker was rolled back on failure).
        // But seq 1 <= applied 2 → stale path; sync_quota has no credentials → plain drop.
        // NOTE: this is an accepted edge — if the higher-seq tenant.update carried no maxUsers,
        // the quota is permanently lost. sync_quota is absolute full-state, so the next portal
        // emit with the correct quota value will supersede; the drop here is by design.
        expect(await applyCmdEnvelope(b.DB, undefined, e)).toBe('stale');
    });

    it('handleCmdBatch acks applied/parked and retries failures per-message with backoff', async () => {
        const acks: string[] = [];
        const retries: Array<{ id: string; delaySeconds?: number }> = [];
        const mk = (id: string, body: unknown, attempts = 1) => ({
            id, timestamp: new Date(), body, attempts,
            ack: () => acks.push(id),
            retry: (o?: { delaySeconds?: number }) => retries.push({ id, delaySeconds: o?.delaySeconds }),
        });
        const batch = {
            queue: 'inspectorhub-cmd-saas',
            messages: [
                mk('ok', envelope({ tenantseq: 1 })),
                mk('park', 'garbage {{'),
                mk('boom', envelope({
                    type: 'io.inspectorhub.cmd.tenant.sync_quota',
                    dataschema: 'cmd-tenant-sync-quota/v1',
                    tenantseq: 5, data: { tenantId: 'ghost', maxUsers: 1 },
                }), 2),
            ],
            ackAll: () => {}, retryAll: () => {},
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await handleCmdBatch(b.DB, undefined, batch as any);
        expect(acks).toEqual(['ok', 'park']);
        expect(retries).toEqual([{ id: 'boom', delaySeconds: 120 }]);
    });
});

describe('core cmd consumer — batch 2: credseq guard, seed, replies (A-21)', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    function fakeQueue() {
        const sent: Array<Record<string, unknown>> = [];
        return {
            sent,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            queue: { send: async (e: unknown) => { sent.push(e as Record<string, unknown>); } } as any,
        };
    }

    async function outboxRows(): Promise<Array<{ event_type: string; status: string; payload: string }>> {
        const r = await b.DB.prepare('SELECT event_type, status, payload FROM sync_outbox ORDER BY created_at').all<{ event_type: string; status: string; payload: string }>();
        return r.results;
    }

    it('applied command with replyto emits a published reply carrying correlationId + result', async () => {
        const q = fakeQueue();
        const e = envelope({ tenantseq: 1, replyto: 'wf:onboarding:ct1' });
        expect(await applyCmdEnvelope(b.DB, undefined, e, q.queue)).toBe('applied');
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.event_type).toBe('reply.tenant.updated');
        expect(rows[0]!.status).toBe('published');           // inline publish succeeded
        const payload = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
        expect(payload).toMatchObject({ tenantId: 'ct1', correlationId: e.id, replyto: 'wf:onboarding:ct1', result: 'applied' });
        expect(q.sent).toHaveLength(1);
        expect(q.sent[0]).toMatchObject({ type: 'io.inspectorhub.reply.tenant.updated', dataschema: 'reply-tenant-updated/v1', source: 'core' });
    });

    it('duplicate re-delivery re-emits the reply (lost-reply self-heal)', async () => {
        const q = fakeQueue();
        const e = envelope({ tenantseq: 1, replyto: 'wf:onboarding:ct1' });
        expect(await applyCmdEnvelope(b.DB, undefined, e, q.queue)).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, e, q.queue)).toBe('duplicate');
        const rows = await outboxRows();
        expect(rows).toHaveLength(2);
        expect(JSON.parse(rows[1]!.payload)).toMatchObject({ correlationId: e.id, result: 'duplicate' });
    });

    it('no replyto → no reply emitted', async () => {
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 1 }), q.queue)).toBe('applied');
        expect(await outboxRows()).toHaveLength(0);
        expect(q.sent).toHaveLength(0);
    });

    it('queue send failure leaves the reply row pending (sweeper picks it up) and never fails the command', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const broken = { send: async () => { throw new Error('queue down'); } } as any;
        const e = envelope({ tenantseq: 1, replyto: 'wf:onboarding:ct1' });
        expect(await applyCmdEnvelope(b.DB, undefined, e, broken)).toBe('applied');
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe('pending');
    });

    it('fresh credential-bearing update applies the credential and advances applied_cred_seq', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1, credseq: 1,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'active', adminEmail: 'boss@x.com', adminPasswordHash: 'h1' },
        }))).toBe('applied');
        const u = await b.DB.prepare('SELECT password_hash FROM users WHERE email = ?').bind('boss@x.com').first<{ password_hash: string }>();
        expect(u?.password_hash).toBe('h1');
        const t = await b.DB.prepare('SELECT applied_cred_seq FROM tenants WHERE id = ?').bind('ct1').first<{ applied_cred_seq: number }>();
        expect(t?.applied_cred_seq).toBe(1);
    });

    it('stale credential (lower credseq) can no longer overwrite a newer one — the batch-1 residual is closed', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 2, credseq: 2,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'active', adminEmail: 'boss@x.com', adminPasswordHash: 'h2' },
        }))).toBe('applied');
        // Reordered older credential: stale on BOTH streams → plain stale, no salvage.
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1, credseq: 1,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'suspended', adminEmail: 'boss@x.com', adminPasswordHash: 'h1' },
        }))).toBe('stale');
        const u = await b.DB.prepare('SELECT password_hash FROM users WHERE email = ?').bind('boss@x.com').first<{ password_hash: string }>();
        expect(u?.password_hash).toBe('h2');         // newer hash survives
        const t = await b.DB.prepare('SELECT applied_cred_seq FROM tenants WHERE id = ?').bind('ct1').first<{ applied_cred_seq: number }>();
        expect(t?.applied_cred_seq).toBe(2);
    });

    it('stale tenantseq but FRESH credseq still salvages the credential (sparse-field protection intact)', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 2,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'suspended' },
        }))).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1, credseq: 1,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'active', adminEmail: 'boss@x.com', adminPasswordHash: 'h1' },
        }))).toBe('stale-credential-applied');
        const t = await b.DB.prepare('SELECT status, applied_cmd_seq, applied_cred_seq FROM tenants WHERE id = ?').bind('ct1')
            .first<{ status: string; applied_cmd_seq: number; applied_cred_seq: number }>();
        expect(t?.status).toBe('suspended');         // tenant fields NOT regressed
        expect(t?.applied_cmd_seq).toBe(2);          // tenant seq NOT advanced
        expect(t?.applied_cred_seq).toBe(1);         // credential stream advanced
        const u = await b.DB.prepare('SELECT password_hash FROM users WHERE email = ?').bind('boss@x.com').first<{ password_hash: string }>();
        expect(u?.password_hash).toBe('h1');
    });

    it('legacy command without credseq applies the credential unguarded and does NOT advance applied_cred_seq', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1,
            data: { tenantId: 'ct1', slug: 'ws-1', status: 'active', adminEmail: 'boss@x.com', adminPasswordHash: 'legacy-h' },
        }))).toBe('applied');
        const u = await b.DB.prepare('SELECT password_hash FROM users WHERE email = ?').bind('boss@x.com').first<{ password_hash: string }>();
        expect(u?.password_hash).toBe('legacy-h');
        const t = await b.DB.prepare('SELECT applied_cred_seq FROM tenants WHERE id = ?').bind('ct1').first<{ applied_cred_seq: number }>();
        expect(t?.applied_cred_seq).toBe(0);
    });

    it('seed_starter_content applies via the shared implementation; unknown tenant throws (retryable race)', async () => {
        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 1 }));
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            type: 'io.inspectorhub.cmd.tenant.seed_starter_content',
            dataschema: 'cmd-tenant-seed-starter-content/v1',
            tenantseq: 2,
            data: { tenantId: 'ct1' },
        }))).toBe('applied');
        const { seedStarterContent } = await import('../../server/services/starter-content.service');
        // NOTE: don't assert on the D1 binding arg — inspecting it across the
        // workerd boundary throws DATA_CLONE_ERR. tenantId arg is enough.
        expect(vi.mocked(seedStarterContent).mock.calls.at(-1)?.[1]).toBe('ct1');
        await expect(applyCmdEnvelope(b.DB, undefined, envelope({
            type: 'io.inspectorhub.cmd.tenant.seed_starter_content',
            dataschema: 'cmd-tenant-seed-starter-content/v1',
            tenantseq: 1,
            data: { tenantId: 'ghost' },
        }))).rejects.toThrow(/tenant not found/);
    });
});
