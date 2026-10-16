/**
 * The cron flush must hand the managed SMS allowance setting to the send gate.
 *
 * `MANAGED_SMS_MONTHLY_ALLOWANCE` is read by `managedSendAllowed`, but the
 * cron path builds its own gate env by hand and used to copy only the shared
 * pool id and the shared-number switch. The variable was therefore ignored for
 * every automation SMS and the built-in default always applied there, while
 * the manual-send path honoured it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const flushCalls: unknown[][] = [];
vi.mock('../../../server/services/automation.service', () => ({
    AutomationService: class {
        flush(...args: unknown[]) {
            flushCalls.push(args);
            return Promise.resolve({ sent: 0 });
        }
    },
}));

import { automationFlushJob } from '../../../server/cron/jobs/automation';
import type { ScheduledEnv } from '../../../server/scheduled';

const GATE_ARG_INDEX = 5;

function gateEnvFor(env: Partial<ScheduledEnv>): Record<string, unknown> {
    flushCalls.length = 0;
    return automationFlushJob.run({ DB: {} as D1Database, ...env } as ScheduledEnv, null)
        .then(() => {
            expect(flushCalls).toHaveLength(1);
            return flushCalls[0]![GATE_ARG_INDEX] as Record<string, unknown>;
        }) as unknown as Record<string, unknown>;
}

describe('automation flush: managed SMS allowance reaches the gate env', () => {
    beforeEach(() => { flushCalls.length = 0; });

    it('forwards MANAGED_SMS_MONTHLY_ALLOWANCE when configured', async () => {
        const gate = await gateEnvFor({ MANAGED_SMS_MONTHLY_ALLOWANCE: '250' });
        expect(gate.MANAGED_SMS_MONTHLY_ALLOWANCE).toBe('250');
    });

    it('leaves it absent when unset so the documented default applies', async () => {
        const gate = await gateEnvFor({});
        expect('MANAGED_SMS_MONTHLY_ALLOWANCE' in gate).toBe(false);
        // control: the sibling keys are still forwarded, so the absence above is
        // not an empty gate env.
        expect(gate.profile).toBeDefined();
    });
});
