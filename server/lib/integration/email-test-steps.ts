/**
 * Stepwise "Test connection" for a workspace's own Resend account.
 *
 * The single-shot probe only proved the key was accepted. Each step here proves
 * one more thing a real send depends on, and reports one concrete reason when it
 * fails, so a workspace can see WHERE its setup stops working:
 *
 *   key_valid               the key is accepted (401/403 = rejected, no reply = unreachable)
 *   key_scope               full-access key, or send-only (cannot read the domain list)
 *   sender_domain_verified  the saved sender's domain is on the account and verified
 *   send_test               one real message, to the signed-in user's own address
 *   delivery                the provider's delivered / bounced event for that message
 *   quota                   usage counters the send response carried
 *
 * Steps run one at a time. The runner never trusts the caller's idea of what
 * already passed: the cheap read-only prerequisites are re-run here, and the
 * delivery and quota steps read what the last `send_test` stored. A step whose
 * prerequisite FAILED reports `skipped`; one whose prerequisite was merely
 * skipped (a send-only key cannot list domains) still runs.
 *
 * Recipient: `send_test` mails `deps.sessionEmail` and nothing else. There is no
 * recipient parameter anywhere in this module, so a test endpoint built on it
 * cannot be turned into a way to mail an arbitrary address.
 *
 * `detail` strings are fixed, short and non-sensitive: never the key, never a
 * provider response body.
 */
import { ResendProvider } from '../email/providers/resend';
import type { EmailSendUsage } from '../email/provider';

export const EMAIL_STEP_IDS = [
    'key_valid', 'key_scope', 'sender_domain_verified', 'send_test', 'delivery', 'quota',
] as const;
export type EmailStepId = (typeof EMAIL_STEP_IDS)[number];

export type StepStatus = 'pass' | 'fail' | 'skipped' | 'pending';

export interface StepResult {
    step: string;
    status: StepStatus;
    detail: string;
}

/** What the last `send_test` left behind, for the delivery and quota steps. */
export interface LastSend {
    messageId: string;
    usage?: EmailSendUsage;
}

export type DeliveryOutcome = 'delivered' | 'bounced' | 'none';

export interface EmailStepDeps {
    apiKey: string;
    senderEmail: string | null;
    senderDisplayName: string | null;
    replyTo: string | null;
    /** The signed-in user's own address, read from their account row. */
    sessionEmail: string | null;
    lastSend: LastSend | null;
    saveLastSend(send: LastSend): Promise<void>;
    lookupDelivery(messageId: string): Promise<DeliveryOutcome>;
}

const result = (step: EmailStepId, status: StepStatus, detail: string): StepResult => ({ step, status, detail });

async function keyValid(provider: ResendProvider): Promise<StepResult> {
    const probe = await provider.probeApiKey();
    if (!probe.reachable) return result('key_valid', 'fail', 'Could not reach Resend. Try again in a moment.');
    if (!probe.valid) return result('key_valid', 'fail', 'Resend rejected the saved API key.');
    return result('key_valid', 'pass', 'Resend accepted the API key.');
}

type DomainListing = Awaited<ReturnType<ResendProvider['listDomains']>>;

function keyScope(listing: DomainListing): StepResult {
    if (listing.ok) return result('key_scope', 'pass', 'Full-access key: the account\'s domains can be read.');
    if (listing.reason === 'restricted') {
        return result('key_scope', 'pass', 'Send-only key: domains cannot be read, so the sender domain check is skipped. Continue with the test email.');
    }
    if (listing.reason === 'unreachable') return result('key_scope', 'fail', 'Could not reach Resend. Try again in a moment.');
    return result('key_scope', 'fail', `Resend could not list domains (status ${listing.status ?? 'unknown'}).`);
}

function senderDomain(listing: DomainListing, senderEmail: string | null): StepResult {
    if (!listing.ok && listing.reason === 'restricted') {
        return result('sender_domain_verified', 'skipped', 'A send-only key cannot read domains. The test email will show whether the sender is accepted.');
    }
    if (!listing.ok) return result('sender_domain_verified', 'fail', 'Resend could not list domains.');
    const at = senderEmail?.lastIndexOf('@') ?? -1;
    if (!senderEmail || at < 1) return result('sender_domain_verified', 'fail', 'No sender email is saved. Save one under Communication settings first.');
    const domain = senderEmail.slice(at + 1).trim().toLowerCase();
    const match = listing.domains.find((d) => d.name === domain);
    if (!match) return result('sender_domain_verified', 'fail', `${domain} is not a domain on this Resend account.`);
    if (match.status !== 'verified') {
        return result('sender_domain_verified', 'fail', `${domain} is on the account but its status is "${match.status}", not verified.`);
    }
    return result('sender_domain_verified', 'pass', `${domain} is verified.`);
}

/** Strip characters that would break out of a quoted display name. */
function displayName(name: string | null): string {
    return (name ?? '').replace(/[<>"\r\n]/g, '').trim();
}

async function sendTest(provider: ResendProvider, deps: EmailStepDeps): Promise<StepResult> {
    if (!deps.senderEmail) return result('send_test', 'fail', 'No sender email is saved. Save one under Communication settings first.');
    if (!deps.sessionEmail) return result('send_test', 'fail', 'Your account has no email address to send the test to.');
    const name = displayName(deps.senderDisplayName);
    // Straight to the provider adapter: a workspace testing its OWN account is not
    // subject to the platform-funded send cooling window or the suppression list.
    const sent = await provider.sendEmail({
        from: name ? `${name} <${deps.senderEmail}>` : deps.senderEmail,
        to: deps.sessionEmail,
        subject: 'Test email from your inspection software',
        html: '<p>This is a test message confirming that your email provider settings can send.</p>',
        text: 'This is a test message confirming that your email provider settings can send.',
        ...(deps.replyTo ? { replyTo: deps.replyTo } : {}),
    });
    if (sent.ok) {
        if (sent.id) await deps.saveLastSend({ messageId: sent.id, ...(sent.usage ? { usage: sent.usage } : {}) });
        return result('send_test', 'pass', 'Test email accepted by Resend and sent to your own address.');
    }
    switch (sent.kind) {
        case 'sender_domain': return result('send_test', 'fail', 'Resend refused the sender address. Check that its domain is verified.');
        case 'quota_exceeded': return result('send_test', 'fail', `Your Resend ${sent.quotaWindow ?? 'sending'} quota is used up.`);
        case 'rate_limited': return result('send_test', 'fail', 'Resend is rate limiting this account. Wait a moment and retry.');
        case 'suppressed': return result('send_test', 'fail', 'Resend suppressed your address as a recipient.');
        default: return result('send_test', 'fail', 'Resend did not accept the test email. Try again in a moment.');
    }
}

async function delivery(deps: EmailStepDeps): Promise<StepResult> {
    if (!deps.lastSend) return result('delivery', 'skipped', 'Send the test email first.');
    const outcome = await deps.lookupDelivery(deps.lastSend.messageId);
    if (outcome === 'delivered') return result('delivery', 'pass', 'Resend reported the test email as delivered.');
    if (outcome === 'bounced') return result('delivery', 'fail', 'Resend reported the test email as bounced.');
    return result('delivery', 'pending', 'No delivery report yet. It needs the Resend webhook set up; check again shortly.');
}

function quota(deps: EmailStepDeps): StepResult {
    if (!deps.lastSend) return result('quota', 'skipped', 'Send the test email first.');
    const u = deps.lastSend.usage;
    if (!u) return result('quota', 'skipped', 'Resend did not report quota usage on the send response.');
    const parts = [
        u.dailyUsed !== undefined ? `${u.dailyUsed} sent today` : null,
        u.monthlyUsed !== undefined ? `${u.monthlyUsed} sent this month` : null,
    ].filter((p): p is string => p !== null);
    return result('quota', 'pass', `${parts.join(', ')}.`);
}

function blockedBy(step: EmailStepId, prior: StepResult): StepResult {
    return result(step, 'skipped', `Skipped because ${prior.step} did not pass.`);
}

/** Run ONE step, re-deriving whatever it depends on. Never throws on provider failure. */
export async function runEmailStep(target: EmailStepId, deps: EmailStepDeps): Promise<StepResult> {
    if (target === 'delivery') return delivery(deps);
    if (target === 'quota') return quota(deps);

    const provider = new ResendProvider({ apiKey: deps.apiKey });
    const valid = await keyValid(provider);
    if (target === 'key_valid') return valid;
    if (valid.status === 'fail') return blockedBy(target, valid);

    const listing = await provider.listDomains();
    const scope = keyScope(listing);
    if (target === 'key_scope') return scope;
    if (scope.status === 'fail') return blockedBy(target, scope);

    const domain = senderDomain(listing, deps.senderEmail);
    if (target === 'sender_domain_verified') return domain;
    if (domain.status === 'fail') return blockedBy(target, domain);

    return sendTest(provider, deps);
}
