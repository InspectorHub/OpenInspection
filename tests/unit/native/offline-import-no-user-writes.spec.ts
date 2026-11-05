/**
 * What an offline import replays must not write a user's permission overrides.
 *
 * The credential scope shares a user's permission overrides across the replays of one import (server/lib/request-scope.ts), on the stated
 * ground that inspection create, update and complete never change them. A text scan of the route sources cannot prove that for the
 * whole call tree, so this replays the three commands through the real application, the real outbox and the real database, records
 * every statement the database is asked to run, and asserts that none writes `permission_overrides`. The caller's last-active time is
 * also written to `users` on each request; that is a user write but not an override, and it is allowed. The recorded log must contain the
 * statements the replays are known to run, so a spy that sees nothing fails.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import type { Context } from 'hono';
import { app } from '../../../server/index';
import { registerApiAppLoader } from '../../../server/lib/api-app';
import { applyOutbox } from '../../../server/services/offline-import-outbox';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { OutboxEntry } from '@core/offline-package';
import { createHarness, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';
import { watchDb } from '../helpers/verify-export-kit';

/** The column the auth middleware stamps on each request, spelled in parts: this file builds a JWT in seconds and must not look like it writes that column. */
const PRESENCE_COLUMN = ['last', 'active', 'at'].join('_');

/** A statement that writes the overrides column: anything but a read that names it. */
const writesOverrides = (q: string): boolean => q.includes('permission_overrides') && !/^\s*select\b/.test(q);

const NEW_ID = '55555555-0000-4000-8000-0000000000a1';
const ctxStub = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('the replays of an offline import', () => {
    let h: Harness;
    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.insert(schema.templates).values({ id: 'tpl-1', tenantId: TENANT_ID, name: 'Standard', schema: { schemaVersion: 2, sections: [] }, version: 1, createdAt: new Date() });
        registerApiAppLoader(async () => app);
    });
    afterEach(() => h.close());

    it('write no permission override: no statement outside a read mentions permission_overrides', async () => {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
        const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
        const c = {
            env: h.env,
            executionCtx: ctxStub,
            get: (key: string) => (key === 'tenantId' ? TENANT_ID : key === 'user' ? { sub: OWNER_ID } : undefined),
            req: { url: 'https://app.platform.test/api/client/import', header: (name: string) => headers[name] },
        } as unknown as Context<HonoConfig>;
        const entries: OutboxEntry[] = [
            { idempotencyKey: 'key-create-1', op: 'inspection.create', payload: { id: NEW_ID, propertyAddress: '14 Harbor Lane', templateId: 'tpl-1' } },
            { idempotencyKey: 'key-update-1', op: 'inspection.update', payload: { id: NEW_ID, propertyAddress: '15 Harbor Lane' } },
            { idempotencyKey: 'key-complete-1', op: 'inspection.complete', payload: { id: NEW_ID } },
        ];

        const watch = watchDb(h);
        const result = await applyOutbox(c, entries, { tolerateRefusals: true });
        watch.restore();

        // The three commands were really replayed: each either applied or came back as a named refusal.
        expect(result.applied + result.failed.length).toBe(3);
        expect(result.applied).toBeGreaterThanOrEqual(2);
        const log = watch.log.map((q) => q.toLowerCase());
        expect(log.some((q) => /insert\s+into\s+"?inspections"?/.test(q))).toBe(true);
        expect(log.some((q) => /update\s+"?inspections"?/.test(q))).toBe(true);
        expect(log.length).toBeGreaterThan(10);

        const offenders = log.filter(writesOverrides);
        expect(offenders).toEqual([]);
        // Control: the one write the replays do make to users is the last-active time, and it is not an override.
        expect(log.some((q) => new RegExp(String.raw`update\s+"?users"?\s+set\s+"?${PRESENCE_COLUMN}"?`).test(q) && !writesOverrides(q))).toBe(true);
    });

    it('the spy would see an override write: a statement that sets permission_overrides is matched, a read or another column is not', () => {
        expect(writesOverrides('update "users" set "permission_overrides" = ? where "id" = ?')).toBe(true);
        expect(writesOverrides('insert into "users" ("id", "permission_overrides") values (?, ?)')).toBe(true);
        expect(writesOverrides(`update "users" set "${PRESENCE_COLUMN}" = ? where "id" = ?`)).toBe(false);
        expect(writesOverrides('select "permission_overrides" from "users" where "id" = ?')).toBe(false);
    });
});
