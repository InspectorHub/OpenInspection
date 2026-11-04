/**
 * The security argument for the whole memoisation change is structural: the
 * request scope must reach the in-process self-binding and must NOT reach
 * external requests. This spec is that argument in executable form.
 *
 * It reads source text rather than executing the worker because
 * `workers/app.ts` pulls in the React Router server build, which is not
 * loadable under `vitest.api.config.ts`. The assertion it protects is a wiring
 * invariant, and the wiring is exactly what a future refactor would break
 * silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../../workers/app.ts', import.meta.url), 'utf8');

describe('API seam request scope', () => {
    it('hands the in-process self-binding an env carrying the scope', () => {
        expect(SRC).toMatch(/createRequestScope\(\)/);
        expect(SRC).toMatch(/\[REQUEST_SCOPE\]\s*:\s*scope/);
        // The inner fetch must pass the augmented env, not the raw c.env.
        expect(SRC).toMatch(/app\.fetch\(forInProcessApi\(req,[^)]*\),\s*innerEnv,\s*c\.executionCtx\)/);
    });

    it('leaves the external route dispatcher on the raw env', () => {
        // toApi serves real HTTP /api/* traffic. If it ever gains the scope,
        // external requests would start sharing memoised auth decisions.
        const toApi = SRC.slice(SRC.indexOf('const toApi'), SRC.indexOf('const app = new Hono'));
        expect(toApi).toMatch(/app\.fetch\(c\.req\.raw,\s*c\.env,\s*c\.executionCtx\)/);
        expect(toApi).not.toMatch(/REQUEST_SCOPE|innerEnv|scope/);
    });

    it('hands the visitor address on: every in-process call goes through forInProcessApi with the outer request headers', () => {
        // The per-address limiters read the caller's address from the request they are given. A page loader or action builds its own
        // request, which carries none, so unless the entry copies it over from the outer request every visitor shares one bucket.
        // (The real entry cannot be loaded here, so this pins the wiring; the behaviour of the function is covered by
        // app/routes/public/portal-auth.through-page.test.ts.)
        expect(SRC).toMatch(/import \{ forInProcessApi \} from "\.\/inprocess-request"/);
        expect(SRC).toMatch(/forInProcessApi\(req,\s*c\.req\.raw\.headers\)/);
        // And nothing else feeds the in-process app a raw request: the only app.fetch with an innerEnv is the wrapped one.
        const inner = SRC.match(/\.app\.fetch\([^;]*innerEnv[^;]*\)/g) ?? [];
        expect(inner).toHaveLength(1);
        expect(inner[0]).toContain('forInProcessApi');
    });
});
