import { describe, expectTypeOf, it } from 'vitest';
import type { AuditAction, AuditWithSlugParams } from '../../../server/lib/audit';

// Type-only. Under plain `vitest run` a type assignment is stripped before it
// executes, so this file only protects anything under `npm run test:types`.
describe('the audit action type is closed', () => {
    it('accepts an action that is actually written', () => {
        expectTypeOf<'booking.routing.applied'>().toMatchTypeOf<AuditAction>();
    });

    it('the slug writer takes AuditAction, not string', () => {
        expectTypeOf<AuditWithSlugParams['action']>().toEqualTypeOf<AuditAction>();
    });

    it('rejects an action nobody declared — the control that makes the two above mean something', () => {
        // @ts-expect-error 'not.a.real.action' is not in the union
        const bad: AuditAction = 'not.a.real.action';
        void bad;
    });
});
