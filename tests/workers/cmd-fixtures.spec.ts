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
