import { describe, it, expect } from 'vitest';
import { hc } from 'hono/client';
import type { CoreAuthApi } from '../../../packages/api-types';

// Runtime counterpart to typed-client-shape.spec-d.ts (a type-only file —
// vitest's typecheck mode never executes runtime code, so this assertion was
// extracted here to actually run under test:unit).
describe('typed client — runtime construction', () => {
    it('hc Proxy produces a function-shaped client without throwing', () => {
        const api = hc<CoreAuthApi>('http://localhost');
        expect(api).toBeDefined();
        expect(api.login).toBeDefined();
    });
});
