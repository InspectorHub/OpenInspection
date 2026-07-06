import type {
  EmailProvider,
  EmailSendArgs,
  EmailWebhookContext,
  NormalizedEmailEvent,
} from '../provider';

/** KV key prefix for captured E2E emails. One entry per recipient. */
const SINK_PREFIX = 'e2e_email:';
/** Short TTL — captured bodies are read back within a single test run. */
const SINK_TTL_SECONDS = 600;

/** KV key for a recipient's last captured email (normalized: trimmed + lowercased). */
export function sinkKey(recipient: string): string {
  return `${SINK_PREFIX}${recipient.trim().toLowerCase()}`;
}

/** Shape stored per recipient and returned by the `/api/__test__/last-email` route. */
interface RecordedEmail {
  subject: string;
  html: string;
  text: string | null;
}

/**
 * TEST-ONLY email transport. Instead of sending, it records each outbound
 * message to KV so an E2E test can read back a link it otherwise could never
 * observe from the browser — most importantly the password-reset token, which
 * is emailed and never returned by any API.
 *
 * Wired ONLY when `env.E2E_EMAIL_SINK === '1'` (see build-email-service.ts).
 * It MUST NOT be reachable in production: no real email leaves the worker and
 * the captured bodies are read back exclusively via a matching env-gated route.
 * Every deploy leaves the flag unset, so this class is never constructed there.
 */
export class RecordingEmailProvider implements EmailProvider {
  constructor(private kv: KVNamespace) {}

  async sendEmail(args: EmailSendArgs): Promise<{ ok: true; id?: string }> {
    const recipients = Array.isArray(args.to) ? args.to : [args.to];
    const record: RecordedEmail = {
      subject: args.subject,
      html: args.html,
      text: args.text ?? null,
    };
    const serialized = JSON.stringify(record);
    // Store under every recipient so a lookup by any To address hits.
    await Promise.all(
      recipients
        .filter((r): r is string => typeof r === 'string' && r.length > 0)
        .map((r) => this.kv.put(sinkKey(r), serialized, { expirationTtl: SINK_TTL_SECONDS })),
    );
    return { ok: true, id: 'e2e-sink' };
  }

  // The remaining EmailProvider surface is inert for the sink: it never
  // validates credentials or receives inbound webhooks.
  async validateCredentials(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async verifyWebhookSignature(_ctx: EmailWebhookContext): Promise<boolean> {
    return false;
  }

  parseWebhookEvents(_rawBody: string): NormalizedEmailEvent[] {
    return [];
  }
}
