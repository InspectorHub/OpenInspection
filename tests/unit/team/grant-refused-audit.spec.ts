/**
 * A refused attempt to hand out more than you hold is the event an owner would
 * want to find later, and it leaves no other trace because nothing was written.
 * It is recorded once, with the rule that fired, and the error still reaches the
 * caller unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'hono';
import { Errors } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('../../../server/lib/audit', () => ({ auditFromContext: vi.fn() }));
import { auditFromContext } from '../../../server/lib/audit';
import { auditRefusedGrant } from '../../../server/api/team-grant-audit';

const c = {} as Context<HonoConfig>;

describe('auditRefusedGrant', () => {
    beforeEach(() => vi.mocked(auditFromContext).mockClear());

    it('records a capability-ceiling refusal and rethrows it', async () => {
        const err = Errors.CapabilityCeiling(['companyFinance']);
        await expect(auditRefusedGrant(c, 'invite', 'inspector', async () => { throw err; })).rejects.toBe(err);
        expect(auditFromContext).toHaveBeenCalledTimes(1);
        expect(auditFromContext).toHaveBeenCalledWith(c, 'user.grant_refused', 'user', {
            metadata: { reason: 'CAPABILITY_CEILING', role: 'inspector', during: 'invite' },
        });
    });

    it('records role-ceiling and self-change refusals', async () => {
        await expect(auditRefusedGrant(c, 'update', null, async () => { throw Errors.RoleCeiling('owner'); })).rejects.toThrow();
        await expect(auditRefusedGrant(c, 'update', null, async () => { throw Errors.SelfPermissionChange(); })).rejects.toThrow();
        expect(auditFromContext).toHaveBeenCalledTimes(2);
    });

    it('CONTROL - a success and an unrelated refusal write no refusal row', async () => {
        await expect(auditRefusedGrant(c, 'invite', 'inspector', async () => 'ok')).resolves.toBe('ok');
        await expect(auditRefusedGrant(c, 'invite', 'inspector', async () => { throw Errors.Forbidden('nope'); })).rejects.toThrow();
        await expect(auditRefusedGrant(c, 'invite', 'inspector', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(auditFromContext).not.toHaveBeenCalled();
    });
});
