/**
 * Design System 0520 subsystem E phase 6 — IntegrationsService (M22).
 *
 * Read-only snapshot of every external integration so the Settings →
 * Integrations grid can render connect/reconnect/manage actions. Each
 * row reports `connected` (boolean) + a `lastSync` timestamp where
 * meaningful + an `action` string the UI translates into a button.
 *
 * Failure isolation: any per-integration check that throws (missing
 * table, missing column, etc.) is caught and reported as "not
 * configured" rather than propagating — the page must always render
 * even if half the schema is missing.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, qboConnections } from '../lib/db/schema';
import type { AppEnv } from '../types/hono';

export interface IntegrationRow {
    id:        string;
    name:      string;
    connected: boolean;
    lastSync:  number | null;
    /** Drives the action button label; `null` hides the button. */
    action:    'connect' | 'reconnect' | 'manage' | 'view' | null;
}

export class IntegrationsService {
    constructor(private db: D1Database, private env: AppEnv) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async status(tenantId: string): Promise<{ integrations: IntegrationRow[] }> {
        const db = this.getDrizzle();
        const tenant = await this._safeGet(() =>
            db.select().from(tenants).where(eq(tenants.id, tenantId)).get(),
        );
        const qbo = await this._safeGet(() =>
            db.select().from(qboConnections).where(eq(qboConnections.tenantId, tenantId)).get(),
        );

        const integrations: IntegrationRow[] = [
            {
                id:        'qbo',
                name:      'QuickBooks Online',
                connected: !!qbo,
                lastSync:  null,
                action:    qbo ? 'reconnect' : 'connect',
            },
            {
                id:        'stripe',
                name:      'Stripe Connect',
                connected: !!tenant?.stripeConnectAccountId,
                lastSync:  null,
                action:    tenant?.stripeConnectAccountId ? 'view' : 'connect',
            },
            {
                id:        'gcal',
                name:      'Google Calendar',
                connected: false,
                lastSync:  null,
                action:    'connect',
            },
            {
                id:        'resend',
                name:      'Resend (email)',
                connected: !!this.env.RESEND_API_KEY,
                lastSync:  null,
                action:    null,
            },
            {
                id:        'places',
                name:      'Google Places',
                connected: !!this.env.GOOGLE_PLACES_API_KEY,
                lastSync:  null,
                action:    null,
            },
            {
                id:        'gemini',
                name:      'Gemini AI',
                connected: !!this.env.GEMINI_API_KEY,
                lastSync:  null,
                action:    null,
            },
        ];

        return { integrations };
    }

    private async _safeGet<T>(fn: () => Promise<T | undefined | null>): Promise<T | null> {
        try {
            return (await fn()) ?? null;
        } catch {
            return null;
        }
    }
}
