import { describe, it, expect } from 'vitest';
import worker from '../../../workers/app';

const env = (extra: Record<string, unknown> = {}) =>
    ({ APP_MODE: 'standalone', ...extra }) as unknown as Env;

describe('MCP OAuth scaffold', () => {
    it('returns 401 with WWW-Authenticate on /mcp when MCP_ENABLED', async () => {
        const res = await worker.fetch(
            new Request('https://x.test/mcp'),
            env({ MCP_ENABLED: 'true' }),
            {} as ExecutionContext,
        );
        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toMatch(/Bearer/i);
    });

    it('does NOT intercept /mcp when flag is off (falls through to RR → not 401)', async () => {
        const res = await worker.fetch(
            new Request('https://x.test/mcp'),
            env(),
            {} as ExecutionContext,
        );
        expect(res.status).not.toBe(401);
    });
});
