import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mcp grants are audited symmetrically', () => {
    it('revocation is audited — the control that shows the asymmetry was real', () => {
        expect(readFileSync('server/api/mcp-grants.ts', 'utf8')).toMatch(/['"]mcp\.grant\.revoked['"]/);
    });

    // Either quote style: `server/` is single-quoted and `app/` — where the
    // consent action lives — is double-quoted.
    it('creation is audited too', () => {
        expect(readFileSync('app/routes/oauth/authorize.tsx', 'utf8')).toMatch(/['"]mcp\.grant\.created['"]/);
    });
});
