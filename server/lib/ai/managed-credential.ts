/**
 * The ONE answer to "what credential, if any, does this deployment fund AI
 * with" — and deliberately the only place that question is asked.
 *
 * WHY IT IS A FUNCTION AND NOT TWO ENV READS. Two places need the answer: the
 * per-request service assembly that builds a provider, and the provisioning
 * read a deployment operator uses to see how workspaces bucket. While there
 * was exactly one variable, reading it twice was harmless. With two KINDS of
 * credential it stops being harmless: a deployment provisioned one way and
 * read the other way reports every workspace as unprovisioned while the
 * runtime resolves a credential perfectly well, and the console becomes
 * confidently wrong about the thing it exists to report. The resolver those
 * two share already carries a warning that it must not grow a second opinion;
 * this keeps that promise for the credential itself.
 *
 * WHAT IT DOES NOT DECIDE. Not entitlement — that is the plan predicate,
 * answered once elsewhere and never here. Not whether a managed path exists at
 * all — that is the deployment profile. This answers only "is there a
 * credential, and what shape is it", and a deployment with none gets `null`,
 * which every caller already treats as "the feature is off".
 *
 * SELF-HOSTED DEPLOYMENTS ARE UNAFFECTED BY CONSTRUCTION. Neither variable
 * exists there, so this returns `null` exactly as the single env read it
 * replaces did — and the profile check refuses a managed path earlier anyway.
 * No new configuration becomes required, and nothing fails closed that did not
 * already.
 */
import { logger } from '../logger';
import { createServiceAccountTokenSource, parseServiceAccountJson } from './credentials/google-service-account';
import type { AiCredential } from './credential';

/** The environment slice this reads. Both optional; both absent is the normal
 *  self-hosted state and is not an error. */
export interface ManagedAiCredentialEnv {
    /** A credential document for a backend that authenticates with short-lived
     *  tokens. Supplied as a deployment secret; never per workspace. */
    AI_VERTEX_SERVICE_ACCOUNT?: string | undefined;
    /** A long-lived platform key, for a backend that issues one. */
    AI_MANAGED_API_KEY?: string | undefined;
}

export function resolveManagedAiCredential(env: ManagedAiCredentialEnv): AiCredential | null {
    const rawAccount = env.AI_VERTEX_SERVICE_ACCOUNT?.trim();
    const staticKey = env.AI_MANAGED_API_KEY?.trim();
    const fallback = staticKey ? staticKey : null;

    if (!rawAccount) return fallback;

    const parsed = parseServiceAccountJson(rawAccount);
    if (!parsed.ok) {
        // Named fields only — see the parser for why nothing from the document
        // itself travels into a log. Resolving to the other credential (or to
        // nothing) rather than throwing keeps the established contract: an
        // entitled workspace on a deployment whose credential is unusable gets
        // the feature OFF, not a failure partway through a report, and is
        // never told to change a setting of its own.
        logger.error('Managed AI service account is not usable', {
            missing:   parsed.missing,
            fallingBackToLongLivedKey: fallback !== null,
            timestamp: new Date().toISOString(),
        });
        return fallback;
    }

    if (fallback) {
        // Both configured. The service account wins because it is the
        // deliberate, newer configuration; silently preferring a superseded
        // key is precisely the failure where an operator provisions the switch
        // and nothing switches. Not fail-closed, because holding both is the
        // normal state halfway through a migration.
        logger.warn('Two managed AI credentials are configured; using the service account', {
            timestamp: new Date().toISOString(),
        });
    }

    return createServiceAccountTokenSource(parsed.account);
}
