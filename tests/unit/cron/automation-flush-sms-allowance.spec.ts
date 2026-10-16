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

const loaderEnvs: Record<string, unknown>[] = [];
vi.mock('../../../server/lib/sms/resolve-twilio', () => ({
    loadProviderForTenant: (env: Record<string, unknown>) => { loaderEnvs.push(env); return Promise.resolve(null); },
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

describe('automation flush: the provider loader sees the dedicated-number credentials', () => {
    const SMS_ARG_INDEX = 3;
    async function loaderEnvFor(env: Partial<ScheduledEnv>): Promise<Record<string, unknown>> {
        flushCalls.length = 0;
        loaderEnvs.length = 0;
        await automationFlushJob.run({ DB: {} as D1Database, TENANT_CACHE: {} as KVNamespace, JWT_SECRET: 's', ...env } as ScheduledEnv, null);
        const sms = flushCalls[0]![SMS_ARG_INDEX] as { resolveProvider: (t: string) => Promise<unknown> };
        await sms.resolveProvider('tenant-1');
        expect(loaderEnvs).toHaveLength(1);
        return loaderEnvs[0]!;
    }

    it('forwards the API key pair so a dedicated-number company resolves in the cron path', async () => {
        const env = await loaderEnvFor({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_API_KEY_SID: 'SK1', TWILIO_API_KEY_SECRET: 'sec' });
        expect(env).toMatchObject({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_API_KEY_SID: 'SK1', TWILIO_API_KEY_SECRET: 'sec' });
    });

    it('control: leaves them absent when the deployment has none', async () => {
        const env = await loaderEnvFor({ TWILIO_ACCOUNT_SID: 'AC1' });
        expect('TWILIO_API_KEY_SID' in env).toBe(false);
        expect('TWILIO_API_KEY_SECRET' in env).toBe(false);
    });

    it('hands the send gate the bindings that open the stored keys', async () => {
        const gate = await gateEnvFor({ TENANT_CACHE: {} as KVNamespace, JWT_SECRET: 's' });
        expect(gate).toMatchObject({ JWT_SECRET: 's' });
        expect(gate.DB).toBeDefined();
    });
});
