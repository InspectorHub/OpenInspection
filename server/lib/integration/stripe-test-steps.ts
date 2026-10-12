/**
 * Stepwise "Test connection" for a workspace's own Stripe account.
 *
 * Three read-only steps, each proving one more thing:
 *
 *   key_valid             the stored secret key can read its own account
 *   account_capabilities  charges_enabled / payouts_enabled / details_submitted
 *   webhook               a verified delivery has actually arrived (from the
 *                         per-tenant delivery log; Stripe's signature cannot be
 *                         triggered from our side, so "arrived and verified" is
 *                         the only observable proof)
 *
 * NOT implemented here, on purpose: any step that creates a payment. A test-mode
 * charge-and-refund and a live-mode create-then-cancel intent both write to the
 * workspace's Stripe account, and the live one leaves a record there. They need a
 * confirmation flow (what will be created, in which mode, that it leaves a
 * cancelled record) designed with the interface, so they are a separate piece of
 * work and nothing in this module may be extended to create one silently.
 *
 * `detail` strings are fixed and non-sensitive: never the key or a response body.
 */
import type { StepResult, StepStatus } from './email-test-steps';

export type StripeStepId = 'key_valid' | 'account_capabilities' | 'webhook';

interface StripeAccountStatus {
    accountName: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    /** From the key's prefix (the Account API does not expose it); absent when unknown. */
    livemode?: boolean;
}

interface StripeWebhookDelivery {
    ts: string;
    eventType: string;
    result: 'processed' | 'received' | 'signature_failed' | 'tenant_mismatch';
}

export interface StripeStepDeps {
    /** Null when no secret key is stored. */
    fetchAccount: (() => Promise<StripeAccountStatus>) | null;
    webhookSecretConfigured: boolean;
    /** Recent deliveries, newest first. */
    readDeliveries(): Promise<StripeWebhookDelivery[]>;
}

const result = (step: StripeStepId, status: StepStatus, detail: string): StepResult => ({ step, status, detail });

async function loadAccount(deps: StripeStepDeps): Promise<StripeAccountStatus | null> {
    if (!deps.fetchAccount) return null;
    try { return await deps.fetchAccount(); } catch { return null; }
}

function keyValid(account: StripeAccountStatus | null, deps: StripeStepDeps): StepResult {
    if (!deps.fetchAccount) return result('key_valid', 'fail', 'No Stripe secret key is saved.');
    if (!account) return result('key_valid', 'fail', 'Stripe rejected the saved secret key, or could not be reached.');
    return result('key_valid', 'pass', `Connected to ${account.accountName}${account.livemode === undefined ? '' : account.livemode ? ' (live mode)' : ' (test mode)'}.`);
}

function capabilities(account: StripeAccountStatus): StepResult {
    const missing = [
        account.chargesEnabled ? null : 'charges are not enabled',
        account.payoutsEnabled ? null : 'payouts are not enabled',
        account.detailsSubmitted ? null : 'account details are not submitted',
    ].filter((m): m is string => m !== null);
    if (missing.length > 0) {
        return result('account_capabilities', 'fail', `Stripe reports that ${missing.join(', ')}. Finish onboarding in the Stripe dashboard.`);
    }
    return result('account_capabilities', 'pass', 'Charges and payouts are enabled and account details are submitted.');
}

async function webhook(deps: StripeStepDeps): Promise<StepResult> {
    if (!deps.webhookSecretConfigured) return result('webhook', 'fail', 'No webhook signing secret is saved.');
    const log = await deps.readDeliveries();
    const good = log.find((e) => e.result === 'processed' || e.result === 'received');
    if (good) return result('webhook', 'pass', `Last verified delivery: ${good.eventType} at ${good.ts}.`);
    if (log.some((e) => e.result === 'signature_failed')) {
        return result('webhook', 'fail', 'Deliveries are arriving but fail signature checks. Re-copy the signing secret from the Stripe dashboard.');
    }
    if (log.length > 0) return result('webhook', 'fail', 'Deliveries are arriving for a different workspace than this one.');
    return result('webhook', 'skipped', 'No deliveries recorded yet. Send a test event from the Stripe dashboard, then run this step again.');
}

/** Run ONE step, re-deriving its prerequisites. Never throws on provider failure. */
export async function runStripeStep(target: StripeStepId, deps: StripeStepDeps): Promise<StepResult> {
    const account = await loadAccount(deps);
    const valid = keyValid(account, deps);
    if (target === 'key_valid') return valid;
    if (valid.status === 'fail' || !account) return result(target, 'skipped', 'Skipped because key_valid did not pass.');

    const caps = capabilities(account);
    if (target === 'account_capabilities') return caps;
    if (caps.status === 'fail') return result(target, 'skipped', 'Skipped because account_capabilities did not pass.');

    return webhook(deps);
}
