/**
 * Inside a new company's cooling window a send is allowed when the request
 * carries a Turnstile token Cloudflare accepts, and refused (same error code as
 * before) when it does not. Outside the window nothing is asked of anyone.
 */
import { describe, it, expect, vi } from 'vitest';

import { createTestDb } from '../db';
import { d1For } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { buildOutboundCoolingWindow, COOLING_WINDOW_MS } from '../../../server/lib/email/outbound-cooling-window';
import { ErrorCode } from '../../../server/lib/errors';

const NOW = 1_800_000_000_000;

/** A database holding company `t1`, created at `createdAt`: the one fact the cooling window reads. */
function companyCreatedAt(createdAt: Date): D1Database {
    const { db, sqlite } = createTestDb();
    db.insert(schema.tenants).values({
        id: 't1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt,
    } as never).run();
    return d1For(sqlite);
}
let createdAt: Date = new Date(NOW);
const port = (verifier?: () => Promise<boolean>) => buildOutboundCoolingWindow(companyCreatedAt(createdAt), 't1', () => NOW, verifier);

describe('cooling window with human verification', () => {
    it('refuses inside the window when the request carries no token (API / MCP callers)', async () => {
        createdAt = new Date(NOW - 60_000);
        await expect(port().check('report-ready')).rejects.toMatchObject({ code: ErrorCode.OUTBOUND_COOLING_WINDOW });
    });

    it('allows inside the window when the token verifies', async () => {
        createdAt = new Date(NOW - 60_000);
        const verify = vi.fn(async () => true);
        await expect(port(verify).check('report-ready')).resolves.toBeUndefined();
        expect(verify).toHaveBeenCalledTimes(1);
    });

    it('carries the site key on the refusal, so a page without a session can show the check', async () => {
        createdAt = new Date(NOW - 60_000);
        const p = buildOutboundCoolingWindow(companyCreatedAt(createdAt), 't1', () => NOW, undefined, 'site-key-1');
        await expect(p.check('report-ready')).rejects.toMatchObject({ details: { turnstileSiteKey: 'site-key-1' } });
    });

    it('refuses inside the window when the token is rejected, with the same code', async () => {
        createdAt = new Date(NOW - 60_000);
        await expect(port(async () => false).check('report-ready')).rejects.toMatchObject({ code: ErrorCode.OUTBOUND_COOLING_WINDOW });
    });

    it('never asks for verification outside the window', async () => {
        createdAt = new Date(NOW - COOLING_WINDOW_MS - 1);
        const verify = vi.fn(async () => false);
        await expect(port(verify).check('report-ready')).resolves.toBeUndefined();
        expect(verify).not.toHaveBeenCalled();
    });

    it('never asks for verification for an account-mechanics class', async () => {
        createdAt = new Date(NOW - 60_000);
        const verify = vi.fn(async () => false);
        await expect(port(verify).check('password-reset')).resolves.toBeUndefined();
        expect(verify).not.toHaveBeenCalled();
    });
});
