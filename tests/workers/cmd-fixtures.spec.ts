import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import update from '../fixtures/cmd-events/cmd-tenant-update-v1.json';
import quota from '../fixtures/cmd-events/cmd-tenant-sync-quota-v1.json';

const b = env as unknown as { DB: D1Database };

describe('cmd golden fixtures — consumer can apply every fixture (A-21)', () => {
    beforeAll(async () => {
        await b.DB.exec(
            "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', nachi_number TEXT, applied_cmd_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
        );
        await b.DB.exec(
            "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at INTEGER NOT NULL);",
        );
        await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
        await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
        // The update fixture carries `name` → PortalProvider initializes
        // tenant_configs.siteName (IA-27). Columns unconstrained on purpose —
        // only (tenant_id, site_name, updated_at) are written by this path.
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS tenant_configs (tenant_id TEXT PRIMARY KEY, site_name TEXT, primary_color TEXT, logo_url TEXT, support_email TEXT, sender_email TEXT, reply_to TEXT, email_mode TEXT, sender_display_name TEXT, use_inspector_from_name INTEGER, billing_url TEXT, integration_config TEXT, secrets TEXT, encrypted_secrets TEXT, ics_token TEXT, widget_allowed_origins TEXT, report_theme TEXT, attention_thresholds TEXT, inspection_prefs TEXT, show_estimates INTEGER, enable_repair_list INTEGER, enable_customer_repair_export INTEGER, block_unpaid INTEGER, block_unsigned_agreement INTEGER, custom_referral_sources TEXT, dashboard_column_prefs TEXT, concierge_review_required INTEGER, enable_pdf_pipeline INTEGER, auto_sign_on_publish_default INTEGER, team_mode_default TEXT, apprentice_review_required INTEGER, guest_invites_enabled INTEGER, updated_at INTEGER);',
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
});
