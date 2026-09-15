import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { contextBootstrap } from '../../../server/lib/middleware/context-bootstrap';
import { diMiddleware } from '../../../server/lib/middleware/di';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * Regression: the DI registry built BrandingService as
 * `new BrandingService(c.env.DB, c.env.TENANT_CACHE)` — dropping the third
 * constructor argument, the R2 bucket. `uploadLogo` opens with
 * `if (!this.r2) throw Errors.BadRequest('Logo upload not available')`, so every
 * logo upload failed on every deployment, for every tenant.
 *
 * The existing branding suite did not catch it because it constructs the service
 * directly and injects its own R2 stub, which proves the method works GIVEN a
 * bucket and says nothing about whether production supplies one. This test goes
 * through the middleware instead, so it asserts the wiring rather than the method.
 */

const BASE_ENV: Partial<HonoConfig['Bindings']> = {
    DB: {} as never, TENANT_CACHE: {} as never,
    JWT_SECRET: 'x'.repeat(32), KEY_ENCRYPTION_SECRET: 'x'.repeat(32),
    TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GEMINI_API_KEY: '',
    RESEND_API_KEY: '', SENDER_EMAIL: '',
    APP_NAME: '', PRIMARY_COLOR: '',
};

describe('diMiddleware — branding service wiring', () => {
    it('hands BrandingService the PHOTOS bucket, so uploadLogo reaches R2', async () => {
        const put = vi.fn().mockResolvedValue(undefined);
        const app = new Hono<HonoConfig>();
        app.use('*', contextBootstrap);
        app.use('*', diMiddleware);

        let thrown: unknown;
        // Not '/api/…' on purpose: that path prefix makes diMiddleware do D1 reads
        // this test has no database for, and none of them touch branding.
        app.get('/probe', async (c) => {
            const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
            try {
                await c.var.services.branding.uploadLogo('tenant-1', file);
            } catch (e) {
                thrown = e;
            }
            return c.text('ok');
        });

        await app.request('/probe', {}, {
            ...BASE_ENV,
            PHOTOS: { put } as never,
        } as never);

        // The only assertion that matters: the bucket was reached at all, i.e.
        // uploadLogo got past its `!this.r2` guard. What happens afterwards needs
        // a real D1 and is the existing suite's job.
        expect(put).toHaveBeenCalled();
        expect(String((thrown as Error | undefined)?.message ?? ''))
            .not.toContain('Logo upload not available');
    });
});
