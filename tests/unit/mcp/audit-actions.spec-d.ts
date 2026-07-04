import { describe, it, expectTypeOf } from 'vitest';
import type { AuditAction } from '../../../server/lib/audit';

// Type-only: the protective value here is the compile-time membership check
// (`AuditAction` is a string-literal union — if 'mcp.grant.created' were ever
// removed/renamed, this must fail to compile). Under plain `vitest run` a
// `const x: AuditAction = '...'` assignment is stripped by esbuild before
// execution, so a runtime `expect()` on it would never catch a regression —
// that's why this file is a `*.spec-d.ts` typechecked by vitest.typecheck.config.ts
// (`npm run test:types`), not a runtime spec. Runtime coverage of these audit
// actions being *emitted* lives in mcp-grants-api.spec.ts.
describe('MCP audit actions', () => {
  it('mcp.grant.created is a valid AuditAction', () => {
    expectTypeOf<'mcp.grant.created'>().toMatchTypeOf<AuditAction>();
  });

  it('mcp.grant.revoked is a valid AuditAction', () => {
    expectTypeOf<'mcp.grant.revoked'>().toMatchTypeOf<AuditAction>();
  });
});
