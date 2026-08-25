/**
 * AI provider resolution — decides WHICH credentials an AI call runs on, WHICH
 * endpoint and model it runs against, and whether it may run at all.
 *
 * A pure selection function, like `server/lib/email/resolve-provider.ts`: it
 * does no I/O, so callers supply the already-read workspace key, entitlement
 * and cap state. That keeps the whole policy readable in one screen and
 * testable without a database.
 *
 * The rule, in order:
 *   0. The workspace's own off switch. Checked FIRST because it is the only
 *      answer the workspace chose, and telling them "not entitled" when they
 *      simply turned AI off sends them somewhere they cannot fix anything.
 *   1. A workspace's OWN key always wins, in every deployment mode. It is
 *      never silently overridden by a platform key, and their endpoint and
 *      model win with it.
 *   2. Managed credentials exist only where there is a platform behind them
 *      (`profile.hasManagedAi`). A self-hosted deploy has no managed path at
 *      all — absent, not disabled.
 *   3. Managed additionally requires an entitlement, an accepted policy,
 *      headroom under the cap, and a platform key that is actually configured.
 *
 * IT NO LONGER RETURNS A BARE `null`. Four situations used to return one, and
 * all four reached the inspector as the same sentence even though they are
 * fixed by different people — one of them by nobody the workspace can reach.
 * A refusal now carries a reason from the closed vocabulary in
 * `refusal-reason.ts`. The HTTP shape downstream is unchanged: still
 * `AppError(503, AI_NOT_CONFIGURED)`, with the reason in `details`.
 */
import type { DeploymentProfile } from '../deployment-profile';
import type { AiCredential } from './credential';
import type { AiProvider } from './provider';
import { OpenAiCompatibleProvider } from './providers/openai-compatible';
import { AI_REFUSAL_REASON, type AiRefusalReason } from './refusal-reason';

/** Where the credentials for a resolved call came from. Also selects the
 *  usage metric at the call site — platform-funded volume is metered apart
 *  from bring-your-own volume, the same split `policy.ts` documents for sends. */
export type AiCredentialSource = 'managed' | 'byo';

export interface ResolvedAi {
    provider: AiProvider;
    source: AiCredentialSource;
}

/** A refusal, naming which of the seven situations applies. */
export interface AiRefusal { refused: AiRefusalReason }

export function isRefusal(r: ResolvedAi | AiRefusal): r is AiRefusal {
    return 'refused' in r;
}

export interface ResolveAiContext {
    /** Capability surface for this deployment. Never branch on `APP_MODE`. */
    profile: DeploymentProfile;
    /** `tenant_configs.is_ai_enabled`. False means the workspace switched AI
     *  off; their key and endpoint are still stored and still valid. Required
     *  rather than optional, so a caller has to answer it rather than
     *  accidentally running a call the workspace disabled. */
    aiEnabled: boolean;
    /** The workspace's own stored key (Settings → Advanced → AI), or null. */
    tenantKey: string | null;
    /** The workspace's own endpoint and model, when they configured them. Null
     *  falls back to the deployment default. Read ONLY on the own-key path:
     *  a workspace with no key of its own does not get to redirect a call
     *  funded by the platform key to an endpoint of its choosing. */
    tenantBaseUrl?: string | null;
    tenantModel?: string | null;
    /** Platform-provided credential, when the deployment has one configured.
     *
     *  Either a long-lived key or something that refreshes itself: some
     *  backends issue only short-lived tokens, and the choice between the two
     *  is deployment configuration answered in one place upstream. Every rule
     *  below treats them identically — present or absent is the only property
     *  this function reads. */
    managedKey?: AiCredential | null;
    /** Whether this workspace is granted managed access. Supplied by the
     *  caller; the resolver receives a boolean and never learns what grants it. */
    managedEntitled: boolean;
    /** Whether the workspace is below its managed allowance. */
    underCap: boolean;
    /** Whether the workspace has accepted the current privacy version. Gates
     *  MANAGED only: the subprocessor disclosure that acceptance covers is
     *  about the PLATFORM key. A workspace on its own key has its own
     *  relationship with its own provider. Defaults to true so a deployment
     *  that does not track acceptance is unaffected — only an explicit `false`
     *  refuses. */
    policyAccepted?: boolean;
    /** Model id from deployment configuration. Passed through unchanged; an
     *  empty value fails closed inside the adapter, not with a default here. */
    model?: string | null;
    /** Endpoint from deployment configuration — a gateway on a managed
     *  deployment, a direct provider root or a LAN address on a self-hosted
     *  one. Empty fails closed inside the adapter, same as the model. */
    defaultBaseUrl?: string | null;
    /** Tags for gateway logs on the managed path only. Passed straight to the
     *  adapter, which emits them only when the endpoint really is the gateway. */
    gatewayMetadata?: Record<string, string>;
}

export function resolveAi(ctx: ResolveAiContext): ResolvedAi | AiRefusal {
    // 0. The workspace's own switch outranks every other answer, because it is
    //    the only one the workspace chose.
    if (!ctx.aiEnabled) return { refused: AI_REFUSAL_REASON.SWITCHED_OFF };

    // 1. A workspace's own key wins everywhere. Their endpoint and model win
    //    with it, falling back to the deployment's when they set neither.
    if (ctx.tenantKey) {
        return {
            provider: new OpenAiCompatibleProvider({
                apiKey:  ctx.tenantKey,
                model:   ctx.tenantModel   || ctx.model          || '',
                baseUrl: ctx.tenantBaseUrl || ctx.defaultBaseUrl || '',
            }),
            source: 'byo',
        };
    }

    // 2. A deployment with no platform behind it has no managed path to offer.
    //    This check is the one that protects self-hosted deploys; do not
    //    "simplify" it away.
    if (!ctx.profile.hasManagedAi) return { refused: AI_REFUSAL_REASON.UNAVAILABLE_HERE };

    // 3. Entitlement, then acceptance, then headroom, then a platform key that
    //    was actually provisioned — each with its own answer, because each is
    //    fixed by a different person.
    if (!ctx.managedEntitled) return { refused: AI_REFUSAL_REASON.UNAVAILABLE_HERE };
    if (ctx.policyAccepted === false) return { refused: AI_REFUSAL_REASON.POLICY_NOT_ACCEPTED };
    if (!ctx.underCap) return { refused: AI_REFUSAL_REASON.OVER_CAP };
    // Fail-closed, and the OPERATOR'S to fix: an entitled workspace on a
    // deployment whose platform key was never provisioned gets the feature off,
    // and must never be told to change a setting they do not control.
    if (!ctx.managedKey) return { refused: AI_REFUSAL_REASON.PLATFORM_KEY_MISSING };

    return {
        provider: new OpenAiCompatibleProvider({
            apiKey:  ctx.managedKey,
            model:   ctx.model          || '',
            baseUrl: ctx.defaultBaseUrl || '',
            ...(ctx.gatewayMetadata ? { gatewayMetadata: ctx.gatewayMetadata } : {}),
        }),
        source: 'managed',
    };
}
