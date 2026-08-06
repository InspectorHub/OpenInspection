/**
 * AI provider resolution — decides WHICH credentials an AI call runs on, and
 * whether it may run at all.
 *
 * A pure selection function, like `server/lib/email/resolve-provider.ts`: it
 * does no I/O, so callers supply the already-read tenant key, entitlement and
 * cap state. That keeps the whole policy readable in one screen and testable
 * without a database.
 *
 * The rule, in order:
 *   1. A tenant's OWN key always wins, in every deployment mode. BYOK is
 *      unchanged by the managed path and is never silently overridden.
 *   2. Managed credentials exist only where there is a platform behind them
 *      (`profile.hasManagedAi`). A standalone deploy has no managed path at
 *      all — absent, not disabled.
 *   3. Managed additionally requires an entitlement, headroom under the cap,
 *      and a platform key that is actually configured.
 *
 * `null` means the feature is OFF. Every caller already handles the
 * not-configured shape (503 → "set up AI"), so reusing it gives one failure
 * path instead of two, and a self-hoster never sees a quota error pointing at
 * a billing portal that does not exist for them.
 */
import type { DeploymentProfile } from '../deployment-profile';
import type { AiProvider } from './provider';
import { GeminiProvider } from './providers/gemini';

/** Where the credentials for a resolved call came from. Also selects the
 *  usage metric at the call site — platform-funded volume is metered apart
 *  from bring-your-own volume, the same split `policy.ts` documents for sends. */
export type AiCredentialSource = 'managed' | 'byo';

export interface ResolvedAi {
    provider: AiProvider;
    source: AiCredentialSource;
}

export interface ResolveAiContext {
    /** Capability surface for this deployment. Never branch on `APP_MODE`. */
    profile: DeploymentProfile;
    /** The tenant's own stored key (Settings → Advanced → AI), or null. */
    tenantKey: string | null;
    /** Platform-provided key, when the deployment has one configured. */
    managedKey?: string | null;
    /** Whether this tenant is granted managed access. Supplied by the caller;
     *  OI receives a boolean and never learns what grants it. */
    managedEntitled: boolean;
    /** Whether the tenant is below its managed allowance. */
    underCap: boolean;
    /** Model id from deployment configuration. Passed through unchanged; an
     *  empty value fails closed inside the adapter, not with a default here. */
    model?: string | null;
}

export function resolveAi(ctx: ResolveAiContext): ResolvedAi | null {
    const model = ctx.model ?? '';

    // 1. BYOK wins everywhere, including SaaS. A tenant who paid for their own
    //    key keeps using it; managed credentials never quietly take over.
    if (ctx.tenantKey) {
        return { provider: new GeminiProvider({ apiKey: ctx.tenantKey, model }), source: 'byo' };
    }

    // 2. Standalone has no managed path to offer. This check is the one that
    //    protects self-hosted deploys; do not "simplify" it away.
    if (!ctx.profile.hasManagedAi) return null;

    // 3. Entitlement, then headroom, then an actually-configured platform key.
    //    The last one is fail-closed: an entitled tenant on a deployment whose
    //    platform key was never provisioned gets the feature OFF, not a
    //    confusing runtime credential error mid-report.
    if (!ctx.managedEntitled) return null;
    if (!ctx.underCap) return null;
    if (!ctx.managedKey) return null;

    return { provider: new GeminiProvider({ apiKey: ctx.managedKey, model }), source: 'managed' };
}
