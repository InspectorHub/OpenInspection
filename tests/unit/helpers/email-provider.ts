/**
 * A real `EmailProvider` that records who each send was addressed to.
 *
 * WHY A HELPER. `EmailService`'s provider parameter is the full
 * `EmailProvider` interface (`server/lib/email/provider.ts`) — four members,
 * two of them webhook machinery. Specs that only care about "who got mailed"
 * were passing an object literal with `sendEmail` alone, which does not
 * satisfy the interface. Casting it would silence a genuine shape mismatch:
 * these are the two members whose absence at runtime would be a `TypeError`,
 * not a wrong assertion.
 *
 * The webhook members THROW rather than returning a plausible empty value. No
 * caller of this helper exercises the inbound path, so a call means the spec
 * grew a dependency its fixture never modelled — and a silent `[]` / `false`
 * would let that pass as a green run.
 */
import type { EmailProvider, EmailSendArgs, NormalizedEmailEvent } from '../../../server/lib/email/provider';

export function recordingEmailProvider(sent: string[][], id = 'm1'): EmailProvider {
    return {
        async sendEmail(args: EmailSendArgs) {
            sent.push(Array.isArray(args.to) ? args.to : [args.to]);
            return { ok: true as const, id };
        },
        verifyWebhookSignature(): Promise<boolean> {
            throw new Error('recordingEmailProvider: the inbound webhook path is not modelled by this fixture');
        },
        parseWebhookEvents(): NormalizedEmailEvent[] {
            throw new Error('recordingEmailProvider: the inbound webhook path is not modelled by this fixture');
        },
    };
}
