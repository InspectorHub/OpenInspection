import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * Self-hoster release contract (#124) — GET /status surfaces the running package
 * semver so an operator can confirm which tagged release is deployed after an
 * upgrade (docs/developers/12_upgrade.md). The value flows package.json ->
 * scripts/gen-version.js -> server/generated/version.ts (BUILD.version).
 *
 * /status is a public health route registered before the auth/tenant/di
 * middleware, so it answers without any binding — a plain unit request suffices
 * (no workerd semantics), matching the app.request() pattern the other route
 * unit tests use.
 */
const FAKE_ENV = { APP_MODE: 'standalone' } as unknown as HonoConfig['Bindings'];

describe('GET /status', () => {
    it('includes the package semver alongside build info', async () => {
        const res = await app.request('https://x.test/status', {}, FAKE_ENV);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status?: string; version?: string };
        expect(body.status).toBe('ok');
        expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    });
});
