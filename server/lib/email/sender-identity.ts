/**
 * Phase 1 (B-4/A-7) — resolve the per-send From display name + Reply-To from
 * a tenant's email-identity config and the optional sending inspector.
 *
 * Pure + synchronous so it can be unit-tested and called inside any send
 * method. The From *address* and which Resend key to use are decided upstream
 * in diMiddleware (own vs platform); this only computes the display name and
 * reply-to that vary per send.
 *
 * `pointOfContact` drives the From display name + reply-to:
 *   - 'company'  → configured display name (falls back to companyName); reply-to
 *                  is the configured address only — the inspector email is
 *                  never exposed.
 *   - 'inspector' → sending inspector's name (falls back to display name when
 *                   no inspector is present); reply-to is configured address if
 *                   set, otherwise the inspector's email.
 */
export interface EmailIdentityConfig {
  mode: 'platform' | 'own';
  senderEmail: string | null;
  replyTo: string | null;
  senderDisplayName: string | null;
  pointOfContact: 'inspector' | 'company';
  companyName: string | null;
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
  const companyName = clean(config.senderDisplayName) ?? clean(config.companyName);
  const result: ResolvedSenderIdentity = {};

  if (config.pointOfContact === 'inspector') {
    const fromName = clean(inspector?.name) ?? companyName;
    const replyTo = clean(config.replyTo) ?? clean(inspector?.email);
    if (fromName !== undefined) result.fromName = fromName;
    if (replyTo !== undefined) result.replyTo = replyTo;
  } else {
    // company — the configured display name always wins; the inspector name is
    // never used. Reply-to is the configured address only (no inspector email).
    if (companyName !== undefined) result.fromName = companyName;
    const replyTo = clean(config.replyTo);
    if (replyTo !== undefined) result.replyTo = replyTo;
  }
  return result;
}
