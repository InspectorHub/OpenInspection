/**
 * Phase 1 (B-4/A-7) — resolve the per-send From display name + Reply-To from
 * a tenant's email-identity config and the optional sending inspector.
 *
 * Pure + synchronous so it can be unit-tested and called inside any send
 * method. The From *address* and which Resend key to use are decided upstream
 * in diMiddleware (own vs platform); this only computes the display name and
 * reply-to that vary per send.
 */
export interface EmailIdentityConfig {
  mode: 'platform' | 'own';
  senderEmail: string | null;
  replyTo: string | null;
  senderDisplayName: string | null;
  useInspectorFromName: boolean;
  siteName: string | null;
}

export interface SenderInspector {
  name?: string | null;
  email?: string | null;
}

export interface ResolvedSenderIdentity {
  fromName?: string;
  replyTo?: string;
}

function clean(s: string | null | undefined): string | undefined {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : undefined;
}

export function resolveSenderIdentity(
  config: EmailIdentityConfig,
  inspector?: SenderInspector,
): ResolvedSenderIdentity {
  const inspectorName = config.useInspectorFromName ? clean(inspector?.name) : undefined;
  const inspectorEmail = config.useInspectorFromName ? clean(inspector?.email) : undefined;

  const fromName = inspectorName ?? clean(config.senderDisplayName) ?? clean(config.siteName);
  const replyTo = clean(config.replyTo) ?? inspectorEmail;

  const result: ResolvedSenderIdentity = {};
  if (fromName !== undefined) result.fromName = fromName;
  if (replyTo !== undefined) result.replyTo = replyTo;
  return result;
}
